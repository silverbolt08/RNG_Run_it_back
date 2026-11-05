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
type Journey = { journey: { quoteId: string | null; kycApplicationId: string | null; orderId: string | null } };

const POINTS = [
  { icon: BadgeIndianRupee, key: 'home.point1' },
  { icon: FileCheck2, key: 'home.point2' },
  { icon: MapPinned, key: 'home.point3' },
] as const;

export function HomeScreen() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const errorMessage = useErrorMessage();

  const [consent, setConsent] = useState<ConsentItem | null>(null);
  const [resume, setResume] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState<'advisor' | 'form' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      await ensureSession();
      const [consents, current] = await Promise.all([
        api.get<{ items: ConsentItem[] }>('/consents'),
        api.get<Journey>('/sessions/current'),
      ]);
      if (!active) return;
      setConsent(consents.items.find((item) => item.purpose === 'advisor_profile') ?? null);
      const { orderId, kycApplicationId, quoteId } = current.journey;
      setResume(orderId ? `/orders/${orderId}` : kycApplicationId ? '/verify' : quoteId ? '/quote' : null);
    })().catch((caught: unknown) => {
      if (active) setError(errorMessage(caught));
    });
    return () => {
      active = false;
    };
  }, [errorMessage]);

  const alreadyAgreed = consent?.status === 'GRANTED';

  const go = async (target: 'advisor' | 'form') => {
    setBusy(target);
    setError(null);
    try {
      if (!alreadyAgreed && consent) {
        await api.post('/consents', { purpose: 'advisor_profile', noticeVersion: consent.currentNoticeVersion, language: locale });
      }
      router.push(target === 'advisor' ? '/advisor' : '/advisor/form');
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(null);
    }
  };

  const canStart = alreadyAgreed || (agreed && consent !== null);

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

      {alreadyAgreed ? null : (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t('home.noticeTitle')}</h2>
          <p className="text-sm">{t('home.noticeBody')}</p>
          <p className="text-sm">{t('home.noticeLlm')}</p>
          <p className="text-sm">{t('home.noticeNoId')}</p>
          <CheckboxField label={t('home.noticeAgree')} checked={agreed} onChange={setAgreed} />
          <p className="text-sm text-ink-muted">{t('home.noticeWithdraw')}</p>
        </Card>
      )}

      <div className="grow" />
      <StickyBar>
        <Button fullWidth disabled={!canStart} loading={busy === 'advisor'} onClick={() => void go('advisor')}>
          {t('home.start')}
        </Button>
        <Button fullWidth variant="ghost" disabled={!canStart} loading={busy === 'form'} onClick={() => void go('form')}>
          {t('home.useForm')}
        </Button>
      </StickyBar>
    </div>
  );
}
