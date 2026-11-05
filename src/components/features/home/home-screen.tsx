'use client';

import { BadgeIndianRupee, FileCheck2, MapPinned } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/field';
import { Notice } from '@/components/ui/feedback';
import { Card, StickyBar } from '@/components/ui/layout';
import { useLocale } from '@/i18n/locale-provider';
import { api, ensureSession } from '@/lib/api-client';
import { useErrorMessage } from '../shell/use-error-message';

type ConsentItem = { purpose: string; status: string; currentNoticeVersion: string };
type Journey = { phoneVerified: boolean; journey: { quoteId: string | null; kycApplicationId: string | null; orderId: string | null; orderForQuote: boolean } };

const POINTS = [
  { icon: BadgeIndianRupee, key: 'home.point1' },
  { icon: FileCheck2, key: 'home.point2' },
  { icon: MapPinned, key: 'home.point3' },
] as const;

/**
 * Two separate agreements. The short form needs only the first, so an owner who doesn't want an
 * outside AI service reading their words can still buy.
 */
export function HomeScreen() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const errorMessage = useErrorMessage();

  const [consents, setConsents] = useState<ConsentItem[] | null>(null);
  const [resume, setResume] = useState<string | null>(null);
  const [olderOrder, setOlderOrder] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [agreedBusiness, setAgreedBusiness] = useState(false);
  const [agreedAi, setAgreedAi] = useState(false);
  const [busy, setBusy] = useState<'advisor' | 'form' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      await ensureSession();
      const [list, current] = await Promise.all([
        api.get<{ items: ConsentItem[] }>('/consents'),
        api.get<Journey>('/sessions/current'),
      ]);
      if (!active) return;
      setConsents(list.items);
      const { orderId, kycApplicationId, quoteId, orderForQuote } = current.journey;
      // The newest work first. An older order stays one link away.
      setResume(orderForQuote && orderId ? `/orders/${orderId}` : kycApplicationId ? '/verify' : quoteId ? '/quote' : null);
      setOlderOrder(orderId && !orderForQuote ? `/orders/${orderId}` : null);
      setSignedIn(current.phoneVerified);
    })().catch((caught: unknown) => {
      if (active) setError(errorMessage(caught));
    });
    return () => {
      active = false;
    };
  }, [errorMessage]);

  const consentFor = (purpose: string) => consents?.find((item) => item.purpose === purpose);
  const hasBusiness = consentFor('advisor_profile')?.status === 'GRANTED';
  const hasAi = consentFor('ai_chat')?.status === 'GRANTED';

  const grant = async (purpose: string) => {
    const item = consentFor(purpose);
    if (item) await api.post('/consents', { purpose, noticeVersion: item.currentNoticeVersion, language: locale });
  };

  const go = async (target: 'advisor' | 'form') => {
    setBusy(target);
    setError(null);
    try {
      if (!hasBusiness) await grant('advisor_profile');
      if (target === 'advisor' && !hasAi) await grant('ai_chat');
      router.push(target === 'advisor' ? '/advisor' : '/advisor/form');
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(null);
    }
  };

  const canUseForm = consents !== null && (hasBusiness || agreedBusiness);
  const canUseAdvisor = canUseForm && (hasAi || agreedAi);

  return (
    <div className="flex grow flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-[28px] font-bold leading-9">{t('home.title')}</h1>
        <p className="text-ink-muted">{t('home.intro')}</p>
      </div>

      <ul className="flex flex-col gap-3">
        {POINTS.map(({ icon: Icon, key }) => (
          <li key={key} className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-brand-tint">
              <Icon aria-hidden className="size-5 text-brand-strong" />
            </span>
            {t(key)}
          </li>
        ))}
      </ul>

      {error ? <Notice tone="danger" live>{error}</Notice> : null}

      {resume ? (
        <Link href={resume} className="inline-flex min-h-12 items-center justify-center rounded-control border border-line-strong px-4 py-2 font-medium">
          {t('home.resume')}
        </Link>
      ) : null}

      {olderOrder ? (
        <Link href={olderOrder} className="inline-flex min-h-12 items-center justify-center rounded-control border border-line-strong px-4 py-2 font-medium">
          {t('home.trackOrder')}
        </Link>
      ) : null}

      {consents !== null && !signedIn ? (
        <Link href="/sign-in" className="inline-flex min-h-12 items-center justify-center font-medium underline underline-offset-4">
          {t('home.signInLink')}
        </Link>
      ) : null}

      {hasBusiness && hasAi ? null : (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t('home.noticeTitle')}</h2>
          {hasBusiness ? null : (
            <>
              <p className="text-sm">{t('home.noticeBody')}</p>
              <p className="text-sm">{t('home.noticeNoId')}</p>
              <CheckboxField label={t('home.noticeAgree')} checked={agreedBusiness} onChange={setAgreedBusiness} />
            </>
          )}
          {hasAi ? null : (
            <>
              <p className="text-sm">{t('home.noticeLlm')}</p>
              <CheckboxField label={t('home.noticeLlmAgree')} checked={agreedAi} onChange={setAgreedAi} />
            </>
          )}
          <p className="text-sm text-ink-muted">{t('home.noticeWithdraw')}</p>
        </Card>
      )}

      <div className="grow" />
      <StickyBar>
        <Button fullWidth disabled={!canUseAdvisor} loading={busy === 'advisor'} onClick={() => void go('advisor')}>
          {t('home.start')}
        </Button>
        <Button fullWidth variant="secondary" disabled={!canUseForm} loading={busy === 'form'} onClick={() => void go('form')}>
          {t('home.useForm')}
        </Button>
      </StickyBar>
    </div>
  );
}
