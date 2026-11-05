'use client';

import { Check } from 'lucide-react';
import { useState } from 'react';
import type { AdvisorSlot } from '@/domain/advisor/advisor-facts';
import type { Need } from '@/domain/bundle/recommend-bundle';
import type { SlotAnswer } from '@/domain/advisor/slot-answers';
import { useLocale } from '@/i18n/locale-provider';
import type { MessageKey } from '@/i18n/messages';

type Choice = { labelKey: MessageKey; answer: SlotAnswer };

const CHOICES: Partial<Record<AdvisorSlot, readonly Choice[]>> = {
  BUSINESS: [
    { labelKey: 'advisor.chip.SHOP', answer: { slot: 'BUSINESS', value: 'SHOP' } },
    { labelKey: 'advisor.chip.OFFICE', answer: { slot: 'BUSINESS', value: 'OFFICE' } },
    { labelKey: 'advisor.chip.CHAIN', answer: { slot: 'BUSINESS', value: 'CHAIN' } },
    { labelKey: 'advisor.chip.FACTORY', answer: { slot: 'BUSINESS', value: 'FACTORY' } },
  ],
  CITY_TIER: [
    { labelKey: 'advisor.chip.TIER_1', answer: { slot: 'CITY_TIER', value: 1 } },
    { labelKey: 'advisor.chip.TIER_2', answer: { slot: 'CITY_TIER', value: 2 } },
    { labelKey: 'advisor.chip.TIER_3', answer: { slot: 'CITY_TIER', value: 3 } },
    { labelKey: 'advisor.chip.DECLINE', answer: { slot: 'CITY_TIER', value: 'DECLINED' } },
  ],
  // Each range starts at a size a catalogue rule cares about, so a tap can't cross a boundary.
  EMPLOYEES: [
    { labelKey: 'advisor.chip.EMPLOYEES_1', answer: { slot: 'EMPLOYEES', value: 2 } },
    { labelKey: 'advisor.chip.EMPLOYEES_3', answer: { slot: 'EMPLOYEES', value: 3 } },
    { labelKey: 'advisor.chip.EMPLOYEES_5', answer: { slot: 'EMPLOYEES', value: 5 } },
    { labelKey: 'advisor.chip.EMPLOYEES_10', answer: { slot: 'EMPLOYEES', value: 10 } },
    { labelKey: 'advisor.chip.EMPLOYEES_25', answer: { slot: 'EMPLOYEES', value: 25 } },
    { labelKey: 'advisor.chip.DECLINE', answer: { slot: 'EMPLOYEES', value: 'DECLINED' } },
  ],
  SITES: [
    { labelKey: 'advisor.chip.SITES_1', answer: { slot: 'SITES', value: 1 } },
    { labelKey: 'advisor.chip.SITES_2', answer: { slot: 'SITES', value: 2 } },
    { labelKey: 'advisor.chip.SITES_3', answer: { slot: 'SITES', value: 3 } },
    { labelKey: 'advisor.chip.SITES_5', answer: { slot: 'SITES', value: 5 } },
    { labelKey: 'advisor.chip.SITES_8', answer: { slot: 'SITES', value: 8 } },
    { labelKey: 'advisor.chip.DECLINE', answer: { slot: 'SITES', value: 'DECLINED' } },
  ],
  GSTIN: [
    { labelKey: 'advisor.chip.GST_ACTIVE', answer: { slot: 'GSTIN', value: 'ACTIVE' } },
    { labelKey: 'advisor.chip.GST_NONE', answer: { slot: 'GSTIN', value: 'NONE' } },
    { labelKey: 'advisor.chip.GST_CANCELLED', answer: { slot: 'GSTIN', value: 'CANCELLED' } },
    { labelKey: 'advisor.chip.GST_SUSPENDED', answer: { slot: 'GSTIN', value: 'SUSPENDED' } },
    { labelKey: 'advisor.chip.DECLINE', answer: { slot: 'GSTIN', value: 'UNKNOWN' } },
  ],
  FIBRE: [
    { labelKey: 'advisor.chip.YES', answer: { slot: 'FIBRE', value: true } },
    { labelKey: 'advisor.chip.NO', answer: { slot: 'FIBRE', value: false } },
    { labelKey: 'advisor.chip.NOT_SURE', answer: { slot: 'FIBRE', value: 'DECLINED' } },
  ],
};

// The needs most owners have, so the list stays short on a phone. Typing reaches the rest.
export const COMMON_NEEDS: readonly Need[] = ['UPTIME', 'CUSTOMER_OUTREACH', 'GUEST_WIFI', 'POS', 'CCTV', 'EMAIL', 'SECURITY', 'PHONE_LINES', 'WEBSITE', 'BUSINESS_CALLS', 'BACKUP'];

const CHIP = 'min-h-12 rounded-pill border border-line-strong bg-surface px-4 py-2 text-left font-medium hover:bg-surface-alt disabled:opacity-50';

export function SlotChoices({
  slot,
  disabled,
  onAnswer,
}: {
  slot: AdvisorSlot;
  disabled: boolean;
  onAnswer(answer: SlotAnswer, label: string): void;
}) {
  const { t, tDynamic } = useLocale();
  const [picked, setPicked] = useState<readonly Need[]>([]);

  if (slot === 'NEEDS') {
    const finish = () => {
      const label = picked.length > 0 ? picked.map((need) => tDynamic(`need.${need}`)).join(', ') : t('advisor.chip.NEEDS_NONE');
      onAnswer({ slot: 'NEEDS', value: picked }, label);
      setPicked([]);
    };
    return (
      <div className="flex flex-col gap-2">
        <div role="group" aria-label={t('advisor.ask.NEEDS')} className="flex flex-wrap gap-2">
          {COMMON_NEEDS.map((need) => {
            const on = picked.includes(need);
            return (
              <button
                key={need}
                type="button"
                aria-pressed={on}
                disabled={disabled}
                onClick={() => setPicked(on ? picked.filter((item) => item !== need) : [...picked, need])}
                className={`${CHIP} inline-flex items-center gap-1 ${on ? 'border-brand-strong bg-brand-tint text-brand-strong' : ''}`}
              >
                {on ? <Check aria-hidden className="size-4" /> : null}
                {tDynamic(`need.${need}`)}
              </button>
            );
          })}
        </div>
        <button type="button" disabled={disabled} onClick={finish} className={`${CHIP} self-start border-ink bg-ink text-surface hover:bg-ink`}>
          {picked.length > 0 ? t('advisor.needsDone') : t('advisor.chip.NEEDS_NONE')}
        </button>
      </div>
    );
  }

  const choices = CHOICES[slot];
  if (!choices) return null;

  return (
    <div role="group" aria-label={tDynamic(`advisor.ask.${slot}`)} className="flex flex-wrap gap-2">
      {choices.map((choice) => (
        <button key={choice.labelKey} type="button" disabled={disabled} onClick={() => onAnswer(choice.answer, t(choice.labelKey))} className={CHIP}>
          {t(choice.labelKey)}
        </button>
      ))}
    </div>
  );
}
