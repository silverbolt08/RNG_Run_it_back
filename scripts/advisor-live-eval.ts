/**
 * Runs our own advisor scenarios through a real LLM, to choose a model and to record pass rates.
 * It tests reading: does the model turn what an owner typed into the facts our engine needs? The
 * engine then decides, as it does in the product. Run by hand, since it spends free-tier quota:
 *
 *   npx tsx scripts/advisor-live-eval.ts gemini-3.5-flash-lite gemini-2.5-flash
 *
 * Facts a message doesn't mention are filled from the scenario, as if the owner had answered the
 * later questions. Nothing here touches personal data: every scenario is written by us.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { applyFactUpdate, EMPTY_FACTS, toDiscoveryProfile, type AdvisorFacts } from '../src/domain/advisor/advisor-facts';
import { recommendBundle } from '../src/domain/bundle/recommend-bundle';
import { parseCatalogue } from '../src/domain/catalogue/catalogue';
import { parseCsv } from '../src/lib/csv';
import { createGeminiProvider } from '../src/server/llm/gemini-provider';
import { readOwnerTurn } from '../src/server/llm/read-owner-turn';
import { redactIdentifiers } from '../src/lib/redact';
import { ADVISOR_SCENARIOS, OFF_SCRIPT_SCENARIOS, type AdvisorScenario } from '../tests/scenarios/advisor-scenarios';
import { loadLocalEnv } from './load-env';

loadLocalEnv();

const PAUSE_MS = 4500;
const CALL_TIMEOUT_MS = 30_000;
const RETRIES = 3;

const catalogue = parseCatalogue(parseCsv(readFileSync('tests/fixtures/product_catalogue.csv', 'utf8')));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Fills in only what the owner's message left unsaid.
function fillFromScenario(facts: AdvisorFacts, scenario: AdvisorScenario): AdvisorFacts {
  const expected = scenario.profile;
  return {
    ...facts,
    segment: expected.segment ?? facts.segment,
    cityTier: facts.cityTier ?? expected.cityTier,
    employeeCount: facts.employeeCount ?? expected.employeeCount,
    numSites: facts.numSites ?? expected.numSites,
    gstinStatus: facts.gstinStatus ?? expected.gstinStatus,
    fibreAvailable: facts.fibreAvailable ?? expected.fibreAvailable,
    connectivity: facts.connectivity ?? 'STANDARD',
  };
}

type Result = { id: string; pass: boolean; detail: string; ms: number };

async function runScenario(model: string, apiKey: string, scenario: AdvisorScenario): Promise<Result> {
  const llm = createGeminiProvider({ apiKey, model, timeoutMs: CALL_TIMEOUT_MS });
  const started = Date.now();

  for (let attempt = 0; ; attempt += 1) {
    try {
      const turn = await readOwnerTurn(llm, { facts: EMPTY_FACTS, askedSlot: 'BUSINESS', redactedText: redactIdentifiers(scenario.ownerSays) });
      const { facts } = applyFactUpdate(EMPTY_FACTS, turn.update);
      const result = recommendBundle(catalogue, toDiscoveryProfile(fillFromScenario(facts, scenario)));

      const got = result.lines.map((line) => line.productId).sort();
      const wanted = scenario.expected.products.map((item) => (typeof item === 'string' ? item : item[0])).sort();
      const gotBlocked = result.blocked.map((item) => item.productId).sort();
      const wantedBlocked = (scenario.expected.blocked ?? []).map((item) => item.productId).sort();
      const pass = String(got) === String(wanted) && wantedBlocked.every((id) => gotBlocked.includes(id));

      return {
        id: scenario.id,
        pass,
        ms: Date.now() - started,
        detail: pass ? '' : `got ${got} blocked ${gotBlocked}; wanted ${wanted} blocked ${wantedBlocked}; read ${JSON.stringify(turn.update)}`,
      };
    } catch (error) {
      if (attempt + 1 >= RETRIES) {
        return { id: scenario.id, pass: false, ms: Date.now() - started, detail: `unavailable: ${error instanceof Error ? error.message : 'unknown'}` };
      }
      await sleep(PAUSE_MS * (attempt + 2));
    }
  }
}

async function runOffScript(model: string, apiKey: string): Promise<Result[]> {
  const llm = createGeminiProvider({ apiKey, model, timeoutMs: CALL_TIMEOUT_MS });
  const expected: Readonly<Record<string, string>> = {
    X01: 'DISCOUNT',
    X02: 'RULE_BYPASS',
    X03: 'RULE_BYPASS',
    X04: 'UNKNOWN_PRODUCT',
    X05: 'OFF_TOPIC',
    X06: 'COMPETITOR',
  };
  const results: Result[] = [];
  for (const scenario of OFF_SCRIPT_SCENARIOS) {
    const started = Date.now();
    await sleep(PAUSE_MS);
    try {
      const turn = await readOwnerTurn(llm, { facts: EMPTY_FACTS, askedSlot: null, redactedText: scenario.ownerSays });
      const pass = turn.intents.includes(expected[scenario.id] as never);
      results.push({ id: scenario.id, pass, ms: Date.now() - started, detail: pass ? '' : `intents ${turn.intents.join(',')}` });
    } catch (error) {
      results.push({ id: scenario.id, pass: false, ms: Date.now() - started, detail: `unavailable: ${error instanceof Error ? error.message : 'unknown'}` });
    }
  }
  return results;
}

async function main(): Promise<void> {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new Error('Set LLM_API_KEY in .env.local');

  const models = process.argv.slice(2);
  const report: Record<string, { results: Result[] }> = {};

  for (const model of models) {
    const results: Result[] = [];
    for (const scenario of ADVISOR_SCENARIOS) {
      results.push(await runScenario(model, apiKey, scenario));
      await sleep(PAUSE_MS);
    }
    results.push(...(await runOffScript(model, apiKey)));
    report[model] = { results };

    const passed = results.filter((item) => item.pass).length;
    const times = results.map((item) => item.ms).sort((a, b) => a - b);
    console.log(`${model}: ${passed}/${results.length} passed, median ${times[Math.floor(times.length / 2)]} ms`);
    for (const failure of results.filter((item) => !item.pass)) console.log(`  ${failure.id}: ${failure.detail}`);
  }

  writeFileSync('analytics/output/advisor-live-eval.json', JSON.stringify(report, null, 2));
}

void main();
