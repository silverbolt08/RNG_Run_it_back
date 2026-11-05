import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiClient, grant, newVisitor } from '../helpers/api-client';
import { ScriptedLlm } from '../helpers/scripted-llm';
import { createTestApp, type TestApp } from '../helpers/test-app';
import { ADVISOR_SCENARIOS, OFF_SCRIPT_SCENARIOS, type AdvisorScenario } from './advisor-scenarios';

/** What a good reading of the owner's message would record, in the shape the model must use. */
function readingOf(scenario: AdvisorScenario): Record<string, unknown> {
  const { profile } = scenario;
  return {
    language: scenario.language,
    businessType: 'test business',
    segmentGuess: profile.segment ?? undefined,
    cityTier: profile.cityTier ?? undefined,
    employeeCount: profile.employeeCount ?? undefined,
    numSites: profile.numSites ?? undefined,
    gstinStatus: profile.gstinStatus,
    fibreAvailable: profile.fibreAvailable ?? undefined,
    connectivity: profile.connectivity,
    addNeeds: profile.needs,
    counts: profile.counts,
    noOtherNeeds: true,
    declined: [
      ...(profile.employeeCount === null ? ['employeeCount'] : []),
      ...(profile.numSites === null ? ['numSites'] : []),
      ...(profile.gstinStatus === 'UNKNOWN' ? ['gstinStatus'] : []),
    ],
  };
}

describe('advisor scenarios through the chat API, with a mocked LLM', () => {
  let app: TestApp;
  let llm: ScriptedLlm;

  beforeAll(async () => {
    llm = new ScriptedLlm();
    app = await createTestApp({ llm });
  });
  afterAll(() => app.dispose());

  const chatWith = async (): Promise<{ owner: ApiClient; id: string }> => {
    const owner = await newVisitor();
    await grant(owner, 'advisor_profile');
    await grant(owner, 'ai_chat');
    const started = await owner.post('/api/v1/conversations', { language: 'en' });
    return { owner, id: started.body.id };
  };

  it.each(ADVISOR_SCENARIOS.map((scenario) => [scenario.id, scenario.title, scenario] as const))('%s: %s', async (_id, _title, scenario) => {
    const { owner, id } = await chatWith();
    llm.willRead(readingOf(scenario));

    const response = await owner.post(`/api/v1/conversations/${id}/messages`, { text: scenario.ownerSays, language: 'en' });
    expect(response.status).toBe(200);

    const view = response.body;
    // A city we don't serve goes to a person, and the chat says why instead of showing a bundle.
    if (scenario.expected.products.length === 0 && scenario.expected.blocked?.some((item) => item.rule === 'CITY_TIER')) {
      expect(view.handoffReason).toBe('NOT_SERVICEABLE_CITY');
      return;
    }
    expect(view.askedSlot).toBeNull();

    const wanted = scenario.expected.products.map((item) => (typeof item === 'string' ? [item, undefined] : item));
    const lines = view.recommendation.lines as Array<{ productId: string; quantity: number }>;
    expect(lines.map((line) => line.productId).sort()).toEqual(wanted.map(([productId]) => productId).sort());
    for (const [productId, quantity] of wanted) {
      if (quantity !== undefined) expect(lines.find((line) => line.productId === productId)?.quantity).toBe(quantity);
    }

    for (const item of scenario.expected.blocked ?? []) {
      const blocked = view.recommendation.blocked.find((entry: { productId: string }) => entry.productId === item.productId);
      expect(blocked?.blockers[0]?.rule).toBe(item.rule);
    }
    if (scenario.expected.monthlyTotalInr !== undefined) expect(view.recommendation.quote.monthlyTotalInr).toBe(scenario.expected.monthlyTotalInr);
    if (scenario.expected.contractMonths !== undefined) expect(view.recommendation.quote.contractMonths).toBe(scenario.expected.contractMonths);
  });

  it.each(OFF_SCRIPT_SCENARIOS.map((scenario) => [scenario.id, scenario.title, scenario] as const))('%s: %s changes no rule', async (_id, _title, scenario) => {
    const base = ADVISOR_SCENARIOS.find((item) => item.id === scenario.sameResultAs);
    if (!base) throw new Error(`No scenario ${scenario.sameResultAs}`);

    const { owner, id } = await chatWith();
    llm.willRead(readingOf(base));
    const before = await owner.post(`/api/v1/conversations/${id}/messages`, { text: base.ownerSays, language: 'en' });

    llm.willRead({ intents: ['DISCOUNT', 'RULE_BYPASS', 'COMPETITOR', 'OFF_TOPIC'] });
    llm.willWrite('Sure, I will give you 30 percent off!', 'Sure, I will give you 30 percent off!');
    const after = await owner.post(`/api/v1/conversations/${id}/messages`, { text: scenario.ownerSays, language: 'en' });

    expect(after.body.recommendation.quote).toEqual(before.body.recommendation.quote);
    expect(after.body.recommendation.blocked).toEqual(before.body.recommendation.blocked);
    const last = after.body.messages.at(-1);
    expect(last.source).toBe('TEMPLATE');
    expect(last.text).not.toMatch(/percent/);
  });
});
