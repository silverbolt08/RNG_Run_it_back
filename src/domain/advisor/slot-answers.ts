import type { Need } from '../bundle/recommend-bundle';
import { canonicalCity, inferSegment, KNOWN_CITIES } from '../bundle/segments';
import type { SegmentCode } from '../catalogue/catalogue';
import type { GstinStatus } from '../eligibility/eligibility';
import type { AdvisorSlot, FactUpdate } from './advisor-facts';

/**
 * Answers that need no LLM: a tapped chip, or plain text for the question just asked. This is what
 * keeps the journey going when the LLM is down, and it saves free-tier calls when it isn't.
 */
export const ALL_NEEDS: readonly Need[] = [
  'UPTIME',
  'CUSTOMER_OUTREACH',
  'BULK_SMS',
  'SECURITY',
  'GUEST_WIFI',
  'CENTRAL_MANAGEMENT',
  'PHONE_LINES',
  'BUSINESS_CALLS',
  'TOLL_FREE',
  'EMAIL',
  'BACKUP',
  'WEBSITE',
  'POS',
  'CCTV',
  'REMOTE_ACCESS',
  'FLEET',
  'MACHINE_MONITORING',
];

const BUSINESS_CHOICES: Readonly<Record<string, { type: string; segment: SegmentCode }>> = {
  SHOP: { type: 'shop', segment: 'micro' },
  OFFICE: { type: 'office', segment: 'prof' },
  CHAIN: { type: 'chain', segment: 'multi' },
  FACTORY: { type: 'factory', segment: 'mfg' },
};

export type SlotAnswer =
  | { slot: 'BUSINESS'; value: string }
  | { slot: 'CITY_TIER'; value: number | 'DECLINED' }
  | { slot: 'EMPLOYEES' | 'SITES'; value: number | 'DECLINED' }
  | { slot: 'GSTIN'; value: GstinStatus }
  | { slot: 'FIBRE'; value: boolean | 'DECLINED' }
  | { slot: 'NEEDS'; value: readonly Need[] };

/** Turns a tapped answer into facts. Returns null for a value that isn't a real choice. */
export function updateFromSlotAnswer(answer: SlotAnswer): FactUpdate | null {
  switch (answer.slot) {
    case 'BUSINESS': {
      const choice = BUSINESS_CHOICES[answer.value];
      return choice ? { businessType: choice.type, segmentGuess: choice.segment } : null;
    }
    case 'CITY_TIER':
      return answer.value === 'DECLINED' ? { declined: ['city'] } : { cityTier: answer.value };
    case 'EMPLOYEES':
      return answer.value === 'DECLINED' ? { declined: ['employeeCount'] } : { employeeCount: answer.value };
    case 'SITES':
      return answer.value === 'DECLINED' ? { declined: ['numSites'] } : { numSites: answer.value };
    case 'GSTIN':
      return answer.value === 'UNKNOWN'
        ? { gstinStatus: 'UNKNOWN', declined: ['gstinStatus'] }
        : { gstinStatus: answer.value };
    case 'FIBRE':
      return answer.value === 'DECLINED' ? { declined: ['fibreAvailable'] } : { fibreAvailable: answer.value };
    case 'NEEDS':
      return { addNeeds: answer.value, needsAnswered: true };
  }
}

// Not \b, which only understands ASCII and so never matches after a Devanagari word.
const END_OF_WORD = '(?=$|[\\s,.!?।])';
const AFFIRMATIVE = new RegExp(`^(yes|yeah|yep|y|haan|han|ha|ji|ji haan|हाँ|हां|जी|जी हाँ)${END_OF_WORD}`, 'iu');
const NEGATIVE = new RegExp(`^(no|nope|n|nahi|nahin|na|नहीं|ना)${END_OF_WORD}`, 'iu');
const NOT_SURE = /(not sure|don'?t know|dont know|pata nahi|पता नहीं|maybe)/iu;
const NOTHING_ELSE = new RegExp(`^(nothing|none|no|nope|nahi|nahin|कुछ नहीं|नहीं|just internet|only internet|bas internet)${END_OF_WORD}`, 'iu');

const NEED_KEYWORDS: ReadonlyArray<readonly [RegExp, Need]> = [
  [/whatsapp|व्हाट्सएप|व्हाट्सऐप/iu, 'CUSTOMER_OUTREACH'],
  [/\bsms\b|एसएमएस/iu, 'BULK_SMS'],
  [/backup (internet|link|line)|failover|internet down|uptime|net (band|down)|never go down/iu, 'UPTIME'],
  [/cctv|camera|कैमरा|सीसीटीवी/iu, 'CCTV'],
  [/\bpos\b|billing|बिलिंग|bill machine/iu, 'POS'],
  [/guest|customer wi-?fi|wi-?fi|वाई-?फाई/iu, 'GUEST_WIFI'],
  [/e-?mail|ईमेल/iu, 'EMAIL'],
  [/website|वेबसाइट/iu, 'WEBSITE'],
  [/antivirus|ransomware|security|सुरक्षा/iu, 'SECURITY'],
  [/toll-?free|टोल/iu, 'TOLL_FREE'],
  [/ivr|call recording|cloud telephony/iu, 'BUSINESS_CALLS'],
  [/mobile|sim|postpaid|मोबाइल/iu, 'PHONE_LINES'],
  [/backup|बैकअप/iu, 'BACKUP'],
  [/static ip|remote access/iu, 'REMOTE_ACCESS'],
  [/gps|fleet|vehicle|गाड़ी/iu, 'FLEET'],
  [/machine|मशीन/iu, 'MACHINE_MONITORING'],
  [/sd-?wan|all (sites|branches)/iu, 'CENTRAL_MANAGEMENT'],
];

/**
 * Reads plain text for the question just asked, or returns null if it can't be sure. It reads
 * little on purpose: a wrong guess here would feed the rules, so anything else goes to the LLM or
 * back to the owner as tappable choices.
 */
export function parseSlotText(slot: AdvisorSlot, raw: string): FactUpdate | null {
  const text = raw.trim();
  if (text === '') return null;

  switch (slot) {
    case 'EMPLOYEES': {
      const count = wholeNumberOnly(text);
      return count === null ? null : { employeeCount: count };
    }
    case 'SITES': {
      const count = wholeNumberOnly(text);
      return count === null ? null : { numSites: count };
    }
    case 'CITY': {
      const city = canonicalCity(text);
      return city === null ? null : { city: titleCase(city) };
    }
    case 'BUSINESS':
      return inferSegment(text, null) ? { businessType: text.toLowerCase() } : null;
    case 'FIBRE':
      if (NOT_SURE.test(text)) return { declined: ['fibreAvailable'] };
      if (AFFIRMATIVE.test(text)) return { fibreAvailable: true };
      if (NEGATIVE.test(text)) return { fibreAvailable: false };
      return null;
    case 'GSTIN':
      if (AFFIRMATIVE.test(text)) return { gstinStatus: 'ACTIVE' };
      if (NEGATIVE.test(text)) return { gstinStatus: 'NONE' };
      return null;
    case 'NEEDS': {
      if (NOTHING_ELSE.test(text)) return { needsAnswered: true };
      const needs = NEED_KEYWORDS.filter(([pattern]) => pattern.test(text)).map(([, need]) => need);
      return needs.length === 0 ? null : { addNeeds: needs, needsAnswered: true };
    }
    case 'CITY_TIER':
      return null;
  }
}

const PEOPLE_COUNT = /(\d{1,6})\s*(?:people|persons?|staff|employees|workers|log|लोग|कर्मचारी)|\b(\d{1,6})\s+of\s+us\b/iu;
const SITE_COUNT = /(\d{1,6})\s*(?:sites?|branch(?:es)?|outlets?|stores?|locations?|शाखा|शाखाएं|शाखाएँ|जगह)/iu;
const NO_GST = /\bno gst\b|\bgst nahi\b|\bgst nahin\b|without gst|gst नहीं/iu;

/**
 * Facts stated in so many words, read from free text by plain patterns. It backs up the LLM, which
 * now and then drops a number it was clearly given, and it still helps when the LLM is down.
 */
export function readPlainFacts(raw: string): FactUpdate {
  const update: FactUpdate = {};
  const people = PEOPLE_COUNT.exec(raw);
  const peopleCount = Number(people?.[1] ?? people?.[2] ?? 0);
  if (peopleCount >= 1) update.employeeCount = peopleCount;
  const sites = SITE_COUNT.exec(raw);
  if (sites && Number(sites[1]) >= 1) update.numSites = Number(sites[1]);
  if (NO_GST.test(raw)) update.gstinStatus = 'NONE';
  if (/leased line|dedicated (?:line|internet|bandwidth)|लीज़्ड लाइन/iu.test(raw)) {
    update.connectivity = /\b100\s?mbps\b/iu.test(raw) ? 'DEDICATED_HIGH' : 'DEDICATED';
  } else if (/\b1\s?gbps\b/iu.test(raw)) {
    update.connectivity = 'HIGH_SPEED';
  }

  const words = raw.toLowerCase();
  const city = KNOWN_CITIES.find((name) => new RegExp(`\\b${name}\\b`).test(words));
  if (city) update.city = titleCase(city);
  return update;
}

/**
 * A town we don't know, typed as the answer to the city question while the LLM is down. Letters and
 * at most three words, so a sentence isn't taken for a place. Its tier is then asked for.
 */
export function readTypedTown(raw: string): FactUpdate | null {
  const text = raw.trim();
  const looksLikeAPlace = /^[\p{L}\p{M}]+(?:[ .-][\p{L}\p{M}]+){0,2}$/u.test(text) && text.length <= 30;
  return looksLikeAPlace ? { city: titleCase(text) } : null;
}

function wholeNumberOnly(text: string): number | null {
  if (!/^\d{1,6}$/.test(text)) return null;
  // A business has at least one person and one site, so zero is a slip to ask about again.
  const value = Number(text);
  return value >= 1 ? value : null;
}

function titleCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}
