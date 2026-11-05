import type { MessageParams } from './messages';

type Translate = (key: 'units.oneDay' | 'units.days' | 'units.oneMonth' | 'units.months', params?: MessageParams) => string;

/** "1 day" and "5 days", worded per language. */
export function daysText(t: Translate, count: number): string {
  return count === 1 ? t('units.oneDay') : t('units.days', { count });
}

export function monthsText(t: Translate, count: number): string {
  return count === 1 ? t('units.oneMonth') : t('units.months', { count });
}
