/**
 * Real conversations against a running app with the real LLM, for the pre-demo live pass. It records
 * how often the model's words reach the owner and what they read like. Start the app first, then:
 *
 *   npx tsx scripts/advisor-live-conversations.ts http://localhost:3000
 *
 * All text is written by us. Replies go to analytics/output/advisor-live-replies.json for review.
 */
import { writeFileSync } from 'node:fs';
import { ADVISOR_SCENARIOS, OFF_SCRIPT_SCENARIOS } from '../tests/scenarios/advisor-scenarios';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const PAUSE_MS = 9000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type View = { id: string; askedSlot: string | null; messages: Array<{ role: string; text: string; source: string }>; recommendation: { lines: Array<{ productId: string }> } | null };

async function newOwner() {
  let cookie = '';
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${BASE}/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0] ?? cookie;
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
    return (await response.json()) as T;
  };

  await call('POST', '/sessions');
  const consents = await call<{ items: Array<{ purpose: string; currentNoticeVersion: string }> }>('GET', '/consents');
  for (const purpose of ['advisor_profile', 'ai_chat']) {
    const notice = consents.items.find((item) => item.purpose === purpose)?.currentNoticeVersion;
    await call('POST', '/consents', { purpose, noticeVersion: notice, language: 'en' });
  }
  return call;
}

// Answers everything still asked, so each conversation reaches a recommendation.
const FOLLOW_UPS: Readonly<Record<string, unknown>> = {
  BUSINESS: { slot: 'BUSINESS', value: 'SHOP' },
  CITY: 'typed below',
  CITY_TIER: { slot: 'CITY_TIER', value: 2 },
  EMPLOYEES: { slot: 'EMPLOYEES', value: 5 },
  SITES: { slot: 'SITES', value: 1 },
  GSTIN: { slot: 'GSTIN', value: 'ACTIVE' },
  FIBRE: { slot: 'FIBRE', value: true },
  NEEDS: { slot: 'NEEDS', value: [] },
};

async function main(): Promise<void> {
  const results: Array<Record<string, unknown>> = [];
  const script = [
    ...ADVISOR_SCENARIOS.map((item) => ({ id: item.id, title: item.title, says: item.ownerSays, ui: item.language === 'hi' ? 'hi' : 'en' })),
    ...OFF_SCRIPT_SCENARIOS.map((item) => ({ id: item.id, title: item.title, says: item.ownerSays, ui: 'en' })),
  ];

  for (const item of script) {
    const call = await newOwner();
    let view = await call<View>('POST', '/conversations', { language: item.ui });
    view = await call<View>('POST', `/conversations/${view.id}/messages`, { text: item.says, language: item.ui });
    await sleep(PAUSE_MS);

    const first = view.messages.at(-1);
    let safety = 0;
    while (view.askedSlot && FOLLOW_UPS[view.askedSlot] && safety < 8) {
      if (view.askedSlot === 'CITY') {
        view = await call<View>('POST', `/conversations/${view.id}/messages`, { text: 'Pune', language: item.ui });
      } else {
        view = await call<View>('POST', `/conversations/${view.id}/messages`, { answer: FOLLOW_UPS[view.askedSlot], language: item.ui });
      }
      safety += 1;
      await sleep(PAUSE_MS / 2);
    }
    const last = view.messages.at(-1);
    results.push({
      id: item.id,
      title: item.title,
      firstReply: first,
      lastReply: last,
      lines: view.recommendation?.lines.map((line) => line.productId) ?? [],
      asked: view.askedSlot,
    });
    console.log(`${item.id} first:${first?.source} last:${last?.source} lines:${view.recommendation?.lines.map((line) => line.productId).join(',') ?? '-'}`);
    writeFileSync('analytics/output/advisor-live-replies.json', JSON.stringify(results, null, 2));
  }

  const sources = results.flatMap((item) => [item.firstReply, item.lastReply]) as Array<{ source: string }>;
  const fromLlm = sources.filter((reply) => reply?.source === 'LLM').length;
  console.log(`Model's words used in ${fromLlm} of ${sources.length} replies`);
}

void main();
