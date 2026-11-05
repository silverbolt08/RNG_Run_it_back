'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { Notice } from '@/components/ui/feedback';
import { Card } from '@/components/ui/layout';
import { useLocale } from '@/i18n/locale-provider';
import { api, ApiFailure } from '@/lib/api-client';
import { useErrorMessage } from '../shell/use-error-message';

type Challenge = { challengeId: string; phoneMasked: string; testCode: string };

/** Asked only when the owner accepts a quote, since nothing before that needs to know who they are. */
export function PhoneStep({ onVerified }: { onVerified(): void }) {
  const { t } = useLocale();
  const errorMessage = useErrorMessage();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requestCode = async (event: FormEvent) => {
    event.preventDefault();
    setFieldError(null);
    setError(null);
    if (!/^(\+91)?[6-9]\d{9}$/.test(phone.replace(/[\s-]/g, ''))) {
      setFieldError(t('phone.invalid'));
      return;
    }
    setBusy(true);
    try {
      setChallenge(await api.post<Challenge>('/sessions/otp-requests', { phone }));
    } catch (caught) {
      if (caught instanceof ApiFailure && caught.code === 'INVALID_REQUEST') setFieldError(t('phone.invalid'));
      else setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (!challenge) return;
    setFieldError(null);
    setError(null);
    setBusy(true);
    try {
      await api.post('/sessions/otp-verifications', { challengeId: challenge.challengeId, code });
      onVerified();
    } catch (caught) {
      const failed = caught instanceof ApiFailure ? caught.code : '';
      if (failed === 'OTP_INCORRECT' || failed === 'INVALID_REQUEST') setFieldError(t('phone.wrongCode'));
      else if (failed === 'OTP_EXPIRED') setFieldError(t('phone.expired'));
      else if (failed === 'OTP_ATTEMPTS_EXCEEDED') setFieldError(t('phone.tooMany'));
      else setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-3" >
      <h2 className="text-lg font-semibold">{challenge ? t('phone.codeTitle') : t('phone.title')}</h2>
      {error ? <Notice tone="danger" live>{error}</Notice> : null}
      {challenge ? (
        <form onSubmit={(event) => void verify(event)} noValidate className="flex flex-col gap-3">
          <p>{t('phone.sentTo', { phone: challenge.phoneMasked })}</p>
          <Notice tone="neutral">{t('phone.testCode', { code: challenge.testCode })}</Notice>
          <TextField
            label={t('phone.codeLabel')}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            error={fieldError}
            onChange={(event) => setCode(event.target.value)}
          />
          <Button type="submit" fullWidth loading={busy}>
            {t('phone.verify')}
          </Button>
          <Button variant="ghost" onClick={() => setChallenge(null)}>
            {t('phone.change')}
          </Button>
        </form>
      ) : (
        <form onSubmit={(event) => void requestCode(event)} noValidate className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">{t('phone.intro')}</p>
          <TextField
            label={t('phone.label')}
            hint={t('phone.hint')}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={phone}
            error={fieldError}
            onChange={(event) => setPhone(event.target.value)}
          />
          <Button type="submit" fullWidth loading={busy}>
            {t('phone.send')}
          </Button>
        </form>
      )}
    </Card>
  );
}
