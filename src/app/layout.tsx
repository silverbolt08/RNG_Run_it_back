import type { Metadata, Viewport } from 'next';
import { Poppins } from 'next/font/google';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/features/shell/app-shell';
import en from '@/i18n/en.json';
import { LocaleProvider } from '@/i18n/locale-provider';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from '@/i18n/messages';
import './globals.css';

// Poppins covers both Latin and Devanagari, so one font serves English and Hindi.
const poppins = Poppins({
  subsets: ['latin', 'devanagari'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-poppins',
});

export const metadata: Metadata = {
  title: en.app.name,
  description: en.app.tagline,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;

  return (
    <html lang={locale} className={poppins.variable}>
      <body>
        <LocaleProvider initialLocale={locale}>
          <AppShell>{children}</AppShell>
        </LocaleProvider>
      </body>
    </html>
  );
}
