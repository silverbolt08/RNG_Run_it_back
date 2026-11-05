'use client';

import { Lock, Minus, Plus } from 'lucide-react';
import { Card } from '@/components/ui/layout';
import { Toggle } from '@/components/ui/toggle';
import { useLocale } from '@/i18n/locale-provider';
import { formatInr } from '@/lib/money';
import type { QuoteLineView } from '@/server/services/quote-view';
import type { listAddOns } from '@/server/services/add-on-service';
import { blockerText } from './blocker-text';

export type AddOns = Awaited<ReturnType<typeof listAddOns>>;
export type AddOn = AddOns['items'][number];

function QuantityStepper({ line, disabled, onChange }: { line: QuoteLineView; disabled: boolean; onChange(quantity: number): void }) {
  const { t } = useLocale();
  const button = 'flex size-12 items-center justify-center rounded-control border border-line-strong disabled:opacity-40';
  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label={t('quote.decrease', { name: line.name })} disabled={disabled || line.quantity <= 1} onClick={() => onChange(line.quantity - 1)} className={button}>
        <Minus aria-hidden className="size-5" />
      </button>
      <span aria-live="polite" className="min-w-8 text-center font-semibold tabular-nums">
        <span className="sr-only">{t('quote.quantity')} </span>
        {line.quantity}
      </span>
      <button type="button" aria-label={t('quote.increase', { name: line.name })} disabled={disabled} onClick={() => onChange(line.quantity + 1)} className={button}>
        <Plus aria-hidden className="size-5" />
      </button>
    </div>
  );
}

export function BundleLineRow({
  line,
  locked,
  busy,
  onQuantity,
  onRemove,
}: {
  line: QuoteLineView;
  locked: boolean;
  busy: boolean;
  onQuantity(quantity: number): void;
  onRemove(): void;
}) {
  const { t, tDynamic } = useLocale();
  return (
    <Card className="flex flex-col gap-2" >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="font-semibold">{line.name}</span>
          <span className="text-sm text-ink-muted">{tDynamic(`productText.${line.productId}`)}</span>
        </div>
        {locked ? null : <Toggle checked label={line.name} disabled={busy} onChange={onRemove} />}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="font-medium tabular-nums">{t('quote.perMonth', { price: formatInr(line.monthlyInr) })}</span>
          <span className="text-sm text-ink-muted tabular-nums">
            {t('quote.unit', { price: formatInr(line.unitPriceInr), unit: tDynamic(`quote.perUnit.${line.unit}`) })}
          </span>
        </div>
        {locked ? <span className="font-medium tabular-nums">× {line.quantity}</span> : <QuantityStepper line={line} disabled={busy} onChange={onQuantity} />}
      </div>
    </Card>
  );
}

export function AddOnRow({ addOn, names, busy, onAdd }: { addOn: AddOn; names: AddOns['names']; busy: boolean; onAdd(): void }) {
  const { t, tDynamic } = useLocale();
  const blocker = addOn.blockers[0];
  return (
    <li className="flex items-start justify-between gap-2 border-b border-line py-2 last:border-b-0">
      <div className="flex min-w-0 flex-col">
        <span className={`font-medium ${addOn.eligible ? '' : 'text-ink-muted'}`}>{addOn.name}</span>
        <span className="text-sm text-ink-muted">{tDynamic(`productText.${addOn.productId}`)}</span>
        <span className="text-sm tabular-nums">{t('quote.unit', { price: formatInr(addOn.unitPriceInr), unit: tDynamic(`quote.perUnit.${addOn.unit}`) })}</span>
        {!addOn.eligible && blocker ? (
          <span className="mt-1 flex items-start gap-1 text-sm font-medium text-warning">
            <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t('quote.blockedBecause', { reason: blockerText(tDynamic, blocker, names) })}
          </span>
        ) : null}
        {!addOn.eligible && addOn.alternatives.length > 0 ? (
          <span className="text-sm">{t('quote.alternatives', { names: addOn.alternatives.map((id) => names[id] ?? '').filter(Boolean).join(' + ') })}</span>
        ) : null}
      </div>
      <Toggle checked={false} label={addOn.name} disabled={busy || !addOn.eligible} onChange={onAdd} />
    </li>
  );
}
