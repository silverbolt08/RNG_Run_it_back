'use client';

import { Ban } from 'lucide-react';
import { Card } from '@/components/ui/layout';
import { Notice } from '@/components/ui/feedback';
import { useLocale } from '@/i18n/locale-provider';
import { daysText, monthsText } from '@/i18n/units';
import { formatInr } from '@/lib/money';
import type { Recommendation } from '@/server/services/advisor/reply-plan';
import { blockerText } from '../quote/blocker-text';

type Line = Recommendation['lines'][number];

const reasonKey = (line: Line) => `reason.${line.reason.kind === 'NEED' ? line.reason.need : line.reason.kind}`;

/** Every figure and name here comes from code, whatever the advisor's sentence around it says. */
export function BundleCard({ recommendation }: { recommendation: Recommendation }) {
  const { t, tDynamic } = useLocale();
  const { lines, blocked, quote, alternativeNames } = recommendation;

  if (lines.length === 0 && blocked.length === 0) return <Notice tone="neutral">{t('advisor.emptyBundle')}</Notice>;

  return (
    <div className="flex flex-col gap-3" data-testid="bundle-card">
      {lines.length > 0 ? (
        <Card selected className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t('advisor.bundleTitle')}</h2>
          <ul className="flex flex-col gap-2">
            {lines.map((line) => (
              <li key={line.productId} className="flex flex-col">
                <span className="font-medium">
                  {line.quantity > 1 ? `${line.quantity} × ` : ''}
                  {line.name}
                </span>
                <span className="text-sm text-ink-muted">{tDynamic(reasonKey(line))}</span>
              </li>
            ))}
          </ul>
          <div className="border-t border-brand-strong pt-3">
            <p className="text-[28px] font-bold leading-9 tabular-nums">{formatInr(quote.monthlyFinalInr)}</p>
            <p className="text-sm">{t('advisor.monthly')}</p>
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
            <dt>{t('advisor.setup')}</dt>
            <dd className="text-right tabular-nums">{formatInr(quote.setupFinalInr)}</dd>
            <dt>{t('advisor.contract')}</dt>
            <dd className="text-right">{monthsText(t, quote.contractMonths)}</dd>
            <dt>{t('advisor.install')}</dt>
            <dd className="text-right">{daysText(t, quote.installDays)}</dd>
          </dl>
        </Card>
      ) : null}

      {blocked.length > 0 ? (
        <Card className="flex flex-col gap-2">
          <h2 className="font-semibold">{t('advisor.blockedTitle')}</h2>
          <ul className="flex flex-col gap-3">
            {blocked.map((item) => (
              <li key={item.productId} className="flex gap-2">
                <Ban aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-muted" />
                <div className="flex flex-col">
                  <span className="font-medium">{item.name}</span>
                  <span className="text-sm text-ink-muted">{item.blockers[0] ? blockerText(tDynamic, item.blockers[0], alternativeNames) : null}</span>
                  {item.alternatives.length > 0 ? (
                    <span className="text-sm">
                      {t('quote.alternatives', {
                        names: item.alternatives.map((id) => alternativeNames[id] ?? '').filter(Boolean).join(' + '),
                      })}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
