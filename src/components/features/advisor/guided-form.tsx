'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { CheckboxField, SelectField, TextField } from '@/components/ui/field';
import { Notice } from '@/components/ui/feedback';
import { Screen, Section, StickyBar } from '@/components/ui/layout';
import { KNOWN_CITIES } from '@/domain/bundle/segments';
import { ALL_NEEDS } from '@/domain/advisor/slot-answers';
import type { Need } from '@/domain/bundle/recommend-bundle';
import { useLocale } from '@/i18n/locale-provider';
import { api, ApiFailure, ensureSession } from '@/lib/api-client';
import type { Recommendation } from '@/server/services/advisor/reply-plan';
import { useErrorMessage } from '../shell/use-error-message';
import { BundleCard } from './bundle-card';
import { createQuoteFrom } from './create-quote';

const OTHER_CITY = 'OTHER';
const toTitle = (city: string) => city.charAt(0).toUpperCase() + city.slice(1);

/** The advisor without an LLM. It calls the same rules, so an owner gets the same bundle and price. */
export function GuidedForm() {
  const { t, tDynamic } = useLocale();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const resultRef = useRef<HTMLDivElement>(null);

  const [segment, setSegment] = useState('micro');
  const [city, setCity] = useState('');
  const [cityTier, setCityTier] = useState('2');
  const [employees, setEmployees] = useState('');
  const [sites, setSites] = useState('1');
  const [gstin, setGstin] = useState('');
  const [fibre, setFibre] = useState('');
  const [connectivity, setConnectivity] = useState('STANDARD');
  const [needs, setNeeds] = useState<readonly Need[]>([]);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [problems, setProblems] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureSession().catch((caught: unknown) => setError(errorMessage(caught)));
  }, [errorMessage]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const missing = { city: city === '', employees: !/^\d+$/.test(employees), sites: !/^\d+$/.test(sites), gstin: gstin === '', fibre: fibre === '' };
    setProblems(missing);
    if (Object.values(missing).some(Boolean)) return;

    setBusy(true);
    setError(null);
    try {
      const result = await api.post<Recommendation>('/recommendations', {
        segment,
        ...(city === OTHER_CITY ? { cityTier: Number(cityTier) } : { city }),
        employeeCount: Number(employees),
        numSites: Number(sites),
        gstinStatus: gstin,
        fibreAvailable: fibre === 'UNKNOWN' ? null : fibre === 'YES',
        connectivity,
        needs,
        counts: {},
      });
      setRecommendation(result);
      setTimeout(() => resultRef.current?.scrollIntoView?.({ block: 'start' }), 0);
    } catch (caught) {
      if (caught instanceof ApiFailure && caught.code === 'CONSENT_REQUIRED') router.replace('/');
      else setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const seeQuote = async () => {
    if (!recommendation) return;
    setBusy(true);
    setError(null);
    try {
      await createQuoteFrom(recommendation);
      router.push('/quote');
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  const required = t('form.required');

  return (
    <Screen title={t('form.title')}>
      <p className="text-ink-muted">{t('form.intro')}</p>
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
        <SelectField
          label={t('form.business')}
          value={segment}
          onChange={(event) => setSegment(event.target.value)}
          options={[
            { value: 'micro', label: t('advisor.chip.SHOP') },
            { value: 'prof', label: t('advisor.chip.OFFICE') },
            { value: 'multi', label: t('advisor.chip.CHAIN') },
            { value: 'mfg', label: t('advisor.chip.FACTORY') },
          ]}
        />
        <SelectField
          label={t('form.city')}
          hint={t('form.cityHint')}
          value={city}
          error={problems.city ? required : null}
          onChange={(event) => setCity(event.target.value)}
          options={[
            { value: '', label: '—' },
            ...KNOWN_CITIES.map((name) => ({ value: name, label: toTitle(name) })),
            { value: OTHER_CITY, label: t('form.cityOther') },
          ]}
        />
        {city === OTHER_CITY ? (
          <SelectField
            label={t('form.cityTier')}
            value={cityTier}
            onChange={(event) => setCityTier(event.target.value)}
            options={[
              { value: '1', label: t('advisor.chip.TIER_1') },
              { value: '2', label: t('advisor.chip.TIER_2') },
              { value: '3', label: t('advisor.chip.TIER_3') },
            ]}
          />
        ) : null}
        <TextField label={t('form.employees')} inputMode="numeric" value={employees} error={problems.employees ? required : null} onChange={(event) => setEmployees(event.target.value)} />
        <TextField label={t('form.sites')} inputMode="numeric" value={sites} error={problems.sites ? required : null} onChange={(event) => setSites(event.target.value)} />
        <SelectField
          label={t('form.gstin')}
          value={gstin}
          error={problems.gstin ? required : null}
          onChange={(event) => setGstin(event.target.value)}
          options={[
            { value: '', label: '—' },
            { value: 'ACTIVE', label: t('advisor.chip.GST_ACTIVE') },
            { value: 'NONE', label: t('advisor.chip.GST_NONE') },
            { value: 'CANCELLED', label: t('advisor.chip.GST_CANCELLED') },
            { value: 'SUSPENDED', label: t('advisor.chip.GST_SUSPENDED') },
            { value: 'UNKNOWN', label: t('advisor.chip.DECLINE') },
          ]}
        />
        <SelectField
          label={t('form.fibre')}
          value={fibre}
          error={problems.fibre ? required : null}
          onChange={(event) => setFibre(event.target.value)}
          options={[
            { value: '', label: '—' },
            { value: 'YES', label: t('advisor.chip.YES') },
            { value: 'NO', label: t('advisor.chip.NO') },
            { value: 'UNKNOWN', label: t('advisor.chip.NOT_SURE') },
          ]}
        />
        <SelectField
          label={t('form.connectivity')}
          value={connectivity}
          onChange={(event) => setConnectivity(event.target.value)}
          options={(['STANDARD', 'HIGH_SPEED', 'DEDICATED', 'DEDICATED_HIGH', 'NONE'] as const).map((value) => ({ value, label: t(`form.connectivityOption.${value}`) }))}
        />
        <fieldset className="flex flex-col">
          <legend className="font-medium">{t('form.needs')}</legend>
          {ALL_NEEDS.map((need) => (
            <CheckboxField
              key={need}
              label={tDynamic(`need.${need}`)}
              checked={needs.includes(need)}
              onChange={(on) => setNeeds(on ? [...needs, need] : needs.filter((item) => item !== need))}
            />
          ))}
        </fieldset>
        <Button type="submit" fullWidth variant={recommendation ? 'secondary' : 'primary'} loading={busy && !recommendation}>
          {t('form.submit')}
        </Button>
      </form>

      {error ? <Notice tone="danger" live>{error}</Notice> : null}

      {recommendation ? (
        <div ref={resultRef}>
          <Section title={t('advisor.bundleTitle')}>
            <BundleCard recommendation={recommendation} />
            {recommendation.lines.length > 0 ? (
              <StickyBar>
                <Button fullWidth loading={busy} onClick={() => void seeQuote()}>
                  {t('advisor.seeBundle')}
                </Button>
              </StickyBar>
            ) : null}
          </Section>
        </div>
      ) : null}
    </Screen>
  );
}
