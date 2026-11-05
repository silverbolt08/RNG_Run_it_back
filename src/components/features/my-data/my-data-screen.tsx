'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge, Notice, Skeleton, type Tone } from '@/components/ui/feedback';
import { Card, Screen } from '@/components/ui/layout';
import { useLocale } from '@/i18n/locale-provider';
import { api, ensureSession } from '@/lib/api-client';
import { useErrorMessage } from '../shell/use-error-message';

type Consent = { purpose: string; status: string; currentNoticeVersion: string };
type Session = { phoneVerified: boolean; phoneMasked: string | null };
type Withdrawal = { effects?: { documentsDeleted?: number; ordersCancelled?: number } };

const STATUS_TONE: Readonly<Record<string, Tone>> = { GRANTED: 'success', NOTICE_CHANGED: 'warning', NOT_ASKED: 'neutral', WITHDRAWN: 'neutral', ERASED: 'neutral' };

/** Withdrawing is as easy as granting: one tap to see the effect, and one to confirm it. */
export function MyDataScreen() {
  const { t, tDynamic, locale } = useLocale();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [consents, setConsents] = useState<Consent[] | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    await ensureSession();
    const [list, current] = await Promise.all([api.get<{ items: Consent[] }>('/consents'), api.get<Session>('/sessions/current')]);
    setConsents(list.items);
    setSession(current);
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
          ) : (
            <Button variant="secondary" disabled={busy} onClick={() => void grant(consent)}>
              {t('myData.grant')}
            </Button>
          )}
        </Card>
      ))}

      <Button variant="ghost" disabled={busy} onClick={() => void signOut()}>
        {t('myData.signOut')}
      </Button>
    </Screen>
  );
}
