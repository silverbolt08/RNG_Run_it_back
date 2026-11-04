import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient, expectApiError, grant, newVisitor } from '../../helpers/api-client';
import { createTestApp, type TestApp } from '../../helpers/test-app';
import { acceptedQuote, applicant, noGstinLines, seedRegistryFor, uploadAll } from '../../helpers/specimens';

const ORDERS = '/api/v1/orders';

describe('orders and the tracker', () => {
  let app: TestApp;
  let owner: ApiClient;
  const admin = new ApiClient();

  beforeEach(async () => {
    app = await createTestApp();
    owner = await newVisitor();
  });
  afterEach(() => app.dispose());

  const verifiedApplication = async (key = 'K03') => {
    await seedRegistryFor(app, key);
    const quoteId = await acceptedQuote(owner);
    const created = await owner.post('/api/v1/kyc-applications', { quoteId, contactName: applicant(key).contactName });
    await uploadAll(app, owner, created.body.id, key);
    return { quoteId, kycApplicationId: created.body.id as string };
  };

  const placeOrder = async (key = 'K03') => {
    const refs = await verifiedApplication(key);
    const response = await owner.post(ORDERS, refs, { headers: { 'idempotency-key': `order-${key}-0001` } });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return { ...refs, order: response.body, id: response.body.id as string };
  };

  const pay = (id: string, simulate = 'SUCCESS') => owner.post(`${ORDERS}/${id}/payment-attempts`, { simulate });
  const advance = (id: string) => admin.admin('POST', `/api/v1/admin/orders/${id}/stage-advances`);
  const delay = (id: string, body: object) => admin.admin('POST', `/api/v1/admin/orders/${id}/delays`, body);

  describe('placing an order', () => {
    it('creates one from an accepted quote and a verified application', async () => {
      const { order } = await placeOrder();
      expect(order.id).toMatch(/^ord_/);
      expect(order).toMatchObject({
        status: 'ACTIVE',
        stage: 'KYC_CONFIRMED',
        placedOn: '2026-07-15',
        priceBasis: 'EXCL_GST',
        kycUnderReview: false,
      });
      expect(order.payment).toMatchObject({ status: 'PENDING', mock: true, attempts: [] });
      expect(order.payment.amountDueInr).toBe(order.monthlyTotalInr + order.setupTotalInr);
    });

    it('works out expected dates per product from the business date', async () => {
      const { order } = await placeOrder();
      expect(order.products).toEqual([
        expect.objectContaining({ productId: 'P01', name: 'Biz Fibre 100', installDays: 5, expectedDate: '2026-07-20' }),
        expect.objectContaining({ productId: 'P15', installDays: 3, expectedDate: '2026-07-18' }),
      ]);
      expect(order.expectedActivationDate).toBe('2026-07-20');
      expect(order.next).toEqual({
        stage: 'PAYMENT_CONFIRMED',
        action: 'OWNER_PAYS',
        actor: 'OWNER',
        expectedDate: '2026-07-15',
      });
    });

    it('creates nothing new when repeated with the same key', async () => {
      const refs = await verifiedApplication();
      const headers = { 'idempotency-key': 'order-key-repeat' };
      const first = await owner.post(ORDERS, refs, { headers });
      const second = await owner.post(ORDERS, refs, { headers });
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.id).toBe(first.body.id);
      const rows = await app.testDb.client.execute('SELECT COUNT(*) AS total FROM orders');
      expect(Number(rows.rows[0]?.total)).toBe(1);
    });

    it('refuses a second order for the same quote under a new key', async () => {
      const { quoteId, kycApplicationId } = await placeOrder();
      const response = await owner.post(ORDERS, { quoteId, kycApplicationId }, { headers: { 'idempotency-key': 'another-key-0001' } });
      expectApiError(response, 409, 'ORDER_EXISTS');
    });

    it('places one order when two different keys race for the same quote', async () => {
      const refs = await verifiedApplication();
      const responses = await Promise.all([
        owner.post(ORDERS, refs, { headers: { 'idempotency-key': 'order-race-key-1' } }),
        owner.post(ORDERS, refs, { headers: { 'idempotency-key': 'order-race-key-2' } }),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      const refused = responses.find((response) => response.status === 409);
      expect(refused?.body.error.code).toBe('ORDER_EXISTS');
      const rows = await app.testDb.client.execute('SELECT COUNT(*) AS total FROM orders');
      expect(Number(rows.rows[0]?.total)).toBe(1);
    });

    it('refuses a key reused for a different order', async () => {
      const { quoteId, kycApplicationId } = await placeOrder();
      const response = await owner.post(
        ORDERS,
        { quoteId: 'qt_different', kycApplicationId },
        { headers: { 'idempotency-key': 'order-K03-0001' } },
      );
      expect(quoteId).not.toBe('qt_different');
      expectApiError(response, 409, 'IDEMPOTENCY_KEY_REUSED');
    });

    it('needs an idempotency key', async () => {
      const refs = await verifiedApplication();
      expectApiError(await owner.post(ORDERS, refs), 400, 'INVALID_REQUEST');
    });

    it('rejects unknown fields', async () => {
      const refs = await verifiedApplication();
      const response = await owner.post(ORDERS, { ...refs, priceInr: 1 }, { headers: { 'idempotency-key': 'order-key-0002' } });
      expectApiError(response, 400, 'INVALID_REQUEST');
    });

    it('needs the KYC consent still to be active', async () => {
      const refs = await verifiedApplication();
      await owner.post('/api/v1/consents/kyc_verification/withdrawal');
      const response = await owner.post(ORDERS, refs, { headers: { 'idempotency-key': 'order-key-0003' } });
      expectApiError(response, 403, 'CONSENT_REQUIRED');
    });

    it('needs a verified phone', async () => {
      const stranger = await newVisitor();
      await grant(stranger, 'kyc_verification');
      const response = await stranger.post(
        ORDERS,
        { quoteId: 'qt_x', kycApplicationId: 'kyc_x' },
        { headers: { 'idempotency-key': 'order-key-0004' } },
      );
      expectApiError(response, 403, 'PHONE_VERIFICATION_REQUIRED');
    });

    it('frees the key after a refusal, so a retry can succeed', async () => {
      await seedRegistryFor(app, 'K03');
      const quoteId = await acceptedQuote(owner);
      const created = await owner.post('/api/v1/kyc-applications', { quoteId, contactName: applicant('K03').contactName });
      const refs = { quoteId, kycApplicationId: created.body.id };
      const headers = { 'idempotency-key': 'order-key-retry' };

      expectApiError(await owner.post(ORDERS, refs, { headers }), 409, 'KYC_NOT_READY');
      await uploadAll(app, owner, created.body.id, 'K03');
      expect((await owner.post(ORDERS, refs, { headers })).status).toBe(201);
    });

    it('refuses an application for a different quote', async () => {
      const { kycApplicationId } = await verifiedApplication();
      const other = await owner.post('/api/v1/quotes', {
        profile: { cityTier: 1, employeeCount: 12, numSites: 1, gstinStatus: 'ACTIVE', fibreAvailable: true },
        lines: noGstinLines,
      });
      await owner.post(`/api/v1/quotes/${other.body.id}/acceptance`);
      const response = await owner.post(
        ORDERS,
        { quoteId: other.body.id, kycApplicationId },
        { headers: { 'idempotency-key': 'order-key-0005' } },
      );
      expectApiError(response, 422, 'KYC_QUOTE_MISMATCH');
    });

    describe('with an unsuitable verdict', () => {
      const tryOrder = (refs: object) => owner.post(ORDERS, refs, { headers: { 'idempotency-key': 'order-key-verdict' } });

      it('refuses while documents are missing', async () => {
        await seedRegistryFor(app, 'K03');
        const quoteId = await acceptedQuote(owner);
        const created = await owner.post('/api/v1/kyc-applications', { quoteId, contactName: applicant('K03').contactName });
        const response = await tryOrder({ quoteId, kycApplicationId: created.body.id });
        expectApiError(response, 409, 'KYC_NOT_READY');
        expect(response.body.error.details).toEqual({ verdict: null });
      });

      it('refuses a retake', async () => {
        await seedRegistryFor(app, 'K11');
        const quoteId = await acceptedQuote(owner);
        const created = await owner.post('/api/v1/kyc-applications', { quoteId, contactName: applicant('K11').contactName });
        await uploadAll(app, owner, created.body.id, 'K11');
        const response = await tryOrder({ quoteId, kycApplicationId: created.body.id });
        expectApiError(response, 409, 'KYC_NOT_READY');
        expect(response.body.error.details).toEqual({ verdict: 'RETAKE' });
      });

      it('refuses a verdict still waiting on the registry', async () => {
        await seedRegistryFor(app, 'K03');
        await admin.admin('PUT', '/api/v1/admin/simulations/registry-outage', { enabled: true });
        const quoteId = await acceptedQuote(owner);
        const created = await owner.post('/api/v1/kyc-applications', { quoteId, contactName: applicant('K03').contactName });
        await uploadAll(app, owner, created.body.id, 'K03');
        const response = await tryOrder({ quoteId, kycApplicationId: created.body.id });
        expectApiError(response, 409, 'KYC_NOT_READY');
      });

      it('refuses a rejection', async () => {
        await seedRegistryFor(app, 'K01', 'Cancelled');
        const quoteId = await acceptedQuote(owner, noGstinLines);
        const created = await owner.post('/api/v1/kyc-applications', { quoteId, contactName: applicant('K01').contactName });
        await uploadAll(app, owner, created.body.id, 'K01');
        // A bundle with no GSTIN needs doesn't reject K01, so force one to test the guard.
        await app.testDb.client.execute({
          sql: `UPDATE kyc_applications SET verdict = 'REJECTED' WHERE id = ?`,
          args: [created.body.id],
        });
        expectApiError(await tryOrder({ quoteId, kycApplicationId: created.body.id }), 422, 'KYC_REJECTED');
      });
    });

    it('accepts manual review, holding the order at the KYC stage', async () => {
      await seedRegistryFor(app, 'K07');
      await app.testDb.client.execute({
        sql: 'UPDATE gst_registry SET trade_name = ?, legal_name = ? WHERE id = ?',
        args: ['Neelgiri Physio Clinic', 'Neelgiri Physio Clinic', applicant('K07').gstinOnFile],
      });
      const quoteId = await acceptedQuote(owner);
      const created = await owner.post('/api/v1/kyc-applications', { quoteId, contactName: applicant('K07').contactName });
      await uploadAll(app, owner, created.body.id, 'K07');

      const response = await owner.post(
        ORDERS,
        { quoteId, kycApplicationId: created.body.id },
        { headers: { 'idempotency-key': 'order-key-review' } },
      );
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ stage: 'ORDER_PLACED', kycUnderReview: true });
      expect(response.body.next).toMatchObject({ action: 'ACCEL_REVIEWS_KYC', actor: 'ACCEL' });

      expectApiError(await pay(response.body.id), 409, 'KYC_NOT_CONFIRMED');

      const cleared = await advance(response.body.id);
      expect(cleared.body).toMatchObject({ stage: 'KYC_CONFIRMED', kycUnderReview: false });
      expect((await pay(response.body.id)).status).toBe(201);
    });
  });

  describe('ownership', () => {
    it("hides another owner's quote, application and order behind a 404", async () => {
      const { id, quoteId, kycApplicationId } = await placeOrder();
      const other = await newVisitor();
      await acceptedQuote(other, noGstinLines, undefined, '9000000003');

      expectApiError(await other.get(`${ORDERS}/${id}`), 404, 'NOT_FOUND');
      expectApiError(await other.post(`${ORDERS}/${id}/payment-attempts`, { simulate: 'SUCCESS' }), 404, 'NOT_FOUND');
      expectApiError(await other.get(`/api/v1/quotes/${quoteId}`), 404, 'NOT_FOUND');
      expectApiError(await other.get(`/api/v1/kyc-applications/${kycApplicationId}`), 404, 'NOT_FOUND');

      const stolen = await other.post(ORDERS, { quoteId, kycApplicationId }, { headers: { 'idempotency-key': 'order-key-steal' } });
      expectApiError(stolen, 404, 'NOT_FOUND');
    });

    it('needs a session to read', async () => {
      expectApiError(await new ApiClient().get(`${ORDERS}/ord_anything`), 401, 'SESSION_REQUIRED');
    });

    it("lists only the owner's own orders, and offers the latest for resuming", async () => {
      const { id } = await placeOrder();
      const list = await owner.get(ORDERS);
      expect(list.status).toBe(200);
      expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([id]);
      expect(list.body.nextCursor).toBeNull();
      expect((await owner.get('/api/v1/sessions/current')).body.journey.orderId).toBe(id);

      const other = await newVisitor();
      expect((await other.get(ORDERS)).body.items).toEqual([]);
    });
  });

  describe('mock payment', () => {
    it('records a failure and shows how to retry', async () => {
      const { id } = await placeOrder();
      const failed = await pay(id, 'FAILURE');
      expect(failed.status).toBe(201);
      expect(failed.body.payment.status).toBe('FAILED');
      expect(failed.body.stage).toBe('KYC_CONFIRMED');
      expect(failed.body.next.action).toBe('OWNER_RETRIES_PAYMENT');
      expect(failed.body.payment.attempts).toEqual([
        expect.objectContaining({ outcome: 'FAILED', amountInr: failed.body.payment.amountDueInr }),
      ]);
    });

    it('moves the order on after a successful retry', async () => {
      const { id } = await placeOrder();
      await pay(id, 'FAILURE');
      const paid = await pay(id, 'SUCCESS');
      expect(paid.body.payment.status).toBe('PAID');
      expect(paid.body.stage).toBe('PAYMENT_CONFIRMED');
      expect(paid.body.payment.attempts).toHaveLength(2);
    });

    it('refuses to take payment twice', async () => {
      const { id } = await placeOrder();
      await pay(id);
      expectApiError(await pay(id), 409, 'ALREADY_PAID');
    });

    it.each([
      ['a card number', { simulate: 'SUCCESS', cardNumber: '4111111111111111' }],
      ['a CVV', { simulate: 'SUCCESS', cvv: '123' }],
      ['an unknown outcome', { simulate: 'FREE' }],
    ])('rejects %s', async (_label, body) => {
      const { id } = await placeOrder();
      expectApiError(await owner.post(`${ORDERS}/${id}/payment-attempts`, body), 400, 'INVALID_REQUEST');
    });
  });

  describe('admin controls', () => {
    it('needs the admin token', async () => {
      const { id } = await placeOrder();
      expectApiError(await owner.post(`/api/v1/admin/orders/${id}/stage-advances`), 403, 'ADMIN_REQUIRED');
      expectApiError(await owner.post(`/api/v1/admin/orders/${id}/delays`, { reason: 'WEATHER', newDate: '2026-09-01' }), 403, 'ADMIN_REQUIRED');
    });

    it('returns 404 for an order that does not exist', async () => {
      expectApiError(await advance('ord_missing'), 404, 'NOT_FOUND');
    });

    it('will not pass the payment stage before payment', async () => {
      const { id } = await placeOrder();
      expectApiError(await advance(id), 409, 'PAYMENT_REQUIRED');
    });

    it('walks a paid order through to activation, labelled as a simulation', async () => {
      const { id } = await placeOrder();
      await pay(id);

      const stages: string[] = [];
      for (const expected of ['INSTALL_SCHEDULED', 'INSTALLING', 'ACTIVATED']) {
        const response = await advance(id);
        expect(response.status).toBe(200);
        expect(response.body.simulated).toBe(true);
        stages.push(response.body.stage);
        expect(response.body.stage).toBe(expected);
      }
      const read = await owner.get(`${ORDERS}/${id}`);
      expect(read.body).toMatchObject({ stage: 'ACTIVATED', next: null });
      expect(read.body.activatedAt).toEqual(expect.any(String));
      expect(read.body.stages.at(-1)).toMatchObject({ stage: 'ACTIVATED', status: 'CURRENT' });
      expect(read.body.events.filter((event: { simulated: boolean }) => event.simulated)).toHaveLength(3);
      expectApiError(await advance(id), 409, 'ALREADY_ACTIVATED');
    });

    it('marks a delay with a reason and a new date, which the tracker shows', async () => {
      const { id } = await placeOrder();
      const response = await delay(id, { reason: 'PARTNER_DELAY', newDate: '2026-08-10' });
      expect(response.status).toBe(200);
      expect(response.body.simulated).toBe(true);

      const read = await owner.get(`${ORDERS}/${id}`);
      expect(read.body).toMatchObject({
        expectedActivationDate: '2026-08-10',
        originalActivationDate: '2026-07-20',
        delay: { reason: 'PARTNER_DELAY', newDate: '2026-08-10', previousDate: '2026-07-20' },
        alternativeProductIds: [],
      });
      expect(read.body.events.at(-1)).toMatchObject({
        type: 'DELAY_MARKED',
        reasonCode: 'PARTNER_DELAY',
        newDate: '2026-08-10',
        simulated: true,
      });
    });

    it('offers AirFiber when fibre cannot reach the site', async () => {
      const { id } = await placeOrder();
      const response = await delay(id, { reason: 'FIBRE_NOT_FEASIBLE', newDate: '2026-08-10' });
      expect(response.body.alternativeProductIds).toEqual(['P04']);
    });

    it('rejects a new date that is no delay', async () => {
      const { id } = await placeOrder();
      expectApiError(await delay(id, { reason: 'WEATHER', newDate: '2026-07-16' }), 422, 'DELAY_NOT_LATER');
    });

    it.each([
      ['an unknown reason', { reason: 'BECAUSE', newDate: '2026-08-10' }],
      ['an impossible date', { reason: 'WEATHER', newDate: '2026-02-30' }],
      ['an unknown field', { reason: 'WEATHER', newDate: '2026-08-10', note: 'x' }],
    ])('rejects %s', async (_label, body) => {
      const { id } = await placeOrder();
      expectApiError(await delay(id, body), 400, 'INVALID_REQUEST');
    });
  });

  describe('status messages', () => {
    it('logs them under service_updates consent, with no personal data', async () => {
      const refs = await verifiedApplication();
      await grant(owner, 'service_updates');
      const placed = await owner.post(ORDERS, refs, { headers: { 'idempotency-key': 'order-key-notify' } });
      const { id } = placed.body;
      await pay(id, 'FAILURE');
      await pay(id);
      await advance(id);
      await delay(id, { reason: 'WEATHER', newDate: '2026-09-01' });

      const read = await owner.get(`${ORDERS}/${id}`);
      expect(read.body.statusMessages.map((message: { templateCode: string }) => message.templateCode)).toEqual([
        'ORDER_PLACED',
        'PAYMENT_FAILED',
        'PAYMENT_CONFIRMED',
        'ORDER_STAGE_CHANGED',
        'ORDER_DELAYED',
      ]);
      const stored = JSON.stringify((await app.testDb.client.execute('SELECT * FROM notifications')).rows);
      expect(stored).not.toContain(applicant('K03').contactName);
      expect(stored).not.toContain(applicant('K03').gstinOnFile);
    });

    it('logs nothing without that consent', async () => {
      const { id } = await placeOrder();
      await pay(id);
      await advance(id);
      expect((await owner.get(`${ORDERS}/${id}`)).body.statusMessages).toEqual([]);
    });

    it('stops logging once it is withdrawn, while the order carries on', async () => {
      await grant(owner, 'service_updates');
      const { id } = await placeOrder();
      await owner.post('/api/v1/consents/service_updates/withdrawal');
      expect((await pay(id)).status).toBe(201);
      await advance(id);
      const messages = (await owner.get(`${ORDERS}/${id}`)).body.statusMessages;
      expect(messages.map((message: { templateCode: string }) => message.templateCode)).toEqual(['ORDER_PLACED']);
    });
  });

  describe('withdrawing consent after ordering', () => {
    it('cancels an order not yet activated, erases KYC and says so', async () => {
      const { id } = await placeOrder();
      const response = await owner.post('/api/v1/consents/kyc_verification/withdrawal');
      expect(response.body.effects).toMatchObject({ ordersCancelled: 1, applicationsStopped: 1 });

      const read = await owner.get(`${ORDERS}/${id}`);
      expect(read.body).toMatchObject({ status: 'CANCELLED', next: null });
      expect(read.body.events.at(-1)).toMatchObject({ type: 'ORDER_CANCELLED', reasonCode: 'KYC_CONSENT_WITHDRAWN' });
      expectApiError(await pay(id), 409, 'ORDER_NOT_ACTIVE');
      expectApiError(await advance(id), 409, 'ORDER_NOT_ACTIVE');
    });

    it('lets the owner order again after granting consent anew', async () => {
      const { id, quoteId } = await placeOrder();
      await owner.post('/api/v1/consents/kyc_verification/withdrawal');
      await grant(owner, 'kyc_verification');

      const created = await owner.post('/api/v1/kyc-applications', { quoteId, contactName: applicant('K03').contactName });
      await uploadAll(app, owner, created.body.id, 'K03');
      const again = await owner.post(
        ORDERS,
        { quoteId, kycApplicationId: created.body.id },
        { headers: { 'idempotency-key': 'order-key-again' } },
      );
      expect(again.status).toBe(201);
      expect(again.body.id).not.toBe(id);
    });

    it('keeps an activated service and its extracted fields, deleting only the raw documents', async () => {
      const { id, kycApplicationId } = await placeOrder();
      await pay(id);
      for (let i = 0; i < 3; i++) await advance(id);

      const response = await owner.post('/api/v1/consents/kyc_verification/withdrawal');
      expect(response.body.effects).toMatchObject({ ordersCancelled: 0, documentsDeleted: 4 });
      expect(readdirSync(app.documentDir)).toEqual([]);
      expect((await owner.get(`${ORDERS}/${id}`)).body).toMatchObject({ status: 'ACTIVE', stage: 'ACTIVATED' });

      const kyc = await owner.get(`/api/v1/kyc-applications/${kycApplicationId}`);
      expect(kyc.body.status).toBe('WITHDRAWN');
      expect(kyc.body.contact.name).toBe(applicant('K03').contactName);
    });

    it('does not claim erasure while fields are still held for the contract', async () => {
      const { id } = await placeOrder();
      await pay(id);
      for (let i = 0; i < 3; i++) await advance(id);
      await owner.post('/api/v1/consents/kyc_verification/withdrawal');

      const history = await app.testDb.client.execute(
        `SELECT status FROM consents WHERE purpose_id = 'kyc_verification' ORDER BY rowid`,
      );
      expect(history.rows.map((row) => row.status)).toEqual(['GRANTED', 'WITHDRAWN']);
    });

    it('refuses a second withdrawal', async () => {
      await placeOrder();
      await owner.post('/api/v1/consents/kyc_verification/withdrawal');
      expectApiError(await owner.post('/api/v1/consents/kyc_verification/withdrawal'), 409, 'CONSENT_NOT_ACTIVE');
    });

    it('withdrawing marketing changes nothing on the order', async () => {
      await grant(owner, 'marketing');
      const { id } = await placeOrder();
      await owner.post('/api/v1/consents/marketing/withdrawal');
      expect((await owner.get(`${ORDERS}/${id}`)).body.status).toBe('ACTIVE');
      expect((await pay(id)).status).toBe(201);
    });
  });
});
