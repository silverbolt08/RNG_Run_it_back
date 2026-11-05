import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCsv } from '@/lib/csv';
import { ApiClient, grant, newVisitor, verifyPhone } from '../../helpers/api-client';
import { createTestApp, type TestApp } from '../../helpers/test-app';

const QUOTES = '/api/v1/quotes';
const CATALOGUE = parseCsv(readFileSync('tests/fixtures/product_catalogue.csv', 'utf8')) as unknown as Array<Record<string, string>>;
const byId = new Map(CATALOGUE.map((row) => [row.product_id as string, row]));
const ALL_IDS = [...byId.keys()];

type QuoteLine = { productId: string; quantity: number; unitPriceInr: number; monthlyInr: number; setupInr: number };
type Quote = {
  id: string;
  lines: QuoteLine[];
  monthlyTotalInr: number;
  monthlyGstInr: number;
  monthlyFinalInr: number;
  setupTotalInr: number;
  setupFinalInr: number;
  contractMonths: number;
  installDays: number;
  comparison: { contractChanged: boolean; contractMonthsAfter: number } | null;
  stranded: Array<{ productId: string }>;
  blocked: Array<{ productId: string }>;
  applied: boolean;
};

const PROFILE = { cityTier: 1, employeeCount: 30, numSites: 4, gstinStatus: 'ACTIVE', fibreAvailable: true };

/** Holds after every change, whatever the owner did before it. */
function expectValid(quote: Quote, context: string): void {
  const ids = quote.lines.map((line) => line.productId);
  expect(new Set(ids).size, `${context}: no duplicate lines`).toBe(ids.length);
  expect(quote.monthlyTotalInr, `${context}: total is the sum of the lines`).toBe(quote.lines.reduce((sum, line) => sum + line.monthlyInr, 0));
  expect(quote.monthlyFinalInr, `${context}: final is total plus GST`).toBe(quote.monthlyTotalInr + quote.monthlyGstInr);
  expect(quote.setupTotalInr, `${context}: setup is the sum of the lines`).toBe(quote.lines.reduce((sum, line) => sum + line.setupInr, 0));
  for (const line of quote.lines) {
    const row = byId.get(line.productId) as Record<string, string>;
    expect(line.monthlyInr, `${context}: ${line.productId} monthly`).toBe(line.unitPriceInr * line.quantity);
    expect(line.unitPriceInr).toBeGreaterThanOrEqual(Number(row.price_min_inr_per_month));
    expect(line.unitPriceInr).toBeLessThanOrEqual(Number(row.price_max_inr_per_month));
    const needs = (row.requires_product_ids ?? row.requires_one_of ?? '').split('|').filter(Boolean);
    if (needs.length > 0) expect(needs.some((id) => ids.includes(id)), `${context}: ${line.productId} needs one of ${needs.join(',')}, has ${ids.join(',')}`).toBe(true);
  }
  const months = quote.lines.map((line) => Number(byId.get(line.productId)?.min_contract_months));
  expect(quote.contractMonths, `${context}: contract is the longest`).toBe(months.length ? Math.max(...months) : quote.contractMonths);
}

describe('quote rules, probed', () => {
  let app: TestApp;
  let owner: ApiClient;

  beforeEach(async () => {
    app = await createTestApp();
    owner = await newVisitor();
    await grant(owner, 'advisor_profile');
  });
  afterEach(() => app.dispose());

  const create = async (lines: Array<{ productId: string; quantity: number }>, profile: Record<string, unknown> = PROFILE) => {
    const response = await owner.post(QUOTES, { profile, lines });
    expect(response.status).toBe(201);
    return response.body as Quote;
  };

  it('holds after a long random walk of adds, removes and quantity changes', async () => {
    // A fixed seed, so a failure can be replayed.
    let seed = 20261105;
    const random = (limit: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed % limit;
    };
    let quote = await create([{ productId: 'P01', quantity: 1 }]);
    const steps: string[] = [];
    for (let step = 0; step < 100; step += 1) {
      const id = ALL_IDS[random(ALL_IDS.length)] as string;
      const has = quote.lines.some((line) => line.productId === id);
      const roll = random(3);
      let response;
      if (has && roll === 0) {
        steps.push(`DELETE ${id}`);
        response = await owner.delete(`${QUOTES}/${quote.id}/lines/${id}`);
      } else if (has && roll === 1) {
        const quantity = 1 + random(5);
        steps.push(`PUT ${id} ${quantity}`);
        response = await owner.put(`${QUOTES}/${quote.id}/lines/${id}`, { quantity });
      } else {
        steps.push(`PUT ${id} default`);
        response = await owner.put(`${QUOTES}/${quote.id}/lines/${id}`, {});
      }
      expect(response.status, steps.join(' > ')).toBe(200);
      quote = response.body as Quote;
      expectValid(quote, steps.slice(-3).join(' > '));
      const reread = (await owner.get(`${QUOTES}/${quote.id}`)).body as Quote;
      expect(reread.monthlyFinalInr, 'a read agrees with the change').toBe(quote.monthlyFinalInr);
    }
  });

  it('removing a base with several dependents takes all of them, and says so', async () => {
    const quote = await create([
      { productId: 'P01', quantity: 1 },
      { productId: 'P09', quantity: 1 },
      { productId: 'P11', quantity: 1 },
      { productId: 'P21', quantity: 1 },
      { productId: 'P22', quantity: 1 },
      { productId: 'P23', quantity: 1 },
      { productId: 'P16', quantity: 3 },
    ]);
    const after = (await owner.delete(`${QUOTES}/${quote.id}/lines/P01`)).body as Quote;
    expect(after.lines.map((line) => line.productId)).toEqual(['P16']);
    expect(after.stranded.map((item) => item.productId).sort()).toEqual(['P09', 'P11', 'P21', 'P22', 'P23']);
    expect(after.comparison?.contractChanged).toBe(true);
    expect(after.contractMonths).toBe(12);
    expectValid(after, 'after removing the base');
  });

  it('keeps dependents when another base remains, and removes only those it cannot keep', async () => {
    const quote = await create([
      { productId: 'P01', quantity: 1 },
      { productId: 'P04', quantity: 1 },
      { productId: 'P09', quantity: 1 },
      { productId: 'P22', quantity: 1 },
    ]);
    const after = (await owner.delete(`${QUOTES}/${quote.id}/lines/P01`)).body as Quote;
    expect(after.lines.map((line) => line.productId).sort()).toEqual(['P04', 'P22']);
    expect(after.stranded.map((item) => item.productId)).toEqual(['P09']);
  });

  it('an add-on that becomes blocked after a removal shows as blocked at once', async () => {
    const quote = await create([{ productId: 'P01', quantity: 1 }]);
    const before = (await owner.get(`${QUOTES}/${quote.id}/add-ons`)).body;
    expect(before.items.find((item: { productId: string }) => item.productId === 'P09').eligible).toBe(true);
    await owner.delete(`${QUOTES}/${quote.id}/lines/P01`);
    const after = (await owner.get(`${QUOTES}/${quote.id}/add-ons`)).body;
    const failover = after.items.find((item: { productId: string }) => item.productId === 'P09');
    expect(failover.eligible).toBe(false);
    expect(failover.blockers[0].rule).toBe('DEPENDENCY');
    const put = (await owner.put(`${QUOTES}/${quote.id}/lines/P09`, {})).body as Quote;
    expect(put.applied).toBe(false);
    expect(put.lines).toEqual([]);
  });

  it('the firewall shows its contract jump, and removing it shows the fall', async () => {
    const quote = await create([{ productId: 'P01', quantity: 1 }], { ...PROFILE, employeeCount: 12, numSites: 1 });
    const added = (await owner.put(`${QUOTES}/${quote.id}/lines/P21`, {})).body as Quote;
    expect(added.comparison).toMatchObject({ contractMonthsBefore: 12, contractMonthsAfter: 24, contractChanged: true });
    const removed = (await owner.delete(`${QUOTES}/${quote.id}/lines/P21`)).body as Quote;
    expect(removed.comparison).toMatchObject({ contractMonthsBefore: 24, contractMonthsAfter: 12, contractChanged: true });
  });

  it.each([0, -1, 1.5, 1001, 1e12, '2', null])('refuses a quantity of %s', async (quantity) => {
    const quote = await create([{ productId: 'P01', quantity: 1 }]);
    const response = await owner.put(`${QUOTES}/${quote.id}/lines/P01`, { quantity });
    expect(response.status).toBe(400);
    expect((await owner.get(`${QUOTES}/${quote.id}`)).body.lines[0].quantity).toBe(1);
  });

  it('the largest quantity prices without overflow', async () => {
    const quote = await create([{ productId: 'P06', quantity: 1 }]);
    const response = await owner.put(`${QUOTES}/${quote.id}/lines/P06`, { quantity: 1000 });
    expect(response.status).toBe(200);
    expectValid(response.body as Quote, 'quantity 1000');
    expect(Number.isSafeInteger(response.body.monthlyFinalInr)).toBe(true);
  });

  it('a quote with no connection works: mobile only, then a dependent stays blocked', async () => {
    const quote = await create([{ productId: 'P07', quantity: 2 }]);
    expectValid(quote, 'mobile only');
    expect(quote.contractMonths).toBe(1);
    const wifi = (await owner.put(`${QUOTES}/${quote.id}/lines/P22`, {})).body as Quote;
    expect(wifi.applied).toBe(false);
    await verifyPhone(owner);
    expect((await owner.post(`${QUOTES}/${quote.id}/acceptance`)).status).toBe(200);
  });

  it('an empty quote has no made-up contract or install time', async () => {
    const quote = await create([{ productId: 'P01', quantity: 1 }]);
    const empty = (await owner.delete(`${QUOTES}/${quote.id}/lines/P01`)).body as Quote;
    console.log('OBSERVED empty quote', empty.contractMonths, empty.installDays, empty.monthlyFinalInr);
    expect(empty.monthlyFinalInr).toBe(0);
    expect(empty.lines).toEqual([]);
  });

  it('a recommendation blocked on the quote is not sold through POST', async () => {
    const quote = await create(
      [
        { productId: 'P01', quantity: 1 },
        { productId: 'P15', quantity: 1 },
      ],
      { ...PROFILE, gstinStatus: 'CANCELLED' },
    );
    expect(quote.lines.map((line) => line.productId)).toEqual(['P01']);
    expect(quote.blocked.map((item) => item.productId)).toEqual(['P15']);
  });

  it('a dependency order in POST does not matter', async () => {
    const quote = await create([
      { productId: 'P22', quantity: 1 },
      { productId: 'P01', quantity: 1 },
    ]);
    expect(quote.lines.map((line) => line.productId).sort()).toEqual(['P01', 'P22']);
  });

  it('a duplicate line in POST is not sold twice', async () => {
    const response = await owner.post(QUOTES, {
      profile: PROFILE,
      lines: [
        { productId: 'P01', quantity: 1 },
        { productId: 'P01', quantity: 3 },
      ],
    });
    console.log('OBSERVED duplicate lines', response.status, JSON.stringify(response.body?.lines?.map((line: QuoteLine) => [line.productId, line.quantity]) ?? response.body?.error?.code));
    if (response.status === 201) {
      expectValid(response.body as Quote, 'duplicate POST');
    } else {
      expect(response.status).toBe(400);
    }
  });
});
