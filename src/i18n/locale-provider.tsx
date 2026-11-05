'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, useState, useTransition, type ReactNode } from 'react';
import { LOCALE_COOKIE, translate, type Locale, type MessageKey, type MessageParams } from './messages';

const ONE_YEAR_SECONDS = 31_536_000;

type LocaleContextValue = {
  locale: Locale;
  setLocale(locale: Locale): void;
  /** A checked key, for wording that is written out in the code. */
  t(key: MessageKey, params?: MessageParams): string;
  /** A key built from a value the server sent, such as `kyc.check.${id}`. */
  tDynamic(key: string, params?: MessageParams): string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState(initialLocale);
  const router = useRouter();
  const [, startTransition] = useTransition();

  const setLocale = useCallback(
    (next: Locale) => {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
      document.documentElement.lang = next;
      setLocaleState(next);
      startTransition(() => router.refresh());
    },
    [router],
  );

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
      tDynamic: (key, params) => translate(locale, key, params),
    }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocale needs a LocaleProvider');
  return value;
}
