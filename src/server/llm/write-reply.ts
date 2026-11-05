import { checkReply, fillSlots, type GuardFailure } from './output-guard';
import type { LlmProvider } from './provider';
import type { OwnerLanguage } from './read-owner-turn';

const LANGUAGE_NAMES: Readonly<Record<OwnerLanguage, string>> = {
  en: 'English',
  hi: 'Hindi in Devanagari script',
  hinglish: 'Hindi written in Latin letters, the way people text',
  mr: 'Marathi',
  ta: 'Tamil',
  te: 'Telugu',
  kn: 'Kannada',
  gu: 'Gujarati',
  bn: 'Bengali',
  pa: 'Punjabi',
  ml: 'Malayalam',
};

const SYSTEM = `You write chat replies for the Accel Business advisor, talking to a busy small business owner in India on a phone.

Everything you may say is in the BRIEF. The code behind you has already decided what can be sold and at what price, and you only put it in friendly words.

Rules you must never break:
- Never write a digit, a price, an amount, a percentage or a product name yourself. Numbers and product names reach the owner only through slots, which are words in double curly braces in the BRIEF, copied exactly. A slot is replaced by the real value on screen.
- Use only slots that appear in the BRIEF. Never invent one. A BRIEF with no slots means your reply has none.
- Never recommend or mention a product unless the BRIEF does. If the BRIEF only asks a question, ask only that question.
- Never promise a discount, a waiver, a free item or a date. Never compare with other providers.
- Say nothing that is not in the BRIEF. Never ask for a name, a GST number or any other ID number.

Style:
- Warm, plain words, no telecom jargon and no sales talk. Short sentences.
- Plain text only, with no markdown and no bullet symbols. Separate items with commas or short sentences.
- No greeting, because this is the middle of a conversation. Talk to the owner as "you".
- Write every sentence in the requested language, translating the BRIEF, which is in English. Numbers and product names stay in their slots.
- At most 60 words when asking a question, and at most 110 when recommending.`;

const MAX_TOKENS = 700;

export type WrittenReply = { text: string };

/**
 * Asks the model to word a reply. Returns null if the words can't be trusted after one retry, and
 * the caller then uses its template. Rejects if the LLM is down. The model never sees what the
 * owner typed, only the code's brief, so a prompt injection in chat has nothing to work on here.
 */
export async function writeReply(
  llm: LlmProvider,
  input: { language: OwnerLanguage; brief: string; values: Readonly<Record<string, string>>; catalogueNames: readonly string[] },
): Promise<{ text: string; failure: null } | { text: null; failure: GuardFailure }> {
  const allowed = slotsIn(input.brief);
  const slotLine = allowed.length > 0 ? `Slots you may use: ${allowed.map((slot) => `{{${slot}}}`).join(', ')}.` : 'This reply uses no slots.';
  const prompt = `Write the reply in ${LANGUAGE_NAMES[input.language]}. ${slotLine}\n\nBRIEF:\n${input.brief}`;
  // Only what the brief raised, so a value held for another turn can't appear by accident.
  const values = Object.fromEntries(Object.entries(input.values).filter(([slot]) => allowed.includes(slot)));
  const context = { values, catalogueNames: input.catalogueNames, brief: input.brief };

  let failure: GuardFailure = 'EMPTY';
  for (const note of ['', '\n\nYour last attempt was refused. Remember: no digits, amounts or product names of your own, and only the slots in the BRIEF.']) {
    const response = await llm.complete({
      system: SYSTEM,
      tools: [],
      maxTokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt + note }],
    });
    const result = checkReply(response.text, context);
    if (result.ok) return { text: result.text, failure: null };
    failure = result.reason;
  }
  return { text: null, failure };
}

function slotsIn(brief: string): string[] {
  return [...new Set([...brief.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map((match) => match[1] ?? ''))];
}

export { fillSlots };
