'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { CheckboxField, TextField } from '@/components/ui/field';
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
  const [adult, setAdult] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [gstinError, setGstinError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [failedTries, setFailedTries] = useState(0);

  // After the render that marks the fields, so focus lands on the first one with a problem.
  useEffect(() => {
    if (failedTries > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], input[type="checkbox"]:not(:checked)')?.focus();
  }, [failedTries]);
  const [adultError, setAdultError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nameOk = name.trim().length >= 2;
    const gstinOk = gstin.trim() === '' || /^[0-9A-Za-z]{15}$/.test(gstin.trim());
    setNameError(nameOk ? null : t('form.required'));
    setGstinError(gstinOk ? null : t('kyc.gstinInvalid'));
    setAdultError(!adult);
    if (!nameOk || !gstinOk || !adult) {
      setFailedTries((tries) => tries + 1);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      onCreated(
        await api.post<KycApplicationView>('/kyc-applications', {
          quoteId,
          contactName: name.trim(),
          // Sent only once the owner has ticked it, and the server refuses to start without it.
          declaredAdultSignatory: adult,
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
    <form ref={formRef} onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t('kyc.contactTitle')}</h2>
      <TextField label={t('kyc.contactName')} hint={t('kyc.contactIntro')} autoComplete="name" maxLength={120} value={name} error={nameError} onChange={(event) => setName(event.target.value)} />
      <TextField label={t('kyc.gstin')} hint={t('kyc.gstinHint')} autoComplete="off" autoCapitalize="characters" maxLength={15} className="font-mono" value={gstin} error={gstinError} onChange={(event) => setGstin(event.target.value)} />
      <TextField label={t('kyc.businessName')} hint={t('kyc.businessNameHint')} autoComplete="organization" maxLength={160} value={business} onChange={(event) => setBusiness(event.target.value)} />
      <CheckboxField label={t('kyc.consentAdult')} checked={adult} onChange={setAdult} />
      {adultError && !adult ? <Notice tone="danger" live>{t('kyc.adultRequired')}</Notice> : null}
      {error ? <Notice tone="danger" live>{error}</Notice> : null}
      <Button type="submit" fullWidth loading={busy}>
        {t('kyc.continue')}
      </Button>
    </form>
  );
}
