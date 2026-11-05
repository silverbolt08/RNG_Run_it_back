import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient, expectApiError, grant, newVisitor } from '../../helpers/api-client';
import { ScriptedLlm } from '../../helpers/scripted-llm';
import { addLead, createTestApp, type TestApp } from '../../helpers/test-app';

const PROFILE = { cityTier: 1, employeeCount: 6, numSites: 1, gstinStatus: 'NONE', fibreAvailable: true };

describe('add-ons', () => {
  let app: TestApp;
  let owner: ApiClient;

  beforeEach(async () => {
    app = await createTestApp();
    owner = await newVisitor();
    await grant(owner, 'advisor_profile');
  });
  afterEach(() => app.dispose());

  const quoteWith = async (productIds: string[]) => {
    const created = await owner.post('/api/v1/quotes', { profile: PROFILE, lines: productIds.map((productId) => ({ productId, quantity: 1 })) });
    return created.body.id as string;
  };

  it('lists everything else, with the answer from the rules', async () => {
    const id = await quoteWith(['P01']);
    const { body } = await owner.get(`/api/v1/quotes/${id}/add-ons`);

    expect(body.items).toHaveLength(24);
    expect(body.items.find((item: { productId: string }) => item.productId === 'P01')).toBeUndefined();
    expect(body.items.find((item: { productId: string }) => item.productId === 'P22')).toMatchObject({ eligible: true, unitPriceInr: 499, setupInr: 1000 });

    const whatsApp = body.items.find((item: { productId: string }) => item.productId === 'P15');
    expect(whatsApp).toMatchObject({ eligible: false, blockers: [{ rule: 'GSTIN_REQUIRED' }], alternatives: ['P18'] });
    expect(body.names.P18).toBe('Website + Domain Starter');
  });

  it('judges a dependent by what is in the bundle right now', async () => {
    const withBase = await quoteWith(['P01']);
    const withoutBase = await quoteWith(['P07']);
    const find = async (id: string) =>
      ((await owner.get(`/api/v1/quotes/${id}/add-ons`)).body.items as Array<{ productId: string; eligible: boolean }>).find((item) => item.productId === 'P09');

    expect((await find(withBase))?.eligible).toBe(true);
    expect((await find(withoutBase))?.eligible).toBe(false);
  });

  it("returns 404 for another owner's quote, and needs consent", async () => {
    const id = await quoteWith(['P01']);
    const stranger = await newVisitor();
    expectApiError(await stranger.get(`/api/v1/quotes/${id}/add-ons`), 403, 'CONSENT_REQUIRED');
    await grant(stranger, 'advisor_profile');
    expectApiError(await stranger.get(`/api/v1/quotes/${id}/add-ons`), 404, 'NOT_FOUND');
  });
});

describe('the back office', () => {
  let app: TestApp;
  let llm: ScriptedLlm;
  const anyone = new ApiClient();

  beforeEach(async () => {
    llm = new ScriptedLlm();
    app = await createTestApp({ llm });
  });
  afterEach(() => app.dispose());

  it('refuses without the admin token', async () => {
    expectApiError(await anyone.get('/api/v1/admin/handoffs'), 403, 'ADMIN_REQUIRED');
    expectApiError(await anyone.get('/api/v1/admin/leads'), 403, 'ADMIN_REQUIRED');
  });

  it('lists a handoff with business facts, and no chat text', async () => {
    const owner = await newVisitor();
    await grant(owner, 'advisor_profile');
    await grant(owner, 'ai_chat');
    const { body } = await owner.post('/api/v1/conversations', { language: 'en' });
    llm.willRead({ businessType: 'salon', city: 'Pune', employeeCount: 4, addNeeds: ['CCTV'], intents: ['WANTS_HUMAN'] });
    await owner.post(`/api/v1/conversations/${body.id}/messages`, { text: 'PRIVATE-WORDS: please get me a person', language: 'en' });

    const list = await anyone.admin('GET', '/api/v1/admin/handoffs');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ reason: 'REQUESTED', businessType: 'salon', city: 'Pune', employeeCount: 4, needs: ['CCTV'] });
    expect(JSON.stringify(list.body)).not.toContain('PRIVATE-WORDS');
  });

  it('ranks leads by score, showing no name or identifier', async () => {
    await addLead(app, { id: 'L1', gstin: '27XUIXG0767D1ZP', contactName: 'Private Person', businessName: 'Private Business' });
    await addLead(app, { id: 'L2', gstin: null, contactName: 'Other Person', businessName: 'Other Business' });

    const { body } = await anyone.admin('GET', '/api/v1/admin/leads');
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(['L1', 'L2']);
    expect(body.items[0].score).toBeGreaterThan(body.items[1].score);
    expect(body.items[0].hasGstin).toBe(true);

    const text = JSON.stringify(body);
    for (const value of ['27XUIXG0767D1ZP', 'Private Person', 'Private Business']) expect(text).not.toContain(value);
  });
});
