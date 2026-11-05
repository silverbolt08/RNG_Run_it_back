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
      }
      return t('app.genericError');
    },
    [t],
  );
}
