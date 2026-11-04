import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient, expectApiError, grant, newVisitor, verifyPhone } from '../../helpers/api-client';
import { createTestApp, type TestApp } from '../../helpers/test-app';

const PROFILE = { cityTier: 1, employeeCount: 12, numSites: 1, gstinStatus: 'ACTIVE', fibreAvailable: true };
const NO_GSTIN_PROFILE = { cityTier: 2, employeeCount: 3, numSites: 1, gstinStatus: 'NONE', fibreAvailable: true };

const DISCOVERY = {
  businessType: 'kirana store',
  city: 'Nashik',
  employeeCount: 3,
  numSites: 1,
  gstinStatus: 'NONE',
  fibreAvailable: true,
  connectivity: 'STANDARD',
  needs: ['CUSTOMER_OUTREACH'],
  counts: {},
};

describe('products and quotes', () => {
  let app: TestApp;
  let owner: ApiClient;

  beforeEach(async () => {
    app = await createTestApp();
    owner = await newVisitor();
    await grant(owner, 'advisor_profile');
  });
  afterEach(() => app.dispose());

  const createQuote = async (lines: Array<{ productId: string; quantity: number }>, profile: object = PROFILE) => {
    const response = await owner.post('/api/v1/quotes', { profile, lines });
    expect(response.status).toBe(201);
    return response.body;
  };

  describe('GET /products', () => {
    it('is public and pages through the whole catalogue', async () => {
      const visitor = new ApiClient();
      const first = await visitor.get('/api/v1/products?limit=10');
      expect(first.status).toBe(200);
      expect(first.body.items).toHaveLength(10);
      expect(first.body.nextCursor).toEqual(expect.any(String));

      const ids = first.body.items.map((item: { id: string }) => item.id);
      let cursor = first.body.nextCursor;
      while (cursor) {
        const page = await visitor.get(`/api/v1/products?limit=10&cursor=${cursor}`);
        ids.push(...page.body.items.map((item: { id: string }) => item.id));
        cursor = page.body.nextCursor;
      }
      expect(ids).toHaveLength(25);
      expect(new Set(ids).size).toBe(25);
    });

    it('gives one clear price and the rules a screen needs', async () => {
      const { body } = await new ApiClient().get('/api/v1/products?limit=25');
      const fibre = body.items.find((item: { id: string }) => item.id === 'P01');
      expect(fibre).toMatchObject({
        name: 'Biz Fibre 100',
        unit: 'per site',
        unitPriceInr: 1099,
        setupInr: 0,
        minContractMonths: 12,
        installDays: 5,
        requiresGstin: false,
        requiresOneOf: [],
      });
    });

    it('rejects an unknown query parameter', async () => {
      expectApiError(await new ApiClient().get('/api/v1/products?admin=1'), 400, 'INVALID_REQUEST');
    });
  });

  describe('POST /recommendations', () => {
    it('needs advisor consent', async () => {
      const stranger = await newVisitor();
      const response = await stranger.post('/api/v1/recommendations', DISCOVERY);
      expectApiError(response, 403, 'CONSENT_REQUIRED');
      expect(response.body.error.details).toEqual({ purpose: 'advisor_profile' });
    });

    it('returns a priced bundle and says why WhatsApp is blocked without a GSTIN', async () => {
      const response = await owner.post('/api/v1/recommendations', DISCOVERY);
      expect(response.status).toBe(200);
      const { body } = response;

      expect(body.profile).toMatchObject({ cityTier: 2, segment: 'micro' });
      expect(body.lines.map((line: { productId: string }) => line.productId)).toEqual(['P01']);
      expect(body.lines[0]).toMatchObject({ name: 'Biz Fibre 100', quantity: 1, reason: { kind: 'CONNECTIVITY' } });
      expect(body.quote.monthlyTotalInr).toBe(1099);

      const whatsapp = body.blocked.find((item: { productId: string }) => item.productId === 'P15');
      expect(whatsapp).toMatchObject({ eligible: false, need: 'CUSTOMER_OUTREACH', name: 'WhatsApp Business API Starter' });
      expect(whatsapp.blockers[0]).toMatchObject({ rule: 'GSTIN_REQUIRED', actual: 'NONE' });
      expect(whatsapp.alternatives).toEqual(['P18']);
    });

    it('prefers a tier given directly', async () => {
      const response = await owner.post('/api/v1/recommendations', { ...DISCOVERY, city: 'Nashik', cityTier: 1 });
      expect(response.body.profile.cityTier).toBe(1);
    });

    it('leaves an unknown city as an unknown tier, for the owner to answer', async () => {
      const response = await owner.post('/api/v1/recommendations', { ...DISCOVERY, city: 'Atlantis' });
      expect(response.status).toBe(200);
      expect(response.body.profile.cityTier).toBeNull();
    });

    it('rejects unknown fields', async () => {
      expectApiError(await owner.post('/api/v1/recommendations', { ...DISCOVERY, discount: 50 }), 400, 'INVALID_REQUEST');
    });

    it('rejects an unknown need', async () => {
      expectApiError(await owner.post('/api/v1/recommendations', { ...DISCOVERY, needs: ['FREE_STUFF'] }), 400, 'INVALID_REQUEST');
    });

    it('stores nothing about the owner', async () => {
      await owner.post('/api/v1/recommendations', DISCOVERY);
      const rows = await app.testDb.client.execute('SELECT COUNT(*) AS total FROM quotes');
      expect(Number(rows.rows[0]?.total)).toBe(0);
    });
  });

  describe('POST /quotes', () => {
    it('needs advisor consent', async () => {
      const stranger = await newVisitor();
      const response = await stranger.post('/api/v1/quotes', { profile: PROFILE, lines: [] });
      expectApiError(response, 403, 'CONSENT_REQUIRED');
    });

    it('prices the bundle in code, with one monthly total, setup fee and contract', async () => {
      const quote = await createQuote([
        { productId: 'P02', quantity: 1 },
        { productId: 'P09', quantity: 1 },
        { productId: 'P08', quantity: 3 },
      ]);
      expect(quote.id).toMatch(/^qt_/);
      expect(quote.status).toBe('DRAFT');
      expect(quote.priceBasis).toBe('EXCL_GST');
      expect(quote.lines.map((line: { name: string }) => line.name)).toContain('Biz Fibre 300');
      for (const line of quote.lines) {
        expect(line.monthlyInr).toBe(line.unitPriceInr * line.quantity);
      }
      const total = quote.lines.reduce((sum: number, line: { monthlyInr: number }) => sum + line.monthlyInr, 0);
      expect(quote.monthlyTotalInr).toBe(total);
      expect(quote.contractMonths).toBe(12);
      expect(quote.blocked).toEqual([]);
      expect(quote.comparison).toBeNull();
    });

    it('reports a line the rules block, instead of selling it or dropping it silently', async () => {
      const quote = await createQuote(
        [
          { productId: 'P01', quantity: 1 },
          { productId: 'P15', quantity: 1 },
        ],
        NO_GSTIN_PROFILE,
      );
      expect(quote.lines.map((line: { productId: string }) => line.productId)).toEqual(['P01']);
      expect(quote.blocked).toHaveLength(1);
      expect(quote.blocked[0]).toMatchObject({ productId: 'P15', name: 'WhatsApp Business API Starter', eligible: false });
    });

    it('blocks a dependent product with no base in the bundle', async () => {
      const quote = await createQuote(
        [
          { productId: 'P04', quantity: 1 },
          { productId: 'P09', quantity: 1 },
        ],
        NO_GSTIN_PROFILE,
      );
      expect(quote.lines.map((line: { productId: string }) => line.productId)).toEqual(['P04']);
      expect(quote.blocked[0]).toMatchObject({ productId: 'P09' });
      expect(quote.blocked[0].blockers[0].rule).toBe('DEPENDENCY');
    });

    it('rejects a product not in the catalogue', async () => {
      const response = await owner.post('/api/v1/quotes', {
        profile: PROFILE,
        lines: [{ productId: 'P99', quantity: 1 }],
      });
      expectApiError(response, 422, 'UNKNOWN_PRODUCT');
    });

    it.each([
      ['a duplicate product', { profile: PROFILE, lines: [{ productId: 'P01', quantity: 1 }, { productId: 'P01', quantity: 2 }] }],
      ['a zero quantity', { profile: PROFILE, lines: [{ productId: 'P01', quantity: 0 }] }],
      ['a fractional quantity', { profile: PROFILE, lines: [{ productId: 'P01', quantity: 1.5 }] }],
      ['an unknown field', { profile: PROFILE, lines: [], price: 1 }],
      ['an unknown line field', { profile: PROFILE, lines: [{ productId: 'P01', quantity: 1, unitPriceInr: 1 }] }],
      ['an unknown profile field', { profile: { ...PROFILE, ownerName: 'X' }, lines: [] }],
    ])('rejects %s', async (_label, body) => {
      expectApiError(await owner.post('/api/v1/quotes', body), 400, 'INVALID_REQUEST');
    });
  });

  describe('changing lines', () => {
    it('shows the contract jump when an add-on needs a longer term', async () => {
      const quote = await createQuote([{ productId: 'P02', quantity: 1 }]);
      const response = await owner.put(`/api/v1/quotes/${quote.id}/lines/P21`, { quantity: 1 });
      expect(response.status).toBe(200);
      expect(response.body.applied).toBe(true);
      expect(response.body.comparison).toMatchObject({
        contractChanged: true,
        contractMonthsBefore: 12,
        contractMonthsAfter: 24,
      });
      expect(response.body.comparison.monthlyDeltaInr).toBeGreaterThan(0);
      expect(response.body.revision).toBe(quote.revision + 1);
    });

    it('reports a blocked add-on and leaves the quote as it was', async () => {
      const quote = await createQuote([{ productId: 'P01', quantity: 1 }], NO_GSTIN_PROFILE);
      const response = await owner.put(`/api/v1/quotes/${quote.id}/lines/P15`, { quantity: 1 });
      expect(response.status).toBe(200);
      expect(response.body.applied).toBe(false);
      expect(response.body.blocked[0]).toMatchObject({ productId: 'P15' });
      expect(response.body.blocked[0].blockers[0].rule).toBe('GSTIN_REQUIRED');
      expect(response.body.monthlyTotalInr).toBe(quote.monthlyTotalInr);
      expect(response.body.revision).toBe(quote.revision);
      expect(response.body.comparison.monthlyDeltaInr).toBe(0);
    });

    it('changes the quantity of a line it already has', async () => {
      const quote = await createQuote([{ productId: 'P01', quantity: 1 }]);
      const response = await owner.put(`/api/v1/quotes/${quote.id}/lines/P01`, { quantity: 3 });
      expect(response.body.lines).toHaveLength(1);
      expect(response.body.lines[0]).toMatchObject({ quantity: 3, monthlyInr: 3297 });
      expect(response.body.comparison.monthlyDeltaInr).toBe(2198);
    });

    it('uses the domain default when no quantity is given', async () => {
      const quote = await createQuote([{ productId: 'P01', quantity: 1 }], { ...PROFILE, numSites: 4, employeeCount: 12 });
      const response = await owner.put(`/api/v1/quotes/${quote.id}/lines/P02`, {});
      const line = response.body.lines.find((item: { productId: string }) => item.productId === 'P02');
      expect(line.quantity).toBe(4);
    });

    it('warns about and removes the add-ons that lose their base', async () => {
      const quote = await createQuote(
        [
          { productId: 'P01', quantity: 1 },
          { productId: 'P09', quantity: 1 },
          { productId: 'P22', quantity: 1 },
          { productId: 'P08', quantity: 1 },
        ],
      );
      const response = await owner.delete(`/api/v1/quotes/${quote.id}/lines/P01`);
      expect(response.status).toBe(200);
      expect(response.body.lines.map((line: { productId: string }) => line.productId)).toEqual(['P08']);
      expect(response.body.stranded.map((item: { productId: string }) => item.productId).sort()).toEqual(['P09', 'P22']);
      expect(response.body.stranded[0]).toMatchObject({ name: expect.any(String), requiredOneOf: expect.any(Array) });
      expect(response.body.comparison.monthlyDeltaInr).toBeLessThan(0);
    });

    it('keeps an add-on when another valid base remains', async () => {
      const quote = await createQuote([
        { productId: 'P01', quantity: 1 },
        { productId: 'P02', quantity: 1 },
        { productId: 'P09', quantity: 1 },
      ]);
      const response = await owner.delete(`/api/v1/quotes/${quote.id}/lines/P01`);
      expect(response.body.stranded).toEqual([]);
      expect(response.body.lines.map((line: { productId: string }) => line.productId).sort()).toEqual(['P02', 'P09']);
    });

    it('treats removing a line it does not have as no change', async () => {
      const quote = await createQuote([{ productId: 'P01', quantity: 1 }]);
      const response = await owner.delete(`/api/v1/quotes/${quote.id}/lines/P02`);
      expect(response.status).toBe(200);
      expect(response.body.applied).toBe(false);
    });

    it('returns 404 for a product that does not exist', async () => {
      const quote = await createQuote([{ productId: 'P01', quantity: 1 }]);
      expectApiError(await owner.put(`/api/v1/quotes/${quote.id}/lines/P99`, { quantity: 1 }), 404, 'NOT_FOUND');
    });

    it('rejects unknown fields on a line', async () => {
      const quote = await createQuote([{ productId: 'P01', quantity: 1 }]);
      expectApiError(await owner.put(`/api/v1/quotes/${quote.id}/lines/P01`, { quantity: 1, unitPriceInr: 1 }), 400, 'INVALID_REQUEST');
    });

    it('persists changes across a read', async () => {
      const quote = await createQuote([{ productId: 'P01', quantity: 1 }]);
      await owner.put(`/api/v1/quotes/${quote.id}/lines/P01`, { quantity: 2 });
      const read = await owner.get(`/api/v1/quotes/${quote.id}`);
      expect(read.body.lines[0].quantity).toBe(2);
      expect(read.body.comparison).toBeNull();
    });
  });

  describe('ownership', () => {
    it("hides another owner's quote behind a 404 on every route", async () => {
      const quote = await createQuote([{ productId: 'P01', quantity: 1 }]);
      const other = await newVisitor();
      await grant(other, 'advisor_profile');
      await verifyPhone(other, '9000000001');

      expectApiError(await other.get(`/api/v1/quotes/${quote.id}`), 404, 'NOT_FOUND');
      expectApiError(await other.put(`/api/v1/quotes/${quote.id}/lines/P02`, { quantity: 1 }), 404, 'NOT_FOUND');
      expectApiError(await other.delete(`/api/v1/quotes/${quote.id}/lines/P01`), 404, 'NOT_FOUND');
      expectApiError(await other.post(`/api/v1/quotes/${quote.id}/acceptance`), 404, 'NOT_FOUND');
      expectApiError(await other.post(`/api/v1/quotes/${quote.id}/save`), 404, 'NOT_FOUND');
    });

    it('returns 401 with no session', async () => {
      expectApiError(await new ApiClient().get('/api/v1/quotes/qt_anything'), 401, 'SESSION_REQUIRED');
    });

    it('only lists the owner\'s own quotes', async () => {
      await createQuote([{ productId: 'P01', quantity: 1 }]);
      const other = await newVisitor();
      const list = await other.get('/api/v1/quotes');
      expect(list.status).toBe(200);
      expect(list.body.items).toEqual([]);
    });
  });

  describe('acceptance and saving', () => {
    it('asks for a verified phone only at acceptance', async () => {
      const quote = await createQuote([{ productId: 'P01', quantity: 1 }]);
      expectApiError(await owner.post(`/api/v1/quotes/${quote.id}/acceptance`), 403, 'PHONE_VERIFICATION_REQUIRED');

      await verifyPhone(owner);
      const accepted = await owner.post(`/api/v1/quotes/${quote.id}/acceptance`);
      expect(accepted.status).toBe(200);
      expect(accepted.body).toMatchObject({ status: 'ACCEPTED' });
      expect(accepted.body.acceptedAt).toEqual(expect.any(String));
    });

    it('rejects an empty quote', async () => {
      const quote = await createQuote([]);
      await verifyPhone(owner);
      expectApiError(await owner.post(`/api/v1/quotes/${quote.id}/acceptance`), 422, 'EMPTY_QUOTE');
    });

    it('locks an accepted quote', async () => {
      const quote = await createQuote([{ productId: 'P01', quantity: 1 }]);
      await verifyPhone(owner);
      await owner.post(`/api/v1/quotes/${quote.id}/acceptance`);
      expectApiError(await owner.put(`/api/v1/quotes/${quote.id}/lines/P01`, { quantity: 2 }), 409, 'QUOTE_LOCKED');
      expectApiError(await owner.delete(`/api/v1/quotes/${quote.id}/lines/P01`), 409, 'QUOTE_LOCKED');
      expectApiError(await owner.post(`/api/v1/quotes/${quote.id}/save`), 409, 'QUOTE_LOCKED');
    });

    it('accepts twice without changing anything', async () => {
      const quote = await createQuote([{ productId: 'P01', quantity: 1 }]);
      await verifyPhone(owner);
      const first = await owner.post(`/api/v1/quotes/${quote.id}/acceptance`);
      const second = await owner.post(`/api/v1/quotes/${quote.id}/acceptance`);
      expect(second.status).toBe(200);
      expect(second.body.acceptedAt).toBe(first.body.acceptedAt);
    });

    it('saves a quote for later, with no phone needed, and can still change it', async () => {
      const quote = await createQuote([{ productId: 'P01', quantity: 1 }]);
      const saved = await owner.post(`/api/v1/quotes/${quote.id}/save`);
      expect(saved.status).toBe(200);
      expect(saved.body.status).toBe('SAVED');
      expect(saved.body.savedAt).toEqual(expect.any(String));
      expect((await owner.put(`/api/v1/quotes/${quote.id}/lines/P01`, { quantity: 2 })).status).toBe(200);
    });

    it('finds a saved quote from the session, so the owner can resume', async () => {
      const quote = await createQuote([{ productId: 'P01', quantity: 1 }]);
      await owner.post(`/api/v1/quotes/${quote.id}/save`);

      const current = await owner.get('/api/v1/sessions/current');
      expect(current.body.journey).toMatchObject({ quoteId: quote.id, orderId: null });
      const list = await owner.get('/api/v1/quotes');
      expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([quote.id]);
    });

    it('resumes on a new device once the phone is verified again', async () => {
      await verifyPhone(owner);
      const quote = await createQuote([{ productId: 'P01', quantity: 1 }]);
      await owner.post(`/api/v1/quotes/${quote.id}/save`);

      const device = await newVisitor();
      await verifyPhone(device);
      const read = await device.get(`/api/v1/quotes/${quote.id}`);
      expect(read.status).toBe(200);
      expect(read.body.status).toBe('SAVED');
    });

    it('pages through quotes with a cursor', async () => {
      for (let i = 0; i < 3; i++) await createQuote([{ productId: 'P01', quantity: i + 1 }]);
      const first = await owner.get('/api/v1/quotes?limit=2');
      expect(first.body.items).toHaveLength(2);
      const second = await owner.get(`/api/v1/quotes?limit=2&cursor=${first.body.nextCursor}`);
      expect(second.body.items).toHaveLength(1);
      expect(second.body.nextCursor).toBeNull();
    });
  });
});
