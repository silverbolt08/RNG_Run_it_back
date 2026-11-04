import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import en from '@/i18n/en.json';
import './globals.css';

export const metadata: Metadata = {
  title: en.app.name,
  description: en.app.tagline,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
