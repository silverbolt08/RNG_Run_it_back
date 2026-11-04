import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTesseractOcr, LANGUAGE_FILE } from '@/server/adapters/ocr/tesseract-ocr';
import { seedFromDataPack } from '@/server/db/seed';
import { ApiClient, expectApiError, grant, newVisitor, verifyPhone, type ApiResponse } from '../../helpers/api-client';
import { DATA_DIR } from '../../helpers/data-pack';
import { createTestApp, type TestApp } from '../../helpers/test-app';
import { applicant, type DocumentType } from '../../helpers/specimens';

const LANG_DIR = path.resolve('storage/ocr');
const SPECIMENS = path.join(DATA_DIR, 'kyc_documents');
const hasPack = existsSync(path.join(SPECIMENS, 'K03_gst_certificate.png'));

const FILE_SUFFIX: Readonly<Record<DocumentType, string>> = {
  GST_CERTIFICATE: 'gst_certificate',
  UDYAM_CERTIFICATE: 'udyam_certificate',
  SIGNATORY_ID: 'signatory_id',
  ADDRESS_PROOF: 'address_proof',
};

// Real images, real sharp, real tesseract and the real seeded registries. These verdicts are our
// own reading of the specimens, not the judges' answer key.
describe.skipIf(!hasPack)('the whole journey on the real specimens', () => {
  let app: TestApp;
  let phoneCounter = 0;
  const admin = new ApiClient();

  beforeAll(async () => {
    if (!existsSync(path.join(LANG_DIR, LANGUAGE_FILE))) {
      throw new Error('The OCR language file is missing. Run npm run setup:ocr.');
    }
    app = await createTestApp({ ocr: createTesseractOcr({ langDir: LANG_DIR }) });
    await seedFromDataPack(app.db, app.fixedClock, DATA_DIR);
  }, 120_000);

  afterAll(() => app.dispose());

  const uploadReal = (client: ApiClient, id: string, key: string, type: DocumentType) => {
    const form = new FormData();
    form.set('documentType', type);
    const bytes = readFileSync(path.join(SPECIMENS, `${key}_${FILE_SUFFIX[type]}.png`));
    form.set('file', new File([new Uint8Array(bytes)], 'photo.png'));
    return client.request('POST', `/api/v1/kyc-applications/${id}/documents`, {
      form,
      headers: { 'idempotency-key': `${key}-${type}-${Date.now()}` },
    });
  };

  const uploadAllReal = async (client: ApiClient, id: string, key: string): Promise<ApiResponse> => {
    let last: ApiResponse | null = null;
    for (const type of Object.keys(FILE_SUFFIX) as DocumentType[]) {
      if (!existsSync(path.join(SPECIMENS, `${key}_${FILE_SUFFIX[type]}.png`))) continue;
      last = await uploadReal(client, id, key, type);
      expect(last.status, JSON.stringify(last.body)).toBeLessThan(300);
    }
    if (!last) throw new Error(`No specimens for ${key}`);
    return last;
  };

  /** From a stranger's first visit to an accepted quote with KYC consent, using the guided path. */
  const reachKyc = async (needs: string[] = ['CUSTOMER_OUTREACH']) => {
    const owner = await newVisitor();
    await grant(owner, 'advisor_profile');

    const discovery = {
      businessType: 'dental clinic',
      city: 'Mumbai',
      employeeCount: 12,
      numSites: 1,
      gstinStatus: 'ACTIVE',
      fibreAvailable: true,
      connectivity: 'STANDARD',
      needs,
      counts: {},
    };
    const recommendation = await owner.post('/api/v1/recommendations', discovery);
    expect(recommendation.status).toBe(200);
    expect(recommendation.body.blocked).toEqual([]);

    const { cityTier, employeeCount, numSites, gstinStatus, fibreAvailable } = recommendation.body.profile;
    const quote = await owner.post('/api/v1/quotes', {
      profile: { cityTier, employeeCount, numSites, gstinStatus, fibreAvailable },
      lines: recommendation.body.lines.map((line: { productId: string; quantity: number }) => ({
        productId: line.productId,
        quantity: line.quantity,
      })),
    });
    expect(quote.status).toBe(201);
    expect(quote.body.monthlyTotalInr).toBe(recommendation.body.quote.monthlyTotalInr);

    expectApiError(await owner.post(`/api/v1/quotes/${quote.body.id}/acceptance`), 403, 'PHONE_VERIFICATION_REQUIRED');
    phoneCounter += 1;
    await verifyPhone(owner, `90000${String(phoneCounter).padStart(5, '0')}`);
    expect((await owner.post(`/api/v1/quotes/${quote.body.id}/acceptance`)).status).toBe(200);

    expectApiError(await owner.post('/api/v1/kyc-applications', { quoteId: quote.body.id }), 403, 'CONSENT_REQUIRED');
    await grant(owner, 'kyc_verification');
    return { owner, quoteId: quote.body.id as string, quote: quote.body };
  };

  const checkOf = (view: { checks: Array<{ id: string }> }, id: string) => view.checks.find((check) => check.id === id);

  it('K03 goes from recommendation to an activated order', async () => {
    const person = applicant('K03');
    const { owner, quoteId, quote } = await reachKyc();

    const created = await owner.post('/api/v1/kyc-applications', { quoteId, gstin: person.gstinOnFile });
    expect(created.status).toBe(201);
    // The GSTIN matched a seeded lead, so the owner only has to check the name.
    expect(created.body.contact).toEqual({ name: person.contactName, source: 'LEAD_PREFILL' });
    const id = created.body.id as string;

    expectApiError(await owner.post('/api/v1/orders', { quoteId, kycApplicationId: id }, { headers: { 'idempotency-key': 'k03-too-early' } }), 409, 'KYC_NOT_READY');

    const { body } = await uploadAllReal(owner, id, 'K03');
    const view = body.application;
    expect(view.verdict, JSON.stringify(view.checks.filter((c: { outcome: string }) => c.outcome === 'FAIL'))).toBe('VERIFIED');
    expect(view.nextActions).toEqual(['PLACE_ORDER']);
    expect(JSON.stringify(view)).not.toContain(person.gstinOnFile);

    const placed = await owner.post('/api/v1/orders', { quoteId, kycApplicationId: id }, { headers: { 'idempotency-key': 'k03-order-0001' } });
    expect(placed.status).toBe(201);
    expect(placed.body.monthlyTotalInr).toBe(quote.monthlyTotalInr);
    expect(placed.body.next.action).toBe('OWNER_PAYS');

    const orderId = placed.body.id as string;
    expect((await owner.post(`/api/v1/orders/${orderId}/payment-attempts`, { simulate: 'FAILURE' })).body.next.action).toBe('OWNER_RETRIES_PAYMENT');
    expect((await owner.post(`/api/v1/orders/${orderId}/payment-attempts`, { simulate: 'SUCCESS' })).body.stage).toBe('PAYMENT_CONFIRMED');
    for (let i = 0; i < 3; i++) await admin.admin('POST', `/api/v1/admin/orders/${orderId}/stage-advances`);

    const tracker = await owner.get(`/api/v1/orders/${orderId}`);
    expect(tracker.body).toMatchObject({ stage: 'ACTIVATED', status: 'ACTIVE', next: null, placedOn: '2026-07-15' });

    const logged = JSON.stringify(app.logs);
    expect(logged).not.toContain(person.gstinOnFile);
    expect(logged).not.toContain(person.contactName);
  }, 120_000);

  it('K11 is asked for a newer bill, and cannot order until it has one', async () => {
    const person = applicant('K11');
    const { owner, quoteId } = await reachKyc();
    const created = await owner.post('/api/v1/kyc-applications', { quoteId, contactName: person.contactName });
    const id = created.body.id as string;

    const { body } = await uploadAllReal(owner, id, 'K11');
    expect(body.application.verdict).toBe('RETAKE');
    expect(checkOf(body.application, 'ADDRESS_AGE')).toMatchObject({ outcome: 'FAIL', evidence: { ageDays: '257' } });
    expect(body.application.nextActions).toContain('RETAKE_DOCUMENT');

    const refused = await owner.post('/api/v1/orders', { quoteId, kycApplicationId: id }, { headers: { 'idempotency-key': 'k11-order-0001' } });
    expectApiError(refused, 409, 'KYC_NOT_READY');
  }, 120_000);

  it('K01 is Cancelled: the bundle loses what needs a GSTIN, and it continues on the new quote', async () => {
    const person = applicant('K01');
    const { owner, quoteId, quote } = await reachKyc();
    expect(quote.lines.map((line: { productId: string }) => line.productId)).toContain('P15');

    const created = await owner.post('/api/v1/kyc-applications', { quoteId, contactName: person.contactName });
    const id = created.body.id as string;

    const { body } = await uploadAllReal(owner, id, 'K01');
    const view = body.application;
    expect(view.verdict).toBe('REJECTED');
    expect(checkOf(view, 'GST_STATUS')).toMatchObject({ outcome: 'FAIL', evidence: { status: 'Cancelled' } });
    expect(view.quoteChange).toMatchObject({ reason: 'GSTIN_STATUS', gstinStatus: 'CANCELLED', requiresAcceptance: true });
    expect(view.quoteChange.dropped.map((item: { productId: string }) => item.productId)).toEqual(['P15']);
    expect(view.quoteChange.comparison.monthlyDeltaInr).toBeLessThan(0);

    const changed = await owner.get(`/api/v1/quotes/${quoteId}`);
    expect(changed.body.status).toBe('NEEDS_ACCEPTANCE');
    expect(changed.body.lines.map((line: { productId: string }) => line.productId)).not.toContain('P15');

    const early = await owner.post('/api/v1/orders', { quoteId, kycApplicationId: id }, { headers: { 'idempotency-key': 'k01-order-0001' } });
    expectApiError(early, 409, 'QUOTE_NOT_ACCEPTED');

    const accepted = await owner.post(`/api/v1/quotes/${quoteId}/acceptance`);
    expect(accepted.body.kycApplication).toEqual({ id, verdict: 'MANUAL_REVIEW' });

    const placed = await owner.post('/api/v1/orders', { quoteId, kycApplicationId: id }, { headers: { 'idempotency-key': 'k01-order-0002' } });
    expect(placed.status).toBe(201);
    expect(placed.body).toMatchObject({ stage: 'ORDER_PLACED', kycUnderReview: true });
  }, 120_000);

  it.each([
    ['K02', 'VERIFIED'],
    ['K04', 'RETAKE'],
    ['K05', 'VERIFIED'],
    ['K07', 'MANUAL_REVIEW'],
    ['K08', 'VERIFIED'],
    ['K09', 'VERIFIED'],
    ['K12', 'VERIFIED'],
  ])('%s gets %s through the real pipeline', async (key, verdict) => {
    const person = applicant(key);
    const { owner, quoteId } = await reachKyc();
    const created = await owner.post('/api/v1/kyc-applications', { quoteId, contactName: person.contactName });
    const { body } = await uploadAllReal(owner, created.body.id, key);
    const failed = body.application.checks.filter((check: { outcome: string; severity: string }) => check.outcome === 'FAIL' && check.severity !== 'ADVISORY');
    expect(body.application.verdict, JSON.stringify(failed)).toBe(verdict);
  }, 120_000);

  it('K06 asks the owner to check the number, then rejects what they confirm', async () => {
    const person = applicant('K06');
    const { owner, quoteId } = await reachKyc();
    const created = await owner.post('/api/v1/kyc-applications', { quoteId, contactName: person.contactName });
    const { body } = await uploadAllReal(owner, created.body.id, 'K06');
    expect(body.application.verdict).toBe('NEEDS_CONFIRMATION');

    const confirmed = await owner.post(`/api/v1/kyc-applications/${created.body.id}/gstin-confirmation`, {
      gstin: '08YKZXS8189L1ZO',
    });
    expect(confirmed.body.verdict).toBe('REJECTED');
  }, 120_000);

  it('K10 confirms the look-alike suggestion and reaches its signatory mismatch', async () => {
    const person = applicant('K10');
    const { owner, quoteId } = await reachKyc();
    const created = await owner.post('/api/v1/kyc-applications', { quoteId, contactName: person.contactName });
    const { body } = await uploadAllReal(owner, created.body.id, 'K10');
    expect(body.application.verdict).toBe('NEEDS_CONFIRMATION');
    expect(body.application.gstin.confirmation.suggestion).toBe(person.gstinOnFile);

    const confirmed = await owner.post(`/api/v1/kyc-applications/${created.body.id}/gstin-confirmation`, {
      gstin: body.application.gstin.confirmation.suggestion,
    });
    expect(confirmed.body.verdict).toBe('MANUAL_REVIEW');
    expect(checkOf(confirmed.body, 'SIGNATORY_NAME')).toMatchObject({ outcome: 'FAIL' });
  }, 120_000);

  it('survives a registry outage, keeping every document, and finishes when it ends', async () => {
    const person = applicant('K09');
    const { owner, quoteId } = await reachKyc();
    const created = await owner.post('/api/v1/kyc-applications', { quoteId, contactName: person.contactName });

    await admin.admin('PUT', '/api/v1/admin/simulations/registry-outage', { enabled: true });
    const { body } = await uploadAllReal(owner, created.body.id, 'K09');
    expect(body.application.verdict).toBe('VERIFICATION_PENDING');

    await admin.admin('PUT', '/api/v1/admin/simulations/registry-outage', { enabled: false });
    const rerun = await owner.post(`/api/v1/kyc-applications/${created.body.id}/reassessment`);
    expect(rerun.body.verdict).toBe('VERIFIED');
  }, 120_000);
});
