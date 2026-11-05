'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Notice, Skeleton, type Tone } from '@/components/ui/feedback';
import { Card, Screen } from '@/components/ui/layout';
import { useLocale } from '@/i18n/locale-provider';
import { api, ensureSession } from '@/lib/api-client';
import { useErrorMessage } from '../shell/use-error-message';

type Consent = { purpose: string; status: string; currentNoticeVersion: string };
type Session = { phoneVerified: boolean; phoneMasked: string | null; journey?: { kycApplicationId: string | null; quoteId: string | null } };
type Application = { contact: { name: string | null; source: string | null }; gstin: { masked: string | null }; documents: Array<{ documentType: string }> };
type Conversation = { facts: { businessType: string | null; city: string | null; employeeCount: number | null; numSites: number | null } };
type Withdrawal = { effects?: { documentsDeleted?: number; ordersCancelled?: number } };

// These need their full notice read first, so they can't be granted from a bare button here.
const FULL_NOTICE: Readonly<Record<string, string>> = { advisor_profile: '/', ai_chat: '/', kyc_verification: '/verify' };

const STATUS_TONE: Readonly<Record<string, Tone>> = { GRANTED: 'success', NOTICE_CHANGED: 'warning', NOT_ASKED: 'neutral', WITHDRAWN: 'neutral', ERASED: 'neutral' };

/** Withdrawing is as easy as granting: one tap to see the effect, and one to confirm it. */
export function MyDataScreen() {
  const { t, tDynamic, locale } = useLocale();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [consents, setConsents] = useState<Consent[] | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [application, setApplication] = useState<Application | null>(null);
  const [chat, setChat] = useState<Conversation | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    await ensureSession();
    const [list, current] = await Promise.all([api.get<{ items: Consent[] }>('/consents'), api.get<Session>('/sessions/current')]);
    setConsents(list.items);
    setSession(current);
    // Each may simply not exist, or not be readable after a withdrawal, so a miss isn't an error.
    const applicationId = current.journey?.kycApplicationId;
    setApplication(applicationId ? await api.get<Application>(`/kyc-applications/${applicationId}`).catch(() => null) : null);
    setChat(await api.get<Conversation>('/conversations/current').catch(() => null));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load awaits first, so nothing is set during the effect itself.
    load().catch((caught: unknown) => setError(errorMessage(caught)));
  }, [load, errorMessage]);

  const act = async (run: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await run();
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = (purpose: string) =>
    act(async () => {
      const result = await api.post<Withdrawal>(`/consents/${purpose}/withdrawal`);
      setConfirming(null);
      setDone(t('myData.withdrawn', { count: result.effects?.documentsDeleted ?? 0, orders: result.effects?.ordersCancelled ?? 0 }));
    });

  const grant = (consent: Consent) =>
    act(async () => {
      await api.post('/consents', { purpose: consent.purpose, noticeVersion: consent.currentNoticeVersion, language: locale });
    });

  const signOut = async () => {
    setBusy(true);
    try {
      await api.delete('/sessions/current');
      router.push('/');
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  if (!consents) return error ? <Notice tone="danger" live>{error}</Notice> : <Skeleton label={t('app.loading')} />;

  return (
    <Screen title={t('myData.title')}>
      <p className="text-ink-muted">{t('myData.intro')}</p>
      <p>{session?.phoneMasked ? t('myData.phone', { phone: session.phoneMasked }) : t('myData.notSignedIn')}</p>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">{t('myData.holdHeading')}</h2>
        {!application && !chat && !session?.journey?.quoteId ? <p className="text-sm text-ink-muted">{t('myData.holdNothing')}</p> : null}
        {session?.journey?.quoteId ? <p className="text-sm">{t('myData.holdQuote')}</p> : null}
        {application?.contact.source === 'LEAD_PREFILL' ? <p className="text-sm">{t('myData.holdNameOnFile')}</p> : null}
        {chat ? (
          <p className="text-sm">
            {t('myData.holdBusiness', {
              details: [chat.facts.businessType, chat.facts.city, chat.facts.employeeCount, chat.facts.numSites].filter((value) => value !== null).join(', ') || '—',
            })}
          </p>
        ) : null}
        {application?.contact.name ? <p className="text-sm">{t('myData.holdName', { name: application.contact.name })}</p> : null}
        {application?.gstin.masked ? <p className="text-sm">{t('myData.holdGstin', { value: application.gstin.masked })}</p> : null}
        {application ? (
          <p className="text-sm">
            {application.documents.length > 0
              ? t('myData.holdDocuments', { names: application.documents.map((doc) => tDynamic(`kyc.doc.${doc.documentType}`)).join(', ') })
              : t('myData.holdNoDocuments')}
          </p>
        ) : null}
        {application ? <p className="text-sm text-ink-muted">{t('myData.holdCorrect')}</p> : null}
      </section>

      {error ? <Notice tone="danger" live>{error}</Notice> : null}
      {done ? <Notice tone="success" live>{done}</Notice> : null}

      {consents.map((consent) => (
        <Card key={consent.purpose} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{tDynamic(`myData.purpose.${consent.purpose}`)}</h2>
            <Badge tone={STATUS_TONE[consent.status] ?? 'neutral'}>{tDynamic(`myData.status.${consent.status}`)}</Badge>
          </div>
          <p className="text-sm text-ink-muted">{tDynamic(`myData.purposeBody.${consent.purpose}`)}</p>
          {consent.status === 'GRANTED' ? (
            confirming === consent.purpose ? (
              <div className="flex flex-col gap-2">
                <Notice tone="warning">{tDynamic(`myData.effect.${consent.purpose}`)}</Notice>
                <Button variant="danger" loading={busy} onClick={() => void withdraw(consent.purpose)}>
                  {t('myData.confirmWithdraw')}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>
                  {t('myData.cancel')}
                </Button>
              </div>
            ) : (
              <Button variant="secondary" disabled={busy} onClick={() => setConfirming(consent.purpose)}>
                {t('myData.withdraw')}
              </Button>
            )
          ) : FULL_NOTICE[consent.purpose] ? (
            <Link href={FULL_NOTICE[consent.purpose] ?? '/'} className="inline-flex min-h-12 items-center justify-center rounded-control border border-line-strong px-4 py-2 font-medium">
              {t('myData.reviewNotice')}
            </Link>
          ) : (
            <Button variant="secondary" disabled={busy} onClick={() => void grant(consent)}>
              {t('myData.grant')}
            </Button>
          )}
        </Card>
      ))}

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">{t('myData.grievanceHeading')}</h2>
        <p className="text-sm">{t('myData.grievanceBody')}</p>
      </section>

      <Button variant="ghost" disabled={busy} onClick={() => void signOut()}>
        {t('myData.signOut')}
      </Button>
    </Screen>
  );
}
