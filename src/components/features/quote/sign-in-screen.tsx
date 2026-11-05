'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Screen } from '@/components/ui/layout';
import { useLocale } from '@/i18n/locale-provider';
import { ensureSession } from '@/lib/api-client';
import { PhoneStep } from './phone-step';

/** The way back for an owner who signed out or changed phone, so an order is never out of reach. */
export function SignInScreen() {
  const { t } = useLocale();
  const router = useRouter();

  useEffect(() => {
    void ensureSession();
  }, []);

  return (
    <Screen title={t('home.signInTitle')}>
      <p className="text-ink-muted">{t('home.signInBody')}</p>
      <PhoneStep onVerified={() => router.push('/')} />
    </Screen>
  );
}
