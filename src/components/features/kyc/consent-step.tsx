'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/field';
import { Notice } from '@/components/ui/feedback';
import { Card, StickyBar } from '@/components/ui/layout';
import { useLocale } from '@/i18n/locale-provider';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '../shell/use-error-message';

export type ConsentItem = { purpose: string; status: string; currentNoticeVersion: string };

/** Every box starts unticked, and marketing is separate from what verification needs. */
export function ConsentStep({ consents, onDone }: { consents: readonly ConsentItem[]; onDone(): void }) {
  const { t, locale } = useLocale();
  const errorMessage = useErrorMessage();
  const [adult, setAdult] = useState(false);
  const [kyc, setKyc] = useState(false);
  const [updates, setUpdates] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [showRequired, setShowRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grant = async (purpose: string) => {
    const item = consents.find((consent) => consent.purpose === purpose);
    if (!item || item.status === 'GRANTED') return;
    await api.post('/consents', { purpose, noticeVersion: item.currentNoticeVersion, language: locale });
  };

  const submit = async () => {
    if (!adult || !kyc) {
      setShowRequired(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await grant('kyc_verification');
      if (updates) await grant('service_updates');
      if (marketing) await grant('marketing');
      onDone();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t('kyc.consentTitle')}</h2>
        <p>{t('kyc.consentIntro')}</p>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          <li>{t('kyc.consentCollect')}</li>
          <li>{t('kyc.consentWhy')}</li>
          <li>{t('kyc.consentWhere')}</li>
          <li>{t('kyc.consentRetention')}</li>
          <li>{t('kyc.consentRights')}</li>
        </ul>
      </Card>
      <div className="flex flex-col">
        <CheckboxField label={t('kyc.consentAdult')} checked={adult} onChange={setAdult} />
        <CheckboxField label={t('kyc.consentKyc')} checked={kyc} onChange={setKyc} />
        <CheckboxField label={t('kyc.consentUpdates')} checked={updates} onChange={setUpdates} />
        <CheckboxField label={t('kyc.consentMarketing')} checked={marketing} onChange={setMarketing} />
      </div>
      {showRequired && (!adult || !kyc) ? <Notice tone="danger" live>{t('kyc.consentRequired')}</Notice> : null}
      {error ? <Notice tone="danger" live>{error}</Notice> : null}
      <StickyBar>
        <Button fullWidth loading={busy} onClick={() => void submit()}>
          {t('kyc.consentContinue')}
        </Button>
      </StickyBar>
    </div>
  );
}
