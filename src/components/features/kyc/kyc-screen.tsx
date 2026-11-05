'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Notice, Skeleton } from '@/components/ui/feedback';
import { Screen, Section, StickyBar } from '@/components/ui/layout';
import { useLocale } from '@/i18n/locale-provider';
import { api, ApiFailure, ensureSession, newIdempotencyKey } from '@/lib/api-client';
import type { KycApplicationView } from '@/server/services/kyc/kyc-view';
import { useErrorMessage } from '../shell/use-error-message';
import { ConsentStep, type ConsentItem } from './consent-step';
import { ContactStep } from './contact-step';
import { UploadTile } from './upload-tile';
import { VerdictPanel } from './verdict-panel';

type SessionView = { journey: { quoteId: string | null; kycApplicationId: string | null; orderId: string | null; orderForQuote: boolean } };
type Step = 'CONSENT' | 'CONTACT' | 'DOCUMENTS';

const ALL_DOCUMENTS = ['GST_CERTIFICATE', 'SIGNATORY_ID', 'ADDRESS_PROOF', 'UDYAM_CERTIFICATE'] as const;
const STEP_NUMBER: Readonly<Record<Step, number>> = { CONSENT: 1, CONTACT: 2, DOCUMENTS: 3 };

export function KycScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const errorMessage = useErrorMessage();

  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [consents, setConsents] = useState<ConsentItem[]>([]);
  const [application, setApplication] = useState<KycApplicationView | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const orderKey = useRef(newIdempotencyKey());
  const progressRef = useRef<HTMLParagraphElement>(null);

  // The control that led here has gone, so keyboard and screen reader users start at the new step.
  useEffect(() => {
    if (step) progressRef.current?.focus({ preventScroll: true });
  }, [step]);

  const load = useCallback(async () => {
    await ensureSession();
    const session = await api.get<SessionView>('/sessions/current');
    if (!session.journey.quoteId) {
      router.replace('/');
      return;
    }
    // An order for this quote is already on its way, so the tracker is the place to be.
    if (session.journey.orderForQuote && session.journey.orderId) {
      router.replace(`/orders/${session.journey.orderId}`);
      return;
    }
    // A new bundle starts at its own quote, rather than at the last one's verification.
    const quote = await api.get<{ status: string }>(`/quotes/${session.journey.quoteId}`);
    if (quote.status !== 'ACCEPTED' && quote.status !== 'NEEDS_ACCEPTANCE') {
      router.replace('/quote');
      return;
    }
    setQuoteId(session.journey.quoteId);

    const list = await api.get<{ items: ConsentItem[] }>('/consents');
    setConsents(list.items);
    if (list.items.find((item) => item.purpose === 'kyc_verification')?.status !== 'GRANTED') {
      setStep('CONSENT');
      return;
    }
    if (!session.journey.kycApplicationId) {
      setStep('CONTACT');
      return;
    }
    const loaded = await api.get<KycApplicationView>(`/kyc-applications/${session.journey.kycApplicationId}`);
    if (loaded.status !== 'OPEN') {
      setStep('CONTACT');
      return;
    }
    setApplication(loaded);
    setStep('DOCUMENTS');
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load awaits first, so nothing is set during the effect itself.
    load().catch((caught: unknown) => setError(errorMessage(caught)));
  }, [load, errorMessage]);

  const retry = useCallback(async () => {
    if (!application) return;
    setRetrying(true);
    setError(null);
    try {
      setApplication(await api.post<KycApplicationView>(`/kyc-applications/${application.id}/reassessment`));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setRetrying(false);
    }
  }, [application, errorMessage]);

  // During an outage the owner needn't do anything: the screen keeps trying while it's open.
  const retryAfter = application?.retryAfterSeconds ?? null;
  useEffect(() => {
    if (retryAfter === null) return;
    const timer = setTimeout(() => void retry(), retryAfter * 1000);
    return () => clearTimeout(timer);
  }, [retryAfter, retry]);

  const placeOrder = async () => {
    if (!application) return;
    setPlacing(true);
    setError(null);
    try {
      const order = await api.post<{ id: string }>('/orders', { quoteId: application.quoteId, kycApplicationId: application.id }, { idempotencyKey: orderKey.current });
      router.push(`/orders/${order.id}`);
    } catch (caught) {
      if (caught instanceof ApiFailure && caught.code === 'ORDER_EXISTS' && typeof caught.details.orderId === 'string') {
        router.push(`/orders/${caught.details.orderId}`);
        return;
      }
      setError(errorMessage(caught));
      setPlacing(false);
    }
  };

  const acceptChanged = async () => {
    if (!application) return;
    setAccepting(true);
    setError(null);
    try {
      await api.post(`/quotes/${application.quoteId}/acceptance`);
      setApplication(await api.get<KycApplicationView>(`/kyc-applications/${application.id}`));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setAccepting(false);
    }
  };

  if (!step || !quoteId) {
    return error ? <Notice tone="danger" live>{error}</Notice> : <Skeleton label={t('app.loading')} />;
  }

  const canOrder = application?.nextActions.includes('PLACE_ORDER') ?? false;

  return (
    <Screen title={t('kyc.title')}>
      <p ref={progressRef} tabIndex={-1} className="text-sm font-medium text-ink-muted" aria-live="polite">
        {t('kyc.progress', { step: STEP_NUMBER[step], total: 3 })}
      </p>
      {error ? <Notice tone="danger" live>{error}</Notice> : null}

      {step === 'CONSENT' ? <ConsentStep consents={consents} onDone={() => void load()} /> : null}

      {step === 'CONTACT' ? (
        <ContactStep
          quoteId={quoteId}
          onCreated={(created) => {
            setApplication(created);
            setStep('DOCUMENTS');
          }}
        />
      ) : null}

      {step === 'DOCUMENTS' && application ? (
        <>
          <Section title={t('kyc.documentsTitle')}>
            <p className="text-sm text-ink-muted">{t('kyc.documentsIntro')}</p>
            {ALL_DOCUMENTS.map((type) => (
              <UploadTile
                key={type}
                applicationId={application.id}
                documentType={type}
                document={application.documents.find((doc) => doc.documentType === type)}
                onUploaded={setApplication}
              />
            ))}
          </Section>

          {application.verdict || application.checks.length > 0 || application.gstin.masked ? (
            <VerdictPanel application={application} onUpdated={setApplication} onAcceptChanged={() => void acceptChanged()} accepting={accepting} />
          ) : null}

          {application.nextActions.includes('RETRY_VERIFICATION') ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-ink-muted">{t('kyc.retryIn', { seconds: application.retryAfterSeconds ?? 0 })}</p>
              <Button variant="secondary" loading={retrying} onClick={() => void retry()}>
                {t('kyc.retryNow')}
              </Button>
            </div>
          ) : null}

          {canOrder ? (
            <StickyBar>
              <Button fullWidth loading={placing} onClick={() => void placeOrder()}>
                {t('kyc.placeOrder')}
              </Button>
            </StickyBar>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
