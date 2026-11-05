'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { Badge, Notice, type Tone } from '@/components/ui/feedback';
import { Card, Identifier, Section } from '@/components/ui/layout';
import { useLocale } from '@/i18n/locale-provider';
import { api } from '@/lib/api-client';
import { formatInr } from '@/lib/money';
import type { CheckView, KycApplicationView } from '@/server/services/kyc/kyc-view';
import { useErrorMessage } from '../shell/use-error-message';

const VERDICT_TONE: Readonly<Record<string, Tone>> = {
  VERIFIED: 'success',
  RETAKE: 'warning',
  NEEDS_CONFIRMATION: 'warning',
  VERIFICATION_PENDING: 'neutral',
  MANUAL_REVIEW: 'warning',
  REJECTED: 'danger',
};

const OUTCOME_TONE: Readonly<Record<string, Tone>> = { PASS: 'success', FAIL: 'warning', PENDING: 'neutral', SKIPPED: 'neutral' };

// Checks with their own explanation. The rest are clear from the check's name and its result.
const EXPLAINED = new Set(['GST_STATUS', 'ADDRESS_AGE', 'SIGNATORY_NAME', 'GST_FOUND', 'GST_NAME', 'GST_ADDRESS', 'GST_STATE', 'ADDRESS_MATCH', 'BILL_NAME', 'SIGNATORY_VALID', 'SIGNATORY_BUSINESS', 'UDYAM_NAME', 'UDYAM_DATE', 'UDYAM_ACTIVITY']);

type QuoteChange = {
  gstinStatus: string;
  dropped: Array<{ name: string }>;
  after: { monthlyFinalInr: number };
};

function CheckRow({ check }: { check: CheckView }) {
  const { tDynamic } = useLocale();
  return (
    <li className="flex flex-col gap-1 border-b border-line py-2 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{tDynamic(`kyc.check.${check.id}`)}</span>
        <Badge tone={OUTCOME_TONE[check.outcome] ?? 'neutral'}>{tDynamic(`kyc.outcome.${check.outcome}`)}</Badge>
      </div>
      {check.outcome === 'FAIL' && EXPLAINED.has(check.id) ? <p className="text-sm text-ink-muted">{tDynamic(`kyc.explain.${check.id}`, check.evidence)}</p> : null}
    </li>
  );
}

function ConfirmGstin({ application, onUpdated }: { application: KycApplicationView; onUpdated(view: KycApplicationView): void }) {
  const { t } = useLocale();
  const errorMessage = useErrorMessage();
  const confirmation = application.gstin.confirmation;
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (value.trim().length !== 15) {
      setError(t('form.required'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onUpdated(await api.post<KycApplicationView>(`/kyc-applications/${application.id}/gstin-confirmation`, { gstin: value.trim() }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-3" selected>
      <h3 className="text-lg font-semibold">{t('kyc.confirmTitle')}</h3>
      <p>{t('kyc.confirmBody')}</p>
      {confirmation?.read ? (
        <p>
          {t('kyc.confirmRead', { value: '' })}
          <Identifier>{confirmation.read}</Identifier>
        </p>
      ) : null}
      {confirmation?.suggestion ? (
        <div className="flex flex-col gap-2">
          <p>
            {t('kyc.confirmSuggestion', { value: '' })}
            <Identifier>{confirmation.suggestion}</Identifier>
          </p>
          <Button variant="secondary" onClick={() => setValue(confirmation.suggestion ?? '')}>
            {t('kyc.useSuggestion')}
          </Button>
        </div>
      ) : null}
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-3">
        <TextField
          label={t('kyc.confirmLabel')}
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={15}
          className="font-mono"
          value={value}
          error={error}
          onChange={(event) => setValue(event.target.value.toUpperCase())}
        />
        <Button type="submit" fullWidth loading={busy}>
          {t('kyc.confirmSubmit')}
        </Button>
      </form>
    </Card>
  );
}

function CorrectName({ application, onUpdated }: { application: KycApplicationView; onUpdated(view: KycApplicationView): void }) {
  const { t } = useLocale();
  const errorMessage = useErrorMessage();
  const [name, setName] = useState(application.contact.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2) {
      setError(t('form.required'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onUpdated(await api.put<KycApplicationView>(`/kyc-applications/${application.id}/contact`, { contactName: name.trim() }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-2">
      <TextField label={t('kyc.contactName')} autoComplete="name" value={name} error={error} onChange={(event) => setName(event.target.value)} />
      <Button type="submit" variant="secondary" loading={busy}>
        {t('kyc.continue')}
      </Button>
    </form>
  );
}

export function VerdictPanel({
  application,
  onUpdated,
  onAcceptChanged,
  accepting,
}: {
  application: KycApplicationView;
  onUpdated(view: KycApplicationView): void;
  onAcceptChanged(): void;
  accepting: boolean;
}) {
  const { t, tDynamic } = useLocale();
  const { verdict, checks, nextActions, quoteChange } = application;
  const change = quoteChange as QuoteChange | null;
  const signatoryMismatch = checks.some((check) => check.id === 'SIGNATORY_NAME' && check.outcome === 'FAIL');
  const needsName = nextActions.includes('PROVIDE_CONTACT_NAME');
  const visibleChecks = checks.filter((check) => check.outcome !== 'SKIPPED');

  return (
    <Section title={t('kyc.resultTitle')}>
      {verdict ? (
        <div data-testid="kyc-verdict" data-verdict={verdict}>
          <Notice tone={VERDICT_TONE[verdict] ?? 'neutral'} live title={tDynamic(`kyc.verdict.${verdict}`)}>
            {verdict === 'REJECTED' ? (change ? t('kyc.rejectedGstin') : t('kyc.rejectedOther')) : null}
          </Notice>
        </div>
      ) : null}

      {application.gstin.masked ? (
        <p className="text-sm text-ink-muted">
          {t('kyc.maskedGstin', { value: '' })}
          <Identifier>{application.gstin.masked}</Identifier>
        </p>
      ) : null}

      {nextActions.includes('CONFIRM_GSTIN') ? <ConfirmGstin application={application} onUpdated={onUpdated} /> : null}
      {needsName || signatoryMismatch ? <CorrectName application={application} onUpdated={onUpdated} /> : null}

      {change ? (
        <Card className="flex flex-col gap-2" selected>
          <h3 className="text-lg font-semibold">{t('kyc.quoteChangedTitle')}</h3>
          <p>{t('kyc.quoteChangedBody', { status: change.gstinStatus })}</p>
          <p>{t('kyc.quoteChangedDropped', { names: change.dropped.map((item) => item.name).join(', ') })}</p>
          <p className="font-semibold tabular-nums">{t('kyc.quoteChangedNew', { amount: formatInr(change.after.monthlyFinalInr) })}</p>
          <Button fullWidth loading={accepting} onClick={onAcceptChanged}>
            {t('kyc.acceptChanged')}
          </Button>
        </Card>
      ) : null}

      {visibleChecks.length > 0 ? (
        <Card>
          <details open={verdict !== null && verdict !== 'VERIFIED'}>
            <summary className="flex min-h-10 cursor-pointer items-center font-semibold">{t('kyc.checksHeading')}</summary>
            <ul>
              {visibleChecks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </ul>
          </details>
        </Card>
      ) : null}
    </Section>
  );
}
