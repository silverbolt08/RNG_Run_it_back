'use client';

import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { Notice } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { useLocale } from '@/i18n/locale-provider';
import { api, ApiFailure, formatDate } from '@/lib/api-client';
import type { listHandoffs, listTopLeads } from '@/server/services/backoffice-service';
import { useErrorMessage } from '../shell/use-error-message';

type Handoffs = Awaited<ReturnType<typeof listHandoffs>>;
type Leads = Awaited<ReturnType<typeof listTopLeads>>;

function DataTable({ headers, rows, label }: { headers: readonly string[]; rows: readonly ReactNode[][]; label: string }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line" tabIndex={0} role="region" aria-label={label}>
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead className="bg-surface-alt text-left">
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col" className="px-3 py-2 font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, rowIndex) => (
            <tr key={rowIndex} className="border-t border-line">
              {cells.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A local demo tool. The token lives only in this component's state, so a reload forgets it. */
export function BackofficeScreen() {
  const { t, tDynamic, locale } = useLocale();
  const errorMessage = useErrorMessage();
  const [token, setToken] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [handoffs, setHandoffs] = useState<Handoffs['items']>([]);
  const [leads, setLeads] = useState<Leads['items']>([]);
  const [orderId, setOrderId] = useState('');
  const [outage, setOutage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [handed, top] = await Promise.all([
      api.get<Handoffs>('/admin/handoffs', { adminToken: token }),
      api.get<Leads>('/admin/leads', { adminToken: token }),
    ]);
    setHandoffs(handed.items);
    setLeads(top.items);
  }, [token]);

  const open = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await load();
      setUnlocked(true);
    } catch (caught) {
      setError(caught instanceof ApiFailure && caught.code === 'ADMIN_REQUIRED' ? t('backoffice.badToken') : errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const simulate = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await run();
      setNote(t('backoffice.done'));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  if (!unlocked) {
    return (
      <Screen title={t('backoffice.title')}>
        <form onSubmit={(event) => void open(event)} className="flex flex-col gap-3">
          <TextField label={t('backoffice.tokenLabel')} hint={t('backoffice.tokenHint')} type="password" autoComplete="off" value={token} error={error} onChange={(event) => setToken(event.target.value)} />
          <Button type="submit" loading={busy} disabled={token === ''}>
            {t('backoffice.open')}
          </Button>
        </form>
      </Screen>
    );
  }

  const adminOptions = { adminToken: token };

  return (
    <Screen title={t('backoffice.title')}>
      {error ? <Notice tone="danger" live>{error}</Notice> : null}
      {note ? <Notice tone="success" live>{note}</Notice> : null}

      <Section title={t('backoffice.handoffsHeading')}>
        {handoffs.length === 0 ? (
          <p className="text-ink-muted">{t('backoffice.handoffsEmpty')}</p>
        ) : (
          <DataTable
            label={t('backoffice.handoffsHeading')}
            headers={[t('backoffice.column.when'), t('backoffice.column.reason'), t('backoffice.column.business'), t('backoffice.column.city'), t('backoffice.column.size'), t('backoffice.column.gstin'), t('backoffice.column.needs')]}
            rows={handoffs.map((item) => [
              formatDate(item.when, locale),
              tDynamic(`backoffice.reason.${item.reason}`),
              item.businessType ?? '—',
              item.city ?? '—',
              `${item.employeeCount ?? '—'} / ${item.numSites ?? '—'}`,
              item.gstinStatus ?? '—',
              item.needs.map((need) => tDynamic(`need.${need}`)).join(', ') || '—',
            ])}
          />
        )}
      </Section>

      <Section title={t('backoffice.leadsHeading')}>
        <p className="text-sm text-ink-muted">{t('backoffice.leadsNote')}</p>
        <DataTable
          label={t('backoffice.leadsHeading')}
          headers={[t('backoffice.column.score'), t('backoffice.column.business'), t('backoffice.column.segment'), t('backoffice.column.city'), t('backoffice.column.size'), t('backoffice.column.gstin'), t('backoffice.column.source'), t('backoffice.column.stage')]}
          rows={leads.map((lead) => [
            <span key="score" className="font-semibold tabular-nums">
              {(lead.score * 100).toFixed(0)}%
            </span>,
            lead.businessType,
            lead.segment,
            lead.city,
            `${lead.employeeCount} / ${lead.numSites}`,
            lead.hasGstin ? t('advisor.chip.YES') : t('advisor.chip.NO'),
            lead.leadSource,
            lead.stageReached,
          ])}
        />
      </Section>

      <Section title={t('backoffice.demoHeading')}>
        <p className="text-sm text-ink-muted">{t('backoffice.demoNote')}</p>
        <TextField label={t('backoffice.orderId')} autoComplete="off" value={orderId} className="font-mono" onChange={(event) => setOrderId(event.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy || orderId === ''} onClick={() => void simulate(() => api.post(`/admin/orders/${orderId}/stage-advances`, undefined, adminOptions))}>
            {t('backoffice.advance')}
          </Button>
          <Button
            variant="secondary"
            disabled={busy || orderId === ''}
            onClick={() => void simulate(() => api.post(`/admin/orders/${orderId}/delays`, { reason: 'FIBRE_NOT_FEASIBLE', newDate: '2026-08-10' }, adminOptions))}
          >
            {t('backoffice.delay')}
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void simulate(async () => {
                await api.put('/admin/simulations/registry-outage', { enabled: !outage }, adminOptions);
                setOutage(!outage);
              })
            }
          >
            {outage ? t('backoffice.outageOff') : t('backoffice.outageOn')}
          </Button>
        </div>
      </Section>
    </Screen>
  );
}
