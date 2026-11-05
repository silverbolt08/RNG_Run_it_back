'use client';

import { useCallback } from 'react';
import { useLocale } from '@/i18n/locale-provider';
import { ApiFailure, NETWORK_FAILURE } from '@/lib/api-client';

/** Turns any failure into words the owner can act on. Codes and raw errors never reach the screen. */
export function useErrorMessage(): (error: unknown) => string {
  const { t } = useLocale();
  return useCallback(
    (error: unknown) => {
      if (error instanceof ApiFailure) {
        if (error.code === NETWORK_FAILURE) return t('app.offlineError');
        if (error.status === 429) return t('app.rateLimited');
        // Saying "your progress is saved" here would be false: withdrawing can delete it.
        if (error.code === 'CONSENT_REQUIRED') return t('app.consentNeeded');
        if (error.status === 404) return t('app.notFound');
      }
      return t('app.genericError');
    },
    [t],
  );
}
