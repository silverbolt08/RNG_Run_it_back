import type { AdvisorFacts, AdvisorSlot, FactChange } from '../../../domain/advisor/advisor-facts';
import type { Need } from '../../../domain/bundle/recommend-bundle';
import type { Blocker } from '../../../domain/eligibility/eligibility';
import { formatInr } from '../../../lib/money';
import { translate, type Locale } from '../../../i18n/messages';
import { SLOT_QUESTIONS } from '../../llm/read-owner-turn';
import type { recommend } from '../recommendation-service';

/** Why a person is needed, as a code each language can word. */
export type HandoffReason = 'REQUESTED' | 'NOT_SERVICEABLE_CITY' | 'SITES_DIFFER' | 'STUCK' | 'TOO_MANY_TURNS';

export type ReplyNote =
  | { kind: 'CHANGED'; change: FactChange }
  | { kind: 'DISCOUNT' | 'RULES_FIXED' | 'OFF_TOPIC' | 'COMPETITOR' | 'SAVE_FOR_LATER' | 'READY' | 'NOT_UNDERSTOOD' | 'LLM_DOWN' | 'OFFER_PERSON' }
  | { kind: 'UNKNOWN_PRODUCT'; thing: string; closestName: string | null };

export type ReplyNext =
  | { kind: 'ASK'; slot: AdvisorSlot }
  | { kind: 'RECOMMEND'; recommendation: Recommendation }
  | { kind: 'HANDOFF'; reason: HandoffReason };

export type Recommendation = Awaited<ReturnType<typeof recommend>>;

export type ReplyPlan = { notes: readonly ReplyNote[]; next: ReplyNext; facts: AdvisorFacts };

/** What the writer may use, and the fallback that needs no LLM at all. */
export type ComposedReply = { values: Record<string, string>; brief: string; template: string };

const NEED_GLOSS: Readonly<Record<Need, string>> = {
  UPTIME: 'keeps them online if the main connection drops',
  CUSTOMER_OUTREACH: 'lets them reach customers on WhatsApp with a catalogue',
  BULK_SMS: 'sends alerts and offers to customers by SMS',
  SECURITY: 'protects their devices and data',
  GUEST_WIFI: 'gives customers separate, safe Wi-Fi',
  CENTRAL_MANAGEMENT: 'runs all their sites from one place',
  PHONE_LINES: 'business mobile lines',
  BUSINESS_CALLS: 'business phone lines with call recording',
  TOLL_FREE: 'a toll-free number for customers',
  EMAIL: 'business email and documents',
  BACKUP: 'automatic backup of their files',
  WEBSITE: 'a simple website of their own',
  POS: 'billing with UPI and card acceptance',
  CCTV: 'cameras they can watch from their phone',
  REMOTE_ACCESS: 'a fixed address for reaching their systems remotely',
  FLEET: 'live location of their vehicles',
  MACHINE_MONITORING: 'tracks machine uptime and energy use',
};

const NOTE_GLOSS: Readonly<Record<Exclude<ReplyNote['kind'], 'CHANGED' | 'UNKNOWN_PRODUCT'>, string>> = {
  DISCOUNT: 'They asked for a discount. Say kindly that the price is the same for everyone and you cannot change it. Offer to remove items for a lower total.',
  RULES_FIXED: 'They asked you to skip a rule. Say kindly that eligibility rules are fixed and neither of you can change them. Do not lecture.',
  OFF_TOPIC: 'They asked about something unrelated. Say in a few words that you can only help with business connectivity, then carry on.',
  COMPETITOR: 'They asked about other providers. Say you can only speak about Accel Business, and make no comparison.',
  SAVE_FOR_LATER: 'They want to decide later. Say that is fine, and their progress stays saved.',
  READY: 'They are ready to go ahead. Tell them the next step is the button to see the quote.',
  NOT_UNDERSTOOD: 'You did not catch what they meant. Say so briefly, without blame.',
  LLM_DOWN: 'You cannot read typed messages just now. Ask them to tap one of the options.',
  OFFER_PERSON: 'Offer to have a person from Accel Business help them.',
};

export function composeReply(plan: ReplyPlan, locale: Locale): ComposedReply {
  const values: Record<string, string> = {};
  const brief: string[] = [];
  const template: string[] = [];

  addFactValues(plan.facts, values);
  plan.notes.forEach((note, index) => composeNote(note, index, locale, values, brief, template));

  const { next } = plan;
  if (next.kind === 'ASK') {
    brief.push(`Then ask exactly one question: "${SLOT_QUESTIONS[next.slot]}". End your reply with it. Tappable answers appear below your message, so do not list options.`);
    template.push(translate(locale, `advisor.ask.${next.slot}`));
  } else if (next.kind === 'HANDOFF') {
    brief.push(`A person from Accel Business will take over, for this reason: ${next.reason}. Tell them so, and that their details are saved. Ask no question.`);
    template.push(translate(locale, `advisor.handoff.${next.reason}`));
  } else {
    composeRecommendation(next.recommendation, locale, values, brief, template);
  }

  return { values, brief: brief.join('\n'), template: template.join(' ') };
}

function addFactValues(facts: AdvisorFacts, values: Record<string, string>): void {
  if (facts.employeeCount !== null) values.EMPLOYEES = String(facts.employeeCount);
  if (facts.numSites !== null) values.SITES = String(facts.numSites);
  if (facts.city) values.CITY = facts.city;
  if (facts.businessType) values.BUSINESS = facts.businessType;
}

function composeNote(
  note: ReplyNote,
  index: number,
  locale: Locale,
  values: Record<string, string>,
  brief: string[],
  template: string[],
): void {
  if (note.kind === 'CHANGED') {
    const { field, from, to } = note.change;
    // Status codes and yes or no need wording, so only names and counts are quoted back.
    const quotable = field === 'employeeCount' || field === 'numSites' || field === 'city' || field === 'businessType';
    if (quotable) {
      values[`CHANGE${index}_FROM`] = from;
      values[`CHANGE${index}_TO`] = to;
      brief.push(`They changed ${field} from {{CHANGE${index}_FROM}} to {{CHANGE${index}_TO}}. Say you have used the new value and they can correct you if it is wrong.`);
      template.push(translate(locale, 'advisor.note.CHANGED', { from, to }));
    } else {
      brief.push(`They changed what they told you about ${field}. Say you have updated it and they can correct you if it is wrong.`);
      template.push(translate(locale, 'advisor.note.CHANGED_PLAIN'));
    }
    return;
  }

  if (note.kind === 'UNKNOWN_PRODUCT') {
    values.UNKNOWN_THING = note.thing;
    if (note.closestName) values.CLOSEST = note.closestName;
    brief.push(
      note.closestName
        ? 'They asked for {{UNKNOWN_THING}}, which Accel Business does not sell. Say so plainly. The closest thing is {{CLOSEST}}.'
        : 'They asked for {{UNKNOWN_THING}}, which Accel Business does not sell. Say so plainly, and invent no alternative.',
    );
    template.push(
      translate(locale, note.closestName ? 'advisor.note.UNKNOWN_PRODUCT_CLOSEST' : 'advisor.note.UNKNOWN_PRODUCT', {
        thing: note.thing,
        closest: note.closestName ?? '',
      }),
    );
    return;
  }

  brief.push(NOTE_GLOSS[note.kind]);
  template.push(translate(locale, `advisor.note.${note.kind}`));
}

function composeRecommendation(
  recommendation: Recommendation,
  locale: Locale,
  values: Record<string, string>,
  brief: string[],
  template: string[],
): void {
  const { lines, blocked, quote } = recommendation;
  const lineBrief = lines.map((line, index) => {
    values[`L${index}`] = line.name;
    const why = line.reason.kind === 'NEED' ? NEED_GLOSS[line.reason.need] : line.reason.kind === 'CONNECTIVITY' ? 'their main internet connection' : 'they asked for it by name';
    return `{{L${index}}}: ${why}`;
  });

  if (lines.length > 0) {
    values.MONTHLY = formatInr(quote.monthlyFinalInr);
    values.SETUP = formatInr(quote.setupFinalInr);
    values.CONTRACT = String(quote.contractMonths);
    values.INSTALL = String(quote.installDays);
    brief.push(
      `Recommend this bundle, giving each item's reason in a few words:\n${lineBrief.join('\n')}`,
      'State the totals once: {{MONTHLY}} a month including GST, {{SETUP}} one-time setup including GST, a contract of {{CONTRACT}} months, installed in about {{INSTALL}} days.',
    );
    template.push(translate(locale, 'advisor.recommend.summary', { monthly: values.MONTHLY, setup: values.SETUP, contract: values.CONTRACT, install: values.INSTALL }));
  } else {
    brief.push('Nothing they asked for can be sold to them as things stand. Say so kindly, using the reasons below. Tell them they can change their answers or ask for a person.');
    template.push(translate(locale, 'advisor.recommend.empty'));
  }

  blocked.forEach((item, index) => {
    values[`B${index}`] = item.name;
    const blocker = item.blockers[0];
    const altNames = item.alternatives.flatMap((id) => {
      const known = recommendation.alternativeNames[id];
      return known ? [known] : [];
    });
    if (altNames.length > 0) values[`B${index}_ALT`] = altNames.join(' + ');
    if (blocker && 'required' in blocker && typeof blocker.required === 'number') values[`B${index}_MIN`] = String(blocker.required);

    brief.push(
      `{{B${index}}} cannot be sold to them. Reason: ${blockerGloss(blocker, index)}.` +
        (altNames.length > 0 ? ` Offer {{B${index}_ALT}} instead.` : ''),
    );
    template.push(blockedTemplate(blocker, item.name, values[`B${index}_MIN`] ?? '', locale));
    if (altNames.length > 0) template.push(translate(locale, 'advisor.blocked.ALTERNATIVE', { alternative: altNames.join(' + ') }));
  });
}

function blockerGloss(blocker: Blocker | undefined, index: number): string {
  switch (blocker?.rule) {
    case 'CITY_TIER':
      return 'it is not available in their city';
    case 'MIN_EMPLOYEES':
      return `it needs at least {{B${index}_MIN}} people, and they have fewer, or did not say`;
    case 'MIN_SITES':
      return `it needs at least {{B${index}_MIN}} sites, and they have fewer, or did not say`;
    case 'GSTIN_REQUIRED':
      return 'it needs an active GST registration, and a registration would unlock it';
    case 'FIBRE_NOT_AVAILABLE':
      return 'fibre does not reach their premises, or they are not sure it does';
    case 'DEPENDENCY':
      return 'it only works on top of a connection type they do not have in this bundle';
    default:
      return 'the eligibility rules do not allow it';
  }
}

function blockedTemplate(blocker: Blocker | undefined, name: string, min: string, locale: Locale): string {
  return translate(locale, `advisor.blocked.${blocker?.rule ?? 'OTHER'}`, { name, min });
}
