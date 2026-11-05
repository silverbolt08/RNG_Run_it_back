'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { Notice } from '@/components/ui/feedback';
import { useLocale } from '@/i18n/locale-provider';
import { api } from '@/lib/api-client';
import type { KycApplicationView } from '@/server/services/kyc/kyc-view';
import { useErrorMessage } from '../shell/use-error-message';

/** Each field is here for a reason: the name checks the ID, and the rest only help when there's no certificate. */
export function ContactStep({ quoteId, onCreated }: { quoteId: string; onCreated(application: KycApplicationView): void }) {
  const { t } = useLocale();
  const errorMessage = useErrorMessage();
  const [name, setName] = useState('');
  const [gstin, setGstin] = useState('');
  const [business, setBusiness] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2) {
      setNameError(t('form.required'));
      return;
    }
    setNameError(null);
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await api.post<KycApplicationView>('/kyc-applications', {
          quoteId,
          contactName: name.trim(),
          declaredAdultSignatory: true,
          ...(gstin.trim() ? { gstin: gstin.trim() } : {}),
          ...(business.trim() ? { businessName: business.trim() } : {}),
        }),
      );
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t('kyc.contactTitle')}</h2>
      <TextField label={t('kyc.contactName')} hint={t('kyc.contactIntro')} autoComplete="name" value={name} error={nameError} onChange={(event) => setName(event.target.value)} />
      <TextField label={t('kyc.gstin')} hint={t('kyc.gstinHint')} autoComplete="off" autoCapitalize="characters" maxLength={15} className="font-mono" value={gstin} onChange={(event) => setGstin(event.target.value)} />
      <TextField label={t('kyc.businessName')} hint={t('kyc.businessNameHint')} autoComplete="organization" value={business} onChange={(event) => setBusiness(event.target.value)} />
      {error ? <Notice tone="danger" live>{error}</Notice> : null}
      <Button type="submit" fullWidth loading={busy}>
        {t('kyc.continue')}
      </Button>
    </form>
  );
}
