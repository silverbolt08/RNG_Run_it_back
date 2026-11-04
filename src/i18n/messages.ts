import en from './en.json';
import hi from './hi.json';

export const LOCALES = ['en', 'hi'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'udyam_locale';

type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

export type MessageKey = Paths<typeof en>;
export type MessageParams = Readonly<Record<string, string | number>>;

const CATALOGUES: Readonly<Record<Locale, unknown>> = { en, hi };

function lookup(catalogue: unknown, key: string): string | null {
  let node: unknown = catalogue;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return null;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : null;
}

/** Falls back to English, then to the key, so a missing translation can't blank a screen. */
export function translate(locale: Locale, key: string, params: MessageParams = {}): string {
  const template = lookup(CATALOGUES[locale], key) ?? lookup(en, key) ?? key;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'hi';
}
