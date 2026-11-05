import { and, desc, eq, ne, sql } from 'drizzle-orm';
import {
  applyFactUpdate,
  EMPTY_FACTS,
  nextSlot,
  toDiscoveryProfile,
  type AdvisorFacts,
  type AdvisorSlot,
  type FactUpdate,
} from '../../../domain/advisor/advisor-facts';
import { parseSlotText, readPlainFacts, updateFromSlotAnswer, type SlotAnswer } from '../../../domain/advisor/slot-answers';
import { productsForNeed } from '../../../domain/bundle/recommend-bundle';
import { getProduct } from '../../../domain/catalogue/catalogue';
import { translate, type Locale } from '../../../i18n/messages';
import { newPublicId } from '../../../lib/ids';
import { redactIdentifiers } from '../../../lib/redact';
import type { AppContext } from '../../app-context';
import { hasActiveConsent } from '../../consent/consent-service';
import { RATE_LIMITS } from '../../http/rate-limiter';
import type { LlmProvider } from '../../llm/provider';
import { conversations } from '../../db/schema';
import { invalidRequest, notFound } from '../../http/errors';
import { isLlmUnavailable } from '../../llm/provider';
import { cleanWords, readOwnerTurn, type OwnerLanguage, type OwnerTurn } from '../../llm/read-owner-turn';
import { fillSlots, writeReply } from '../../llm/write-reply';
import { recommend } from '../recommendation-service';
import { composeReply, type HandoffReason, type Recommendation, type ReplyNext, type ReplyNote } from './reply-plan';

type ConversationRow = typeof conversations.$inferSelect;

export type StoredMessage = {
  role: 'owner' | 'advisor';
  text: string;
  /** How the words were made, so evaluations can tell the LLM's from a template's. */
  source: 'OWNER' | 'LLM' | 'TEMPLATE';
};

type StoredState = {
  facts: AdvisorFacts;
  stuckTurns: number;
  uiLanguage: Locale;
};

export type ConversationView = {
  id: string;
  status: string;
  messages: StoredMessage[];
  askedSlot: AdvisorSlot | null;
  facts: AdvisorFacts;
  recommendation: Recommendation | null;
  handoffReason: string | null;
  /** Worth a person's time: manufacturers and chains need feasibility checks the advisor can't do. */
  assistSuggested: boolean;
  llmAvailable: boolean;
};

type Owner = { ownerId: string; subjectRef: string };

const STUCK_TURN_LIMIT = 2;
const MAX_OWNER_TURNS = 40;

/** The LLM, if this owner agreed to it and the shared free quota has room. Otherwise chat runs on tapped answers. */
async function usableLlm(app: AppContext, subjectRef: string): Promise<LlmProvider | null> {
  if (!app.llm || !(await hasActiveConsent(app, subjectRef, 'ai_chat'))) return null;
  return app.rateLimiter.hit('llm-budget', RATE_LIMITS.llmBudget) === null ? app.llm : null;
}

/** Returns the owner's open chat, or starts one with a greeting that spends no LLM call. */
export async function startConversation(
  app: AppContext,
  owner: Owner,
  input: { language: Locale; restart?: boolean },
): Promise<{ created: boolean; view: ConversationView }> {
  const llmOn = (await usableLlm(app, owner.subjectRef)) !== null;
  const existing = await latestConversation(app, owner.ownerId);
  if (existing && !input.restart) return { created: false, view: await toView(app, existing, llmOn) };

  if (existing) {
    await app.db.update(conversations).set({ status: 'CLOSED', updatedAt: app.clock.now().toISOString() }).where(eq(conversations.id, existing.id));
  }

  const greeting: StoredMessage = {
    role: 'advisor',
    source: 'TEMPLATE',
    text: `${translate(input.language, 'advisor.greeting')} ${translate(input.language, 'advisor.ask.BUSINESS')}`,
  };
  const now = app.clock.now().toISOString();
  const state: StoredState = { facts: EMPTY_FACTS, stuckTurns: 0, uiLanguage: input.language };
  const [row] = await app.db
    .insert(conversations)
    .values({
      id: newPublicId('cnv'),
      ownerId: owner.ownerId,
      status: 'OPEN',
      language: input.language,
      redactedMessages: JSON.stringify([greeting]),
      facts: JSON.stringify(state),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error('Inserting a conversation returned no row');
  return { created: true, view: await toView(app, row, llmOn) };
}

export async function getCurrentConversation(app: AppContext, owner: Owner): Promise<ConversationView> {
  const row = await latestConversation(app, owner.ownerId);
  if (!row) throw notFound();
  return toView(app, row, (await usableLlm(app, owner.subjectRef)) !== null);
}

export async function sendMessage(
  app: AppContext,
  owner: Owner,
  id: string,
  input: { text?: string; answer?: SlotAnswer; language: Locale },
): Promise<ConversationView> {
  const row = await loadConversation(app, owner.ownerId, id);
  const llm = await usableLlm(app, owner.subjectRef);
  const state = readState(row);
  const messages = readMessages(row);
  const askedSlot = nextSlot(state.facts);

  const redacted = input.text ? redactIdentifiers(input.text) : null;
  const understood = await understand(app, llm, state.facts, askedSlot, redacted, input.answer);

  const { facts, changes } = applyFactUpdate(state.facts, understood.update);
  const madeProgress = JSON.stringify(facts) !== JSON.stringify(state.facts);
  const handled = (understood.turn?.intents.length ?? 0) > 0;
  const couldNotRead = understood.llmDown;
  const stuckTurns = madeProgress || handled || couldNotRead ? 0 : state.stuckTurns + 1;

  const ownerTurns = messages.filter((message) => message.role === 'owner').length + 1;
  const catalogue = await app.catalogue();
  const next = await decideNext(app, facts, understood.turn, ownerTurns);

  const notes = buildNotes({
    changes,
    turn: understood.turn,
    couldNotRead,
    notUnderstood: !madeProgress && !handled && !couldNotRead && understood.turn !== null,
    offerPerson: stuckTurns >= STUCK_TURN_LIMIT,
    closestName: closestProductName(catalogue, understood.turn, facts),
  });

  const locale = replyLocale(input.language, understood.turn?.language);
  const language = replyLanguage(row, state, input.language, understood.turn);
  const composed = composeReply({ notes, next, facts }, locale);

  let reply: StoredMessage = { role: 'advisor', source: 'TEMPLATE', text: fillSlots(composed.template, composed.values) };
  let llmUsable = !understood.llmDown && llm !== null;
  if (llm && llmUsable) {
    try {
      const written = await writeReply(llm, {
        language,
        brief: composed.brief,
        values: composed.values,
        catalogueNames: catalogue.products.map((product) => product.name),
      });
      if (written.text !== null) reply = { role: 'advisor', source: 'LLM', text: written.text };
      else app.logger.info('advisor.guard_refused', { reason: written.failure });
    } catch (error) {
      if (!isLlmUnavailable(error)) throw error;
      app.logger.error('advisor.llm_unavailable', { reason: error.reason });
      llmUsable = false;
    }
  }

  const ownerMessage: StoredMessage | null = redacted ? { role: 'owner', source: 'OWNER', text: redacted } : null;
  const handedOff = next.kind === 'HANDOFF';
  const newState: StoredState = { facts, stuckTurns, uiLanguage: input.language };

  const [updated] = await app.db
    .update(conversations)
    .set({
      status: handedOff ? 'HANDED_OFF' : row.status,
      language,
      handoffReason: handedOff ? next.reason : row.handoffReason,
      redactedMessages: JSON.stringify([...messages, ...(ownerMessage ? [ownerMessage] : []), reply]),
      facts: JSON.stringify(newState),
      updatedAt: app.clock.now().toISOString(),
    })
    .where(eq(conversations.id, id))
    .returning();
  if (!updated) throw notFound();

  app.logger.info('advisor.turn', { conversationId: id, source: reply.source, nextKind: next.kind });
  return toView(app, updated, llmUsable);
}

export async function requestHandoff(app: AppContext, owner: Owner, id: string, language: Locale): Promise<ConversationView> {
  const row = await loadConversation(app, owner.ownerId, id);
  const messages = readMessages(row);
  const reply: StoredMessage = { role: 'advisor', source: 'TEMPLATE', text: translate(language, 'advisor.handoff.REQUESTED') };
  const [updated] = await app.db
    .update(conversations)
    .set({
      status: 'HANDED_OFF',
      handoffReason: 'REQUESTED',
      redactedMessages: JSON.stringify([...messages, reply]),
      updatedAt: app.clock.now().toISOString(),
    })
    .where(eq(conversations.id, id))
    .returning();
  if (!updated) throw notFound();
  return toView(app, updated, (await usableLlm(app, owner.subjectRef)) !== null);
}

type Understood = { update: FactUpdate; turn: OwnerTurn | null; llmDown: boolean };

/** A tapped answer, then plain text for the question asked, and only then the LLM. */
async function understand(
  app: AppContext,
  llm: LlmProvider | null,
  facts: AdvisorFacts,
  askedSlot: AdvisorSlot | null,
  redactedText: string | null,
  answer: SlotAnswer | undefined,
): Promise<Understood> {
  if (answer) {
    const update = updateFromSlotAnswer(answer);
    if (!update) throw invalidRequest([{ path: 'answer', code: 'invalid_value' }]);
    return { update, turn: null, llmDown: false };
  }
  if (!redactedText) return { update: {}, turn: null, llmDown: false };

  const direct = askedSlot ? parseSlotText(askedSlot, redactedText) : null;
  if (direct) return { update: direct, turn: null, llmDown: false };

  const plain = readPlainFacts(redactedText);
  if (!llm) return { update: plain, turn: null, llmDown: true };
  try {
    const turn = await readOwnerTurn(llm, { facts, askedSlot, redactedText });
    // The model's reading wins. Plain patterns only fill what it dropped.
    return { update: { ...plain, ...turn.update }, turn, llmDown: false };
  } catch (error) {
    if (!isLlmUnavailable(error)) throw error;
    app.logger.error('advisor.llm_unavailable', { reason: error.reason });
    return { update: plain, turn: null, llmDown: true };
  }
}

async function decideNext(app: AppContext, facts: AdvisorFacts, turn: OwnerTurn | null, ownerTurns: number): Promise<ReplyNext> {
  if (turn?.intents.includes('WANTS_HUMAN')) return { kind: 'HANDOFF', reason: 'REQUESTED' };
  if (turn?.sitesDiffer) return { kind: 'HANDOFF', reason: 'SITES_DIFFER' };
  if (ownerTurns > MAX_OWNER_TURNS) return { kind: 'HANDOFF', reason: 'TOO_MANY_TURNS' };

  const slot = nextSlot(facts);
  if (slot) return { kind: 'ASK', slot };

  const recommendation = await recommendFor(app, facts);
  const nothingHere = recommendation.lines.length === 0 && recommendation.blocked.some((item) => item.blockers.some((blocker) => blocker.rule === 'CITY_TIER'));
  return nothingHere ? handoff('NOT_SERVICEABLE_CITY') : { kind: 'RECOMMEND', recommendation };
}

const handoff = (reason: HandoffReason): ReplyNext => ({ kind: 'HANDOFF', reason });

function buildNotes(input: {
  changes: ReturnType<typeof applyFactUpdate>['changes'];
  turn: OwnerTurn | null;
  couldNotRead: boolean;
  notUnderstood: boolean;
  offerPerson: boolean;
  closestName: string | null;
}): ReplyNote[] {
  const notes: ReplyNote[] = input.changes.map((change) => ({ kind: 'CHANGED', change }));
  const intents = new Set(input.turn?.intents ?? []);

  if (intents.has('RULE_BYPASS')) notes.push({ kind: 'RULES_FIXED' });
  if (intents.has('DISCOUNT')) notes.push({ kind: 'DISCOUNT' });
  if (intents.has('COMPETITOR')) notes.push({ kind: 'COMPETITOR' });
  if (intents.has('OFF_TOPIC')) notes.push({ kind: 'OFF_TOPIC' });
  if (intents.has('SAVE_FOR_LATER')) notes.push({ kind: 'SAVE_FOR_LATER' });
  if (intents.has('READY_TO_BUY')) notes.push({ kind: 'READY' });
  if (intents.has('UNKNOWN_PRODUCT')) {
    const thing = input.turn?.unknownProduct ? cleanWords(input.turn.unknownProduct) : undefined;
    if (thing) notes.push({ kind: 'UNKNOWN_PRODUCT', thing, closestName: input.closestName });
  }
  if (input.couldNotRead) notes.push({ kind: 'LLM_DOWN' });
  else if (input.notUnderstood) notes.push({ kind: 'NOT_UNDERSTOOD' });
  if (input.offerPerson) notes.push({ kind: 'OFFER_PERSON' });
  return notes;
}

function closestProductName(catalogue: Awaited<ReturnType<AppContext['catalogue']>>, turn: OwnerTurn | null, facts: AdvisorFacts): string | null {
  if (!turn?.closestNeed) return null;
  const id = productsForNeed(turn.closestNeed, facts.segment)[0];
  return id ? getProduct(catalogue, id).name : null;
}

function replyLocale(uiLocale: Locale, language: OwnerLanguage | undefined): Locale {
  if (language === 'en') return 'en';
  if (language === 'hi' || language === 'hinglish') return 'hi';
  return uiLocale;
}

/** The language of the owner's latest words. A tap has no language, so it keeps the last one. */
function replyLanguage(row: ConversationRow, state: StoredState, uiLocale: Locale, turn: OwnerTurn | null): OwnerLanguage {
  if (turn) return turn.language;
  if (uiLocale !== state.uiLanguage) return uiLocale;
  return row.language as OwnerLanguage;
}

async function recommendFor(app: AppContext, facts: AdvisorFacts): Promise<Recommendation> {
  const profile = toDiscoveryProfile(facts);
  return recommend(app, {
    cityTier: profile.cityTier,
    segment: profile.segment,
    employeeCount: profile.employeeCount,
    numSites: profile.numSites,
    gstinStatus: profile.gstinStatus,
    fibreAvailable: profile.fibreAvailable,
    connectivity: profile.connectivity,
    needs: profile.needs,
    requestedProducts: profile.requestedProducts ?? [],
    counts: profile.counts,
  });
}

async function latestConversation(app: AppContext, ownerId: string): Promise<ConversationRow | null> {
  const [row] = await app.db
    .select()
    .from(conversations)
    .where(and(eq(conversations.ownerId, ownerId), ne(conversations.status, 'CLOSED')))
    .orderBy(desc(sql`rowid`))
    .limit(1);
  return row ?? null;
}

/** Filters by owner, so a wrong owner and a missing chat look the same: 404. */
async function loadConversation(app: AppContext, ownerId: string, id: string): Promise<ConversationRow> {
  const [row] = await app.db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.ownerId, ownerId)))
    .limit(1);
  if (!row) throw notFound();
  return row;
}

function readState(row: ConversationRow): StoredState {
  if (!row.facts) return { facts: EMPTY_FACTS, stuckTurns: 0, uiLanguage: 'en' };
  return JSON.parse(row.facts) as StoredState;
}

function readMessages(row: ConversationRow): StoredMessage[] {
  return row.redactedMessages ? (JSON.parse(row.redactedMessages) as StoredMessage[]) : [];
}

async function toView(app: AppContext, row: ConversationRow, llmAvailable: boolean): Promise<ConversationView> {
  const { facts } = readState(row);
  const askedSlot = row.status === 'HANDED_OFF' ? null : nextSlot(facts);
  const recommendation = askedSlot === null && row.status !== 'HANDED_OFF' ? await recommendFor(app, facts) : null;
  const usesPerson = recommendation?.lines.some((line) => line.productId === 'P05' || line.productId === 'P06' || line.productId === 'P10') ?? false;
  return {
    id: row.id,
    status: row.status,
    messages: readMessages(row),
    askedSlot,
    facts,
    recommendation,
    handoffReason: row.handoffReason,
    assistSuggested: facts.segment === 'mfg' || facts.segment === 'multi' || usesPerson,
    llmAvailable,
  };
}
