'use client';

import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useLocale } from '@/i18n/locale-provider';
import { LOCALES, type Locale } from '@/i18n/messages';

// Each language is named in its own script, so someone who can't read the current one can still find theirs.
const LANGUAGE_NAMES: Readonly<Record<Locale, string>> = { en: 'English', hi: 'हिन्दी' };

function LanguageSwitcher() {
  const { locale, setLocale, t } = useLocale();
  return (
    <div role="group" aria-label={t('app.languageLabel')} className="flex rounded-control border border-line-strong">
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          lang={option}
          aria-pressed={option === locale}
          onClick={() => setLocale(option)}
          className={`min-h-10 min-w-12 px-2 text-sm font-medium first:rounded-l-control last:rounded-r-control ${option === locale ? 'bg-ink text-surface' : 'bg-surface text-ink'}`}
        >
          {LANGUAGE_NAMES[option]}
        </button>
      ))}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  // Owner screens stay one narrow column. Only the back office needs a table's width.
  const width = usePathname().startsWith('/backoffice') ? 'max-w-[1200px]' : 'max-w-[560px]';
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:p-3">
        {t('app.skipToContent')}
      </a>
      <header className="border-b border-line bg-surface">
        <div className={`mx-auto flex flex-wrap items-center justify-between gap-2 px-4 py-2 ${width}`}>
          <Link href="/" className="text-lg font-bold text-brand-strong">
            {t('app.name')}
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/my-data" className="flex min-h-10 items-center gap-1 px-1 text-sm font-medium underline underline-offset-4">
              <ShieldCheck aria-hidden className="size-4" />
              {t('app.myData')}
            </Link>
            <LanguageSwitcher />
          </div>
        </div>
      </header>
      <main id="main" className={`mx-auto flex w-full grow flex-col px-4 py-4 ${width}`}>
        {children}
      </main>
      <footer className="border-t border-line bg-surface-alt px-4 py-2 text-center text-sm text-ink-muted">{t('app.prototypeBanner')}</footer>
    </div>
  );
}
