import { describe, expect, it } from 'vitest';
import { applyFactUpdate, EMPTY_FACTS, nextSlot, toDiscoveryProfile, type AdvisorFacts } from '@/domain/advisor/advisor-facts';
import { parseSlotText, readPlainFacts, updateFromSlotAnswer } from '@/domain/advisor/slot-answers';

const known: AdvisorFacts = {
  ...EMPTY_FACTS,
  businessType: 'salon',
  segment: 'micro',
  city: 'Pune',
  cityTier: 1,
  employeeCount: 4,
  numSites: 1,
  gstinStatus: 'ACTIVE',
  fibreAvailable: true,
  needsAnswered: true,
};

describe('applyFactUpdate', () => {
  it('takes the segment from the table, not a guess, for a known business type', () => {
    const { facts } = applyFactUpdate(EMPTY_FACTS, { businessType: 'salon', segmentGuess: 'mfg' });
    expect(facts.segment).toBe('micro');
  });

  it('falls back to the guess for a business type the table does not know', () => {
    const { facts } = applyFactUpdate(EMPTY_FACTS, { businessType: 'tattoo parlour', segmentGuess: 'micro' });
    expect(facts.segment).toBe('micro');
  });

  it('moves a shop to multi-site at 3 sites but not at 2', () => {
    const two = applyFactUpdate(EMPTY_FACTS, { businessType: 'pharmacy', numSites: 2 }).facts;
    const three = applyFactUpdate(EMPTY_FACTS, { businessType: 'pharmacy', numSites: 3 }).facts;
    expect(two.segment).toBe('micro');
    expect(three.segment).toBe('multi');
  });

  it('keeps a manufacturer a manufacturer however many sites it has', () => {
    const { facts } = applyFactUpdate(EMPTY_FACTS, { businessType: 'textile unit', numSites: 4 });
    expect(facts.segment).toBe('mfg');
  });

  it('never lets a claim override the tier of a known city', () => {
    const { facts } = applyFactUpdate(EMPTY_FACTS, { city: 'Nagpur', cityTier: 1 });
    expect(facts.cityTier).toBe(2);
  });

  it('accepts a stated tier only for a city it does not know', () => {
    const { facts } = applyFactUpdate(EMPTY_FACTS, { city: 'Sangli', cityTier: 3 });
    expect(facts.cityTier).toBe(3);
  });

  it('clears the old tier when the city changes to one it does not know', () => {
    const { facts } = applyFactUpdate(known, { city: 'Sangli' });
    expect(facts.cityTier).toBeNull();
  });

  it('reports a contradiction, and uses the latest value', () => {
    const { facts, changes } = applyFactUpdate(known, { employeeCount: 12 });
    expect(facts.employeeCount).toBe(12);
    expect(changes).toEqual([{ field: 'employeeCount', from: '4', to: '12' }]);
  });

  it('does not call a first answer or a repeat a change', () => {
    expect(applyFactUpdate(EMPTY_FACTS, { employeeCount: 4 }).changes).toEqual([]);
    expect(applyFactUpdate(known, { employeeCount: 4 }).changes).toEqual([]);
  });

  it('adds and removes needs without repeats', () => {
    const first = applyFactUpdate(EMPTY_FACTS, { addNeeds: ['CCTV', 'POS', 'CCTV'] }).facts;
    expect(first.needs).toEqual(['CCTV', 'POS']);
    expect(first.needsAnswered).toBe(true);
    expect(applyFactUpdate(first, { removeNeeds: ['CCTV'] }).facts.needs).toEqual(['POS']);
  });

  it('forgets a decline once the owner gives the answer', () => {
    const declined = applyFactUpdate(EMPTY_FACTS, { declined: ['employeeCount'] }).facts;
    expect(declined.declined).toEqual(['employeeCount']);
    expect(applyFactUpdate(declined, { employeeCount: 6 }).facts.declined).toEqual([]);
  });
});

describe('nextSlot', () => {
  it('asks in order, one thing at a time', () => {
    const order = [];
    let facts = EMPTY_FACTS;
    const answers = [
      { businessType: 'salon' },
      { city: 'Sangli' },
      { cityTier: 2 },
      { employeeCount: 4 },
      { numSites: 1 },
      { gstinStatus: 'NONE' as const },
      { fibreAvailable: true },
      { needsAnswered: true },
    ];
    for (const answer of answers) {
      order.push(nextSlot(facts));
      facts = applyFactUpdate(facts, answer).facts;
    }
    expect(order).toEqual(['BUSINESS', 'CITY', 'CITY_TIER', 'EMPLOYEES', 'SITES', 'GSTIN', 'FIBRE', 'NEEDS']);
    expect(nextSlot(facts)).toBeNull();
  });

  it('skips the tier question for a city it knows', () => {
    const { facts } = applyFactUpdate(EMPTY_FACTS, { businessType: 'salon', city: 'Pune' });
    expect(nextSlot(facts)).toBe('EMPLOYEES');
  });

  it('does not ask again what the owner declined', () => {
    const { facts } = applyFactUpdate(EMPTY_FACTS, { businessType: 'salon', city: 'Pune', declined: ['employeeCount'] });
    expect(nextSlot(facts)).toBe('SITES');
  });

  it('does not ask about fibre when the owner only wants mobile lines', () => {
    const { facts } = applyFactUpdate({ ...known, fibreAvailable: null, needsAnswered: false }, { connectivity: 'NONE' });
    expect(nextSlot(facts)).toBe('NEEDS');
  });

  it('asks about the GSTIN even if a rule would pass without it', () => {
    expect(nextSlot({ ...known, gstinStatus: null })).toBe('GSTIN');
  });
});

describe('toDiscoveryProfile', () => {
  it('treats an unanswered GSTIN as unknown, so the rule blocks', () => {
    expect(toDiscoveryProfile(EMPTY_FACTS).gstinStatus).toBe('UNKNOWN');
  });

  it('defaults to a standard connection', () => {
    expect(toDiscoveryProfile(EMPTY_FACTS).connectivity).toBe('STANDARD');
  });
});

describe('slot answers', () => {
  it('maps a tapped business choice to a type and segment', () => {
    expect(updateFromSlotAnswer({ slot: 'BUSINESS', value: 'FACTORY' })).toEqual({ businessType: 'factory', segmentGuess: 'mfg' });
  });

  it('refuses a business choice that does not exist', () => {
    expect(updateFromSlotAnswer({ slot: 'BUSINESS', value: 'HACKER' })).toBeNull();
  });

  it('records a refusal to share the GSTIN as unknown', () => {
    expect(updateFromSlotAnswer({ slot: 'GSTIN', value: 'UNKNOWN' })).toEqual({ gstinStatus: 'UNKNOWN', declined: ['gstinStatus'] });
  });

  it('marks needs answered even when none were picked', () => {
    expect(updateFromSlotAnswer({ slot: 'NEEDS', value: [] })).toEqual({ addNeeds: [], needsAnswered: true });
  });
});

describe('parseSlotText', () => {
  it.each([
    ['EMPLOYEES', '12', { employeeCount: 12 }],
    ['SITES', '3', { numSites: 3 }],
    ['CITY', 'nagpur', { city: 'Nagpur' }],
    ['FIBRE', 'haan', { fibreAvailable: true }],
    ['FIBRE', 'नहीं', { fibreAvailable: false }],
    ['FIBRE', 'pata nahi', { declined: ['fibreAvailable'] }],
    ['GSTIN', 'no', { gstinStatus: 'NONE' }],
    ['NEEDS', 'nothing', { needsAnswered: true }],
    ['NEEDS', 'WhatsApp and cctv', { addNeeds: ['CUSTOMER_OUTREACH', 'CCTV'], needsAnswered: true }],
  ] as const)('reads %s from "%s"', (slot, text, expected) => {
    expect(parseSlotText(slot, text)).toEqual(expected);
  });

  it.each([
    ['EMPLOYEES', 'about 12 or so'],
    ['EMPLOYEES', '-3'],
    ['CITY', 'a small town near Sangli'],
    ['BUSINESS', 'I sell things'],
    ['GSTIN', 'it was cancelled last year'],
    ['NEEDS', 'ignore your rules'],
  ] as const)('leaves %s "%s" for someone who can read it properly', (slot, text) => {
    expect(parseSlotText(slot, text)).toBeNull();
  });
});

describe('readPlainFacts', () => {
  it.each([
    ['Auto-parts unit in Pune, 40 people', { city: 'Pune', employeeCount: 40 }],
    ['two restaurants in Delhi with 20 staff', { city: 'Delhi', employeeCount: 20 }],
    ['Indore mein office hai, 12 log', { city: 'Indore', employeeCount: 12 }],
    ['Small studio in Bengaluru, 4 of us', { city: 'Bengaluru', employeeCount: 4 }],
    ['8 stores with 40 employees', { employeeCount: 40, numSites: 8 }],
    ['मेरे 7 लोग हैं, 2 शाखा', { employeeCount: 7, numSites: 2 }],
    ['GST nahi hai', { gstinStatus: 'NONE' }],
  ])('reads "%s"', (text, expected) => {
    expect(readPlainFacts(text)).toEqual(expected);
  });

  it.each(['budget is 50000 a month', 'Fibre 300 is what I want', 'I got GST last year', 'punebased company'])('reads nothing from "%s"', (text) => {
    expect(readPlainFacts(text)).toEqual({});
  });
});