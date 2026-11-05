'use client';

import { CalendarClock } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Notice, Skeleton } from '@/components/ui/feedback';
import { Card, Screen, Section } from '@/components/ui/layout';
import { Stepper, type Step, type StepStatus } from '@/components/ui/stepper';
import { useLocale } from '@/i18n/locale-provider';
import { api, ensureSession, formatDate } from '@/lib/api-client';
import { formatInr } from '@/lib/money';
import type { OrderView } from '@/server/services/order-view';
import { useErrorMessage } from '../shell/use-error-message';

export function TrackerScreen({ orderId }: { orderId: string }) {
  const { t, tDynamic, locale } = useLocale();
  const errorMessage = useErrorMessage();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [paying, setPaying] = useState<'SUCCESS' | 'FAILURE' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    await ensureSession();
    setOrder(await api.get<OrderView>(`/orders/${orderId}`));
  }, [orderId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load awaits first, so nothing is set during the effect itself.
    load().catch((caught: unknown) => setError(errorMessage(caught)));
  }, [load, errorMessage]);

  const pay = async (simulate: 'SUCCESS' | 'FAILURE') => {
    setPaying(simulate);
    setError(null);
    try {
      setOrder(await api.post<OrderView>(`/orders/${orderId}/payment-attempts`, { simulate }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPaying(null);
    }
  };

  if (!order) {
    if (!error) return <Skeleton label={t('app.loading')} />;
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="danger" live>
          {error}
        </Notice>
        <Link href="/sign-in" className="inline-flex min-h-12 items-center justify-center rounded-control border border-line-strong px-4 py-2 font-medium">
          {t('home.signInTitle')}
        </Link>
      </div>
    );
  }

  const date = (iso: string) => formatDate(iso, locale);
  const paymentFailed = order.payment.status === 'FAILED';
  const steps: Step[] = order.stages.map((stage) => {
    const status = stage.status as StepStatus;
    return {
      key: stage.stage,
      label: tDynamic(`tracker.stage.${stage.stage}`),
      status,
      statusLabel: tDynamic(`tracker.stageStatus.${status}`),
      date: date(stage.expectedDate),
    };
  });

  const cancelled = order.status === 'CANCELLED';
  const activated = order.stage === 'ACTIVATED';
  const owesPayment = order.next?.actor === 'OWNER';
  const statusMessages = order.statusMessages;

  return (
    <Screen title={t('tracker.title')}>
      {error ? <Notice tone="danger" live>{error}</Notice> : null}

      {cancelled ? (
        <div className="flex flex-col gap-3">
          <Notice tone="danger" title={t('tracker.cancelled')}>
            {t('tracker.cancelledBody')}
          </Notice>
          <Link href="/" className="inline-flex min-h-12 items-center justify-center rounded-control border border-line-strong px-4 py-2 font-medium">
            {t('tracker.startAgain')}
          </Link>
        </div>
      ) : null}
      {activated ? <Notice tone="success" live title={t('tracker.activated')} /> : null}

      {order.next ? (
        <Card selected className="flex flex-col gap-2" >
          <h2 className="text-sm font-semibold text-brand-strong">{t('tracker.nextHeading')}</h2>
          <p className="text-xl font-semibold leading-7" data-testid="tracker-next">
            {tDynamic(`tracker.action.${order.next.action}`)}
          </p>
          <p className="flex items-center gap-2 tabular-nums">
            <CalendarClock aria-hidden className="size-5 shrink-0" />
            {t('tracker.by', { date: date(order.next.expectedDate) })}
          </p>
          <p className="text-sm">{t('tracker.expected', { date: date(order.expectedActivationDate) })}</p>
        </Card>
      ) : null}

      {order.delay ? (
        <Notice tone="warning" title={t('tracker.delayTitle')}>
          <p>{tDynamic(`tracker.delayReason.${order.delay.reason}`)}</p>
          <p>{t('tracker.delayBody', { date: date(order.delay.newDate), previous: date(order.delay.previousDate) })}</p>
          {order.alternativeProductIds.length > 0 ? <p className="mt-1">{t('tracker.airFiberOffer', { name: 'Biz 5G AirFiber 100' })}</p> : null}
        </Notice>
      ) : null}

      {cancelled ? null : (
        <Section title={t('tracker.paymentHeading')}>
          {order.payment.status === 'PAID' ? (
            <div>
              <Badge tone="success">{t('tracker.paid', { amount: formatInr(order.payment.amountDueInr) })}</Badge>
            </div>
          ) : (
            <Card className="flex flex-col gap-3">
              <p className="font-medium tabular-nums">{t('tracker.paymentAmount', { amount: formatInr(order.payment.amountDueInr) })}</p>
              {paymentFailed ? <Notice tone="danger" live>{t('tracker.paymentFailed')}</Notice> : null}
              {order.kycUnderReview ? <Notice tone="neutral">{t('tracker.underReview')}</Notice> : null}
              {owesPayment ? (
                <>
                  <p className="text-sm text-ink-muted">{t('tracker.paymentMock')}</p>
                  <Button fullWidth loading={paying === 'SUCCESS'} disabled={paying !== null} onClick={() => void pay('SUCCESS')}>
                    {t('tracker.payWorks')}
                  </Button>
                  <Button fullWidth variant="secondary" loading={paying === 'FAILURE'} disabled={paying !== null} onClick={() => void pay('FAILURE')}>
                    {t('tracker.payFails')}
                  </Button>
                </>
              ) : null}
            </Card>
          )}
        </Section>
      )}

      {cancelled ? null : (
      <Section title={t('tracker.stagesHeading')}>
        <Stepper steps={steps} />
        <p className="text-sm text-ink-muted">{t('tracker.dateNote')}</p>
      </Section>
      )}

      {cancelled ? null : (
      <Section title={t('tracker.productsHeading')}>
        <ul className="flex flex-col gap-2">
          {order.products.map((product) => (
            <li key={product.productId} className="flex flex-wrap justify-between gap-x-3 border-b border-line pb-2 last:border-b-0">
              <span className="font-medium">{product.name}</span>
              <span className="text-sm tabular-nums text-ink-muted">{t('tracker.productDate', { date: date(product.expectedDate) })}</span>
            </li>
          ))}
        </ul>
        <p className="font-medium tabular-nums">{t('tracker.summaryMonthly', { amount: formatInr(order.monthlyFinalInr) })}</p>
        <p className="text-sm">{t('tracker.summaryContract', { months: order.contractMonths })}</p>
      </Section>
      )}

      <Section title={t('tracker.updatesHeading')}>
        {statusMessages.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('tracker.updatesEmpty')}</p>
        ) : (
          <>
            <ul className="flex flex-col gap-1 text-sm">
              {statusMessages.map((message, index) => {
                const params = message.params as Record<string, string>;
                const stage = params.stage ? tDynamic(`tracker.stage.${params.stage}`) : '';
                const newDate = params.newDate ? date(params.newDate) : '';
                return <li key={index}>{tDynamic(`tracker.update.${message.templateCode}`, { stage, date: newDate })}</li>;
              })}
            </ul>
            <p className="text-sm text-ink-muted">{t('tracker.updatesMock')}</p>
          </>
        )}
      </Section>
    </Screen>
  );
}
