import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient, grant, newVisitor } from '../../helpers/api-client';
import { ScriptedLlm } from '../../helpers/scripted-llm';
import { createTestApp, type TestApp } from '../../helpers/test-app';

const CONVERSATIONS = '/api/v1/conversations';
const FACTS = { businessType: 'salon', city: 'Pune', employeeCount: 4, numSites: 1, gstinStatus: 'ACTIVE', fibreAvailable: true };
const READY = { ...FACTS, noOtherNeeds: true };

type Line = { productId: string; quantity: number };
const ids = (body: { recommendation: { lines: Line[] } | null }) => body.recommendation?.lines.map((line) => line.productId);

describe('advisor logic with a scripted LLM', () => {
  let app: TestApp;
  let llm: ScriptedLlm;
  let owner: ApiClient;

  beforeEach(async () => {
    llm = new ScriptedLlm();
    app = await createTestApp({ llm });
    owner = await newVisitor();
    await grant(owner, 'advisor_profile');
    await grant(owner, 'ai_chat');
  });
  afterEach(() => app.dispose());

  const start = async () => (await owner.post(CONVERSATIONS, { language: 'en' })).body.id as string;
  const say = (id: string, text: string, language = 'en') => owner.post(`${CONVERSATIONS}/${id}/messages`, { text, language });
  const tap = (id: string, slot: string, value: unknown) => owner.post(`${CONVERSATIONS}/${id}/messages`, { answer: { slot, value }, language: 'en' });
  const quoteFrom = (recommendation: { profile: Record<string, unknown>; lines: Line[] }) => {
    const { cityTier, employeeCount, numSites, gstinStatus, fibreAvailable } = recommendation.profile;
    return owner.post('/api/v1/quotes', {
      profile: { cityTier, employeeCount, numSites, gstinStatus, fibreAvailable },
      lines: recommendation.lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
    });
  };

  describe('changing facts after a recommendation', () => {
    it('a later contradiction re-runs the rules and names the change', async () => {
      const id = await start();
      llm.willRead({ ...FACTS, addNeeds: ['SECURITY'] });
      const first = await say(id, 'salon in Pune, 4 of us, active GST, fibre yes, security');
      expect(first.body.askedSlot).toBeNull();
      llm.willRead({ employeeCount: 12 });
      const changed = await say(id, 'actually we are 12');
      expect(changed.body.facts.employeeCount).toBe(12);
      expect(changed.body.recommendation).not.toBeNull();
    });

    it('city from known to unknown asks the tier and hides the old bundle', async () => {
      const id = await start();
      llm.willRead(READY);
      await say(id, 'salon...');
      llm.willRead({ city: 'Sangli' });
      const moved = await say(id, 'we moved to Sangli');
      expect(moved.body.facts.cityTier).toBeNull();
      expect(moved.body.askedSlot).toBe('CITY_TIER');
      expect(moved.body.recommendation).toBeNull();
      const tier = await tap(id, 'CITY_TIER', 2);
      expect(tier.body.askedSlot).toBeNull();
      expect(ids(tier.body)).toEqual(['P01']);
    });

    it('tier chosen for an unknown city does not survive moving to another unknown city', async () => {
      const id = await start();
      llm.willRead({ ...READY, city: 'Sangli' });
      await say(id, 'salon...');
      await tap(id, 'CITY_TIER', 2);
      llm.willRead({ city: 'Karad' });
      const moved = await say(id, 'moved to Karad');
      expect(moved.body.facts.cityTier).toBeNull();
      expect(moved.body.askedSlot).toBe('CITY_TIER');
    });

    it('GST status changing removes and restores WhatsApp', async () => {
      const id = await start();
      llm.willRead({ ...FACTS, addNeeds: ['CUSTOMER_OUTREACH'] });
      const first = await say(id, 'salon with WhatsApp');
      expect(ids(first.body)).toContain('P15');
      llm.willRead({ gstinStatus: 'CANCELLED' });
      const cancelled = await say(id, 'our GST got cancelled');
      expect(ids(cancelled.body)).not.toContain('P15');
      expect(cancelled.body.recommendation.blocked.map((item: { productId: string }) => item.productId)).toContain('P15');
      llm.willRead({ gstinStatus: 'ACTIVE' });
      const back = await say(id, 'sorry, it is active');
      expect(ids(back.body)).toContain('P15');
    });

    it('removing a need drops its product', async () => {
      const id = await start();
      llm.willRead({ ...FACTS, addNeeds: ['GUEST_WIFI', 'CCTV'] });
      const first = await say(id, 'wifi and cameras');
      expect(ids(first.body)).toEqual(['P01', 'P22', 'P23']);
      llm.willRead({ removeNeeds: ['CCTV'] });
      const fewer = await say(id, 'no cameras');
      expect(ids(fewer.body)).toEqual(['P01', 'P22']);
    });

    it('removing a product by name drops it, even if a need led to it', async () => {
      const id = await start();
      llm.willRead({ ...FACTS, addNeeds: ['CUSTOMER_OUTREACH'] });
      const first = await say(id, 'WhatsApp');
      expect(ids(first.body)).toContain('P15');
      // The tool offers removeProducts for "products they no longer want", so a model can use it alone.
      llm.willRead({ removeProducts: ['P15'] });
      const fewer = await say(id, 'remove the WhatsApp Business API please');
      expect(ids(fewer.body)).not.toContain('P15');
    });

    it('removing a need drops a product named outright for that need', async () => {
      const id = await start();
      llm.willRead({ ...FACTS, addNeeds: ['CUSTOMER_OUTREACH'], addProducts: ['P15'] });
      const first = await say(id, 'I want WhatsApp Business API');
      expect(ids(first.body)).toContain('P15');
      llm.willRead({ removeNeeds: ['CUSTOMER_OUTREACH'] });
      const fewer = await say(id, 'no WhatsApp after all');
      expect(ids(fewer.body)).not.toContain('P15');
    });

    it('going from many sites back to one undoes the multi-site segment', async () => {
      const id = await start();
      llm.willRead({ ...READY, businessType: 'flower business', segmentGuess: 'micro', numSites: 1 });
      const one = await say(id, 'flower business, one site');
      expect(ids(one.body)).toEqual(['P01']);
      llm.willRead({ numSites: 4 });
      const four = await say(id, 'actually 4 sites');
      expect(four.body.facts.segment).toBe('multi');
      llm.willRead({ numSites: 1 });
      const backToOne = await say(id, 'sorry, 1 site');
      expect(backToOne.body.facts.segment).toBe('micro');
      expect(ids(backToOne.body)).toEqual(['P01']);
    });
  });

  describe('nothing to sell', () => {
    it('connectivity NONE and no needs gets an honest reply and a way on', async () => {
      const id = await start();
      llm.willRead({ ...READY, connectivity: 'NONE' });
      llm.down = false;
      const response = await say(id, 'I do not want internet, I need nothing');
      // Nothing to recommend yet, so it asks what they need rather than showing an empty bundle.
      expect(response.body.askedSlot).toBe('NEEDS');
      expect(response.body.recommendation).toBeNull();
      const last = response.body.messages.at(-1).text as string;
      expect(response.body.status).toBe('OPEN');
      // Nothing was refused here, so the reply must not say something they asked for can't be sold.
      expect(last.toLowerCase()).not.toMatch(/can't be sold|cannot be sold|nothing you asked|can't offer what/);
    });

    it('connectivity NONE with a need that requires a base explains how to fix it', async () => {
      const id = await start();
      llm.willRead({ ...READY, connectivity: 'NONE', addNeeds: ['GUEST_WIFI'] });
      const response = await say(id, 'only guest wifi, no internet');
      expect(ids(response.body)).toEqual([]);
      const blocked = response.body.recommendation.blocked[0];
      console.log('OBSERVED', JSON.stringify(blocked), response.body.messages.at(-1).text);
      expect(blocked.productId).toBe('P22');
      expect(blocked.blockers[0].rule).toBe('DEPENDENCY');
    });

    it('wanting guest Wi-Fi and nothing else, in the first message, is told what it needs', async () => {
      const id = await start();
      llm.down = false;
      llm.willRead({ ...READY, addNeeds: ['GUEST_WIFI', 'CCTV'] });
      const response = await say(id, 'salon in Pune, I just need guest wifi and CCTV, nothing else');
      console.log('OBSERVED wifi and nothing else', JSON.stringify(response.body.facts.connectivity), JSON.stringify(ids(response.body)), JSON.stringify(response.body.recommendation.blocked.map((b: { productId: string; blockers: Array<{ rule: string }> }) => [b.productId, b.blockers[0]?.rule])));
      // Both need a connection the owner never refused. A bundle of nothing helps nobody.
      expect(ids(response.body)).toEqual(['P01', 'P22', 'P23']);
    });

    it('an owner who asked for nothing is not told their request cannot be met', async () => {
      const id = await start();
      llm.willRead({ businessType: 'salon', city: 'Pune', employeeCount: 4, numSites: 1, gstinStatus: 'ACTIVE', connectivity: 'NONE' });
      await say(id, 'salon in Pune, 4 of us, active GST, I do not want internet');
      llm.down = true;
      const response = await tap(id, 'NEEDS', []);
      const last = response.body.messages.at(-1).text as string;
      expect(response.body.recommendation).toBeNull();
      expect(last).not.toMatch(/can't offer what you asked/);
    });

    it('a count of zero from the model never breaks the chat', async () => {
      const id = await start();
      llm.willRead({ ...FACTS, addNeeds: ['CCTV'], counts: { cameras: 0 } });
      const response = await say(id, 'salon in Pune, no cameras yet but want CCTV');
      console.log('OBSERVED zero cameras', response.status, JSON.stringify(response.body?.error?.code ?? ids(response.body)));
      expect(response.status).toBe(200);
    });

    it('a very large count still turns into a quote or a clear refusal', async () => {
      const id = await start();
      llm.willRead({ ...FACTS, addNeeds: ['CCTV'], counts: { cameras: 2000 } });
      const response = await say(id, 'salon, 2000 cameras');
      const quote = await quoteFrom(response.body.recommendation);
      console.log('OBSERVED 2000 cameras', response.status, quote.status);
      expect(quote.status).toBe(201);
    });

    it('declining to name a city is not told that the city is not served', async () => {
      const id = await start();
      llm.willRead({ ...READY, city: undefined, declined: ['city'] });
      const response = await say(id, 'I would rather not say where');
      console.log('OBSERVED declined city', response.body.status, response.body.handoffReason, response.body.messages.at(-1).text);
      expect(response.body.handoffReason).not.toBe('NOT_SERVICEABLE_CITY');
    });

    it('a tier chip of DECLINED is not told that the city is not served', async () => {
      const id = await start();
      llm.willRead({ ...READY, city: 'Sangli' });
      const asked = await say(id, 'salon in Sangli');
      expect(asked.body.askedSlot).toBe('CITY_TIER');
      const response = await tap(id, 'CITY_TIER', 'DECLINED');
      console.log('OBSERVED declined tier', response.body.status, response.body.handoffReason, response.body.messages.at(-1).text);
      expect(response.body.handoffReason).not.toBe('NOT_SERVICEABLE_CITY');
    });
  });

  describe('numbers an owner can type, with no LLM needed', () => {
    const toEmployees = async () => {
      llm.down = true;
      const id = await start();
      await tap(id, 'BUSINESS', 'SHOP');
      await say(id, 'Pune');
      return id;
    };

    it('0 employees is not taken as a real answer', async () => {
      const id = await toEmployees();
      const response = await say(id, '0');
      console.log('OBSERVED employees 0', response.body.askedSlot, response.body.facts.employeeCount);
      expect(response.body.facts.employeeCount).not.toBe(0);
      expect(response.body.askedSlot).toBe('EMPLOYEES');
    });

    it('0 sites is not taken as a real answer', async () => {
      const id = await toEmployees();
      await say(id, '5');
      const response = await say(id, '0');
      console.log('OBSERVED sites 0', response.body.askedSlot, response.body.facts.numSites);
      expect(response.body.facts.numSites).not.toBe(0);
      expect(response.body.askedSlot).toBe('SITES');
    });

    it('a large business can still turn its recommendation into a quote', async () => {
      const id = await toEmployees();
      await say(id, '1500');
      await tap(id, 'SITES', 1);
      await tap(id, 'GSTIN', 'ACTIVE');
      await tap(id, 'FIBRE', true);
      const response = await tap(id, 'NEEDS', ['EMAIL']);
      const email = response.body.recommendation.lines.find((line: Line) => line.productId === 'P16');
      console.log('OBSERVED large business line', JSON.stringify(email));
      const quote = await quoteFrom(response.body.recommendation);
      console.log('OBSERVED large business quote', quote.status, JSON.stringify(quote.body?.error ?? {}));
      expect(quote.status).toBe(201);
    });

    it('many sites can still turn a recommendation into a quote', async () => {
      const id = await toEmployees();
      await say(id, '25');
      await say(id, '1200');
      await tap(id, 'GSTIN', 'ACTIVE');
      await tap(id, 'FIBRE', true);
      const response = await tap(id, 'NEEDS', []);
      const quote = await quoteFrom(response.body.recommendation);
      console.log('OBSERVED many sites quote', quote.status, JSON.stringify(quote.body?.error ?? {}));
      expect(quote.status).toBe(201);
    });

    it('declining every question still makes a quote that can be priced', async () => {
      llm.down = true;
      const id = await start();
      await tap(id, 'BUSINESS', 'SHOP');
      await say(id, 'Pune');
      await tap(id, 'EMPLOYEES', 'DECLINED');
      await tap(id, 'SITES', 'DECLINED');
      await tap(id, 'GSTIN', 'UNKNOWN');
      await tap(id, 'FIBRE', 'DECLINED');
      const response = await tap(id, 'NEEDS', []);
      console.log('OBSERVED all declined', response.body.status, JSON.stringify(ids(response.body)), JSON.stringify(response.body.recommendation?.blocked?.map((b: { productId: string; blockers: unknown[] }) => [b.productId, b.blockers])), response.body.messages.at(-1).text);
      expect(response.body.recommendation.lines.length).toBeGreaterThan(0);
      const quote = await quoteFrom(response.body.recommendation);
      expect(quote.status).toBe(201);
    });
  });

  describe('with the LLM down, typed answers in the owner\'s own language', () => {
    it('a known city in Devanagari moves the chat on', async () => {
      llm.down = true;
      const id = await start();
      await tap(id, 'BUSINESS', 'SHOP');
      const response = await say(id, 'पुणे', 'hi');
      console.log('OBSERVED hindi city', response.body.askedSlot, response.body.facts.city);
      expect(response.body.askedSlot).toBe('EMPLOYEES');
    });

    it('an unknown city in English has some way forward in the chat, with chips', async () => {
      llm.down = true;
      const id = await start();
      await tap(id, 'BUSINESS', 'SHOP');
      const response = await say(id, 'Sangli');
      console.log('OBSERVED unknown city, LLM down', response.body.askedSlot, response.body.facts.city, response.body.messages.at(-1).text);
      // CITY has no chips, so staying on CITY with the LLM down leaves only the short form.
      expect(response.body.askedSlot).toBe('CITY_TIER');
    });

    it('a count in Devanagari digits is read', async () => {
      llm.down = true;
      const id = await start();
      await tap(id, 'BUSINESS', 'SHOP');
      await say(id, 'Pune');
      const response = await say(id, '५', 'hi');
      expect(response.body.facts.employeeCount).toBe(5);
    });
  });

  describe('a whole-chat limit', () => {
    it('a chat handed to a person stops recommending and refuses more turns from reopening it', async () => {
      const id = await start();
      llm.willRead({ intents: ['WANTS_HUMAN'] });
      const handed = await say(id, 'get me a person');
      expect(handed.body.status).toBe('HANDED_OFF');
      llm.willRead(READY);
      const after = await say(id, 'salon in Pune...');
      expect(after.body.status).toBe('HANDED_OFF');
      expect(after.body.recommendation).toBeNull();
    });
  });
});
