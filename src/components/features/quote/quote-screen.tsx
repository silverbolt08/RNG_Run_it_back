'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Notice, Skeleton } from '@/components/ui/feedback';
import { Card, Screen, Section, StickyBar } from '@/components/ui/layout';
import { useLocale } from '@/i18n/locale-provider';
import { daysText, monthsText } from '@/i18n/units';
import { api, ApiFailure, ensureSession } from '@/lib/api-client';
import { formatInr } from '@/lib/money';
import type { QuoteView } from '@/server/services/quote-view';
import { useErrorMessage } from '../shell/use-error-message';
import { blockerText } from './blocker-text';
import { PhoneStep } from './phone-step';
import { AddOnRow, BundleLineRow, type AddOns } from './quote-lines';

type SessionView = { phoneVerified: boolean; journey: { quoteId: string | null } };

/** Says what a change did beyond the price, so a contract jump is never a surprise. */
function ChangeNotices({ quote }: { quote: QuoteView }) {
  const { t, tDynamic } = useLocale();
  const { comparison, stranded, blocked } = quote;
  return (
    <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
      {stranded.length > 0 ? (
        <Notice tone="warning" title={t('quote.strandedTitle')}>
          {t('quote.strandedBody', { names: stranded.map((item) => item.name).join(', ') })}
        </Notice>
      ) : null}
      {comparison?.contractChanged && comparison.contractMonthsAfter > 0 ? (
        <Notice tone="warning">
          {t(comparison.contractMonthsAfter > comparison.contractMonthsBefore ? 'quote.contractChanged' : 'quote.contractReduced', {
            after: monthsText(t, comparison.contractMonthsAfter),
            before: monthsText(t, comparison.contractMonthsBefore),
          })}
        </Notice>
      ) : null}
      {comparison?.installChanged && comparison.installDaysAfter > 0 ? (
        <Notice tone="neutral">{t('quote.installChanged', { after: daysText(t, comparison.installDaysAfter), before: daysText(t, comparison.installDaysBefore) })}</Notice>
      ) : null}
      {blocked.map((item) => (
        <Notice key={item.productId} tone="warning" title={item.name}>
          {item.blockers[0] ? blockerText(tDynamic, item.blockers[0], {}) : null}
        </Notice>
      ))}
    </div>
  );
}

export function QuoteScreen() {
  const { t, tDynamic } = useLocale();
  const router = useRouter();
  const errorMessage = useErrorMessage();

  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [addOns, setAddOns] = useState<AddOns | null>(null);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [noQuote, setNoQuote] = useState(false);
  const [askPhone, setAskPhone] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const totalRef = useRef<HTMLSpanElement>(null);

  const refreshAddOns = useCallback(async (id: string) => setAddOns(await api.get<AddOns>(`/quotes/${id}/add-ons`)), []);

  useEffect(() => {
    (async () => {
      await ensureSession();
      const session = await api.get<SessionView>('/sessions/current');
      setPhoneVerified(session.phoneVerified);
      if (!session.journey.quoteId) {
        setNoQuote(true);
        return;
      }
      const loaded = await api.get<QuoteView>(`/quotes/${session.journey.quoteId}`);
      setQuote(loaded);
      if (loaded.status !== 'ACCEPTED') await refreshAddOns(loaded.id);
    })().catch((caught: unknown) => {
      // Consent lapsed or the notice changed, so the home screen asks again, and links back here.
      if (caught instanceof ApiFailure && caught.code === 'CONSENT_REQUIRED') router.replace('/');
      else setError(errorMessage(caught));
    });
  }, [errorMessage, refreshAddOns, router]);

  const change = async (run: () => Promise<QuoteView>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await run();
      setQuote(updated);
      await refreshAddOns(updated.id);
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setBusy(false);
      // The control that was tapped may be gone once this renders, so keyboard users land on what changed.
      setTimeout(() => {
        if (document.activeElement === document.body) totalRef.current?.focus({ preventScroll: true });
      }, 0);
    }
  };

  const accept = async () => {
    if (!quote) return;
    setAccepting(true);
    setError(null);
    try {
      await api.post(`/quotes/${quote.id}/acceptance`);
      router.push('/verify');
    } catch (caught) {
      if (caught instanceof ApiFailure && caught.code === 'PHONE_VERIFICATION_REQUIRED') setAskPhone(true);
      else setError(errorMessage(caught));
      setAccepting(false);
    }
  };

  const save = async () => {
    if (!quote) return;
    if (await change(() => api.post<QuoteView>(`/quotes/${quote.id}/save`))) setSaved(true);
  };

  const groups = useMemo(() => {
    const byCategory = new Map<string, AddOns['items']>();
    for (const item of addOns?.items ?? []) byCategory.set(item.category, [...(byCategory.get(item.category) ?? []), item]);
    return [...byCategory.entries()];
  }, [addOns]);

  if (noQuote) {
    return (
      <Screen title={t('quote.title')}>
        <Link href="/" className="underline underline-offset-4">
          {t('home.start')}
        </Link>
      </Screen>
    );
  }
  if (!quote) return error ? <Notice tone="danger" live>{error}</Notice> : <Skeleton label={t('app.loading')} />;

  const locked = quote.status === 'ACCEPTED';
  const hasLines = quote.lines.length > 0;

  // One decision per screen. Lower down the page, this opened out of sight and Accept seemed to do nothing.
  if (askPhone && !phoneVerified) {
    return (
      <Screen title={t('quote.title')}>
        {error ? <Notice tone="danger" live>{error}</Notice> : null}
        <PhoneStep
          onVerified={() => {
            setPhoneVerified(true);
            setAskPhone(false);
            void accept();
          }}
        />
        <Button variant="ghost" onClick={() => setAskPhone(false)}>
          {t('app.back')}
        </Button>
      </Screen>
    );
  }

  return (
    <Screen title={t('quote.title')}>
      {locked ? <Notice tone="neutral">{t('quote.locked')}</Notice> : null}
      {quote.status === 'NEEDS_ACCEPTANCE' ? <Notice tone="warning">{t('quote.needsAcceptance')}</Notice> : null}
      <ChangeNotices quote={quote} />
      {error ? <Notice tone="danger" live>{error}</Notice> : null}

      <Section title={t('quote.bundleHeading')}>
        {hasLines ? null : <Notice tone="neutral">{t('quote.empty')}</Notice>}
        {quote.lines.map((line) => (
          <BundleLineRow
            key={line.productId}
            line={line}
            locked={locked}
            busy={busy}
            onQuantity={(quantity) => void change(() => api.put<QuoteView>(`/quotes/${quote.id}/lines/${line.productId}`, { quantity }))}
            onRemove={() => void change(() => api.delete<QuoteView>(`/quotes/${quote.id}/lines/${line.productId}`))}
          />
        ))}
      </Section>

      {!locked && addOns ? (
        <Section title={t('quote.addOnsHeading')}>
          {groups.map(([category, items]) => (
            <Card key={category}>
              <details open={groups.length <= 2}>
                <summary className="flex min-h-10 cursor-pointer items-center font-semibold">{tDynamic(`category.${category}`)}</summary>
                <ul>
                  {items.map((addOn) => (
                    <AddOnRow
                      key={addOn.productId}
                      addOn={addOn}
                      names={addOns.names}
                      busy={busy}
                      onAdd={() => void change(() => api.put<QuoteView>(`/quotes/${quote.id}/lines/${addOn.productId}`, {}))}
                    />
                  ))}
                </ul>
              </details>
            </Card>
          ))}
        </Section>
      ) : null}

      <Section title={t('quote.detailsHeading')}>
        <Card className="flex flex-col gap-1 text-sm tabular-nums">
          <p>{t('quote.beforeGst', { amount: formatInr(quote.monthlyTotalInr), gst: formatInr(quote.monthlyGstInr), rate: quote.gstRatePercent })}</p>
          <p>
            {t('quote.setupLabel')}: {formatInr(quote.setupFinalInr)}
          </p>
          {hasLines ? <p>{t('quote.contract', { months: monthsText(t, quote.contractMonths) })}</p> : null}
          {hasLines ? <p>{t('quote.install', { days: daysText(t, quote.installDays) })}</p> : null}
        </Card>
        {locked ? null : (
          <>
            <p className="text-sm text-ink-muted">{t('quote.acceptNote')}</p>
            <Button fullWidth variant="secondary" disabled={busy} onClick={() => void save()}>
              {t('quote.save')}
            </Button>
          </>
        )}
      </Section>

      {saved ? <Notice tone="success" live>{t('quote.saved')}</Notice> : null}

      <StickyBar>
        <div aria-live="polite" className="flex items-end justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-sm text-ink-muted">{t('quote.monthlyLabel')}</span>
            <span ref={totalRef} tabIndex={-1} data-testid="monthly-total" className="text-[28px] font-bold leading-9 tabular-nums">
              {formatInr(quote.monthlyFinalInr)}
            </span>
          </div>
          <div className="flex flex-col text-right text-sm tabular-nums">
            <span>{t('quote.barSetup', { amount: formatInr(quote.setupFinalInr) })}</span>
            <span>{t('quote.barContract', { months: quote.contractMonths })}</span>
          </div>
        </div>
        {locked ? (
          <Button fullWidth onClick={() => router.push('/verify')}>
            {t('quote.continueKyc')}
          </Button>
        ) : (
          <Button fullWidth disabled={!hasLines || busy} loading={accepting} onClick={() => void accept()}>
            {t('quote.accept')}
          </Button>
        )}
      </StickyBar>
    </Screen>
  );
}
