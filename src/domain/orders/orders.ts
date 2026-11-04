import { getProduct, type Catalogue } from '../catalogue/catalogue';
import type { BundleLine } from '../pricing/pricing';

export const ORDER_STAGES = [
  'ORDER_PLACED',
  'KYC_CONFIRMED',
  'PAYMENT_CONFIRMED',
  'INSTALL_SCHEDULED',
  'INSTALLING',
  'ACTIVATED',
] as const;
export type OrderStage = (typeof ORDER_STAGES)[number];

export const ORDER_STATUSES = ['ACTIVE', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ['PENDING', 'FAILED', 'PAID'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const DELAY_REASONS = ['FIBRE_NOT_FEASIBLE', 'PARTNER_DELAY', 'SITE_ACCESS', 'WEATHER', 'OTHER'] as const;
export type DelayReason = (typeof DELAY_REASONS)[number];

export type ProductPlan = { productId: string; installDays: number; expectedDate: string };

export type OrderPlan = { products: ProductPlan[]; expectedActivationDate: string };

export type OrderDelay = { reason: DelayReason; newDate: string; previousDate: string };

export type OrderState = {
  placedOn: string;
  status: OrderStatus;
  stage: OrderStage;
  paymentStatus: PaymentStatus;
  plan: OrderPlan;
  delay: OrderDelay | null;
};

export type NextAction =
  | 'ACCEL_REVIEWS_KYC'
  | 'OWNER_PAYS'
  | 'OWNER_RETRIES_PAYMENT'
  | 'ACCEL_SCHEDULES_INSTALL'
  | 'ACCEL_INSTALLS'
  | 'ACCEL_ACTIVATES';

export type NextStep = {
  stage: OrderStage;
  action: NextAction;
  actor: 'OWNER' | 'ACCEL';
  expectedDate: string;
};

export type TrackerStage = {
  stage: OrderStage;
  status: 'DONE' | 'CURRENT' | 'UPCOMING';
  expectedDate: string;
};

export type Tracker = {
  status: OrderStatus;
  stage: OrderStage;
  placedOn: string;
  stages: TrackerStage[];
  products: ProductPlan[];
  expectedActivationDate: string;
  originalActivationDate: string;
  delay: OrderDelay | null;
  next: NextStep | null;
  /** What to offer instead, such as AirFiber when fibre can't reach the site. */
  alternativeProductIds: string[];
};

const MS_PER_DAY = 86_400_000;
const AIRFIBER_ID = 'P04';

// Assumptions: the catalogue gives install days only, so these two fill the stages around it.
// A manual KYC review is said to take a day, and scheduling happens the day after payment.
const KYC_REVIEW_DAYS = 1;
const DAYS_TO_SCHEDULE = 1;

/** Counts calendar days on the date string alone, so no time zone can move an expected date. */
export function addDays(isoDate: string, days: number): string {
  const time = Date.parse(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(time)) throw new RangeError(`Invalid date: ${isoDate}`);

  const shifted = new Date(time);
  // Date.parse rolls 30 February over to March rather than failing, so check the round trip.
  if (shifted.toISOString().slice(0, 10) !== isoDate) throw new RangeError(`Invalid date: ${isoDate}`);
  return new Date(time + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Expected dates per product, counted from the business date using `typical_install_days`. */
export function planOrder(catalogue: Catalogue, lines: readonly BundleLine[], placedOn: string): OrderPlan {
  if (lines.length === 0) throw new RangeError('An order needs at least one product');

  const products = lines.map((line) => {
    const { installDays } = getProduct(catalogue, line.productId);
    return { productId: line.productId, installDays, expectedDate: addDays(placedOn, installDays) };
  });
  const expectedActivationDate = products.map((product) => product.expectedDate).sort().at(-1) ?? placedOn;
  return { products, expectedActivationDate };
}

export function initialStage(verdict: 'VERIFIED' | 'MANUAL_REVIEW'): OrderStage {
  return verdict === 'VERIFIED' ? 'KYC_CONFIRMED' : 'ORDER_PLACED';
}

export type AdvanceResult =
  | { ok: true; stage: OrderStage }
  | { ok: false; reason: 'NOT_ACTIVE' | 'PAYMENT_REQUIRED' | 'ALREADY_ACTIVATED' };

export function advanceStage(state: OrderState): AdvanceResult {
  if (state.status !== 'ACTIVE') return { ok: false, reason: 'NOT_ACTIVE' };

  const next = stageAfter(state.stage);
  if (next === null) return { ok: false, reason: 'ALREADY_ACTIVATED' };
  if (next === 'PAYMENT_CONFIRMED' && state.paymentStatus !== 'PAID') {
    return { ok: false, reason: 'PAYMENT_REQUIRED' };
  }
  return { ok: true, stage: next };
}

export type PayResult = { ok: true } | { ok: false; reason: 'NOT_ACTIVE' | 'KYC_NOT_CONFIRMED' | 'ALREADY_PAID' };

export function canPay(state: OrderState): PayResult {
  if (state.status !== 'ACTIVE') return { ok: false, reason: 'NOT_ACTIVE' };
  if (state.paymentStatus === 'PAID') return { ok: false, reason: 'ALREADY_PAID' };
  if (state.stage === 'ORDER_PLACED') return { ok: false, reason: 'KYC_NOT_CONFIRMED' };
  return { ok: true };
}

export type DelayResult =
  | { ok: true; delay: OrderDelay }
  | { ok: false; reason: 'NOT_ACTIVE' | 'ALREADY_ACTIVATED' | 'NOT_LATER' };

export function applyDelay(state: OrderState, input: { reason: DelayReason; newDate: string }): DelayResult {
  if (state.status !== 'ACTIVE') return { ok: false, reason: 'NOT_ACTIVE' };
  if (state.stage === 'ACTIVATED') return { ok: false, reason: 'ALREADY_ACTIVATED' };

  const previousDate = currentActivationDate(state);
  if (addDays(input.newDate, 0) <= previousDate) return { ok: false, reason: 'NOT_LATER' };
  return { ok: true, delay: { reason: input.reason, newDate: input.newDate, previousDate } };
}

export function buildTracker(state: OrderState): Tracker {
  const activationDate = currentActivationDate(state);
  return {
    status: state.status,
    stage: state.stage,
    placedOn: state.placedOn,
    stages: buildStages(state, activationDate),
    products: productDates(state),
    expectedActivationDate: activationDate,
    originalActivationDate: state.plan.expectedActivationDate,
    delay: state.delay,
    next: state.status === 'ACTIVE' ? nextStep(state, activationDate) : null,
    alternativeProductIds: state.delay?.reason === 'FIBRE_NOT_FEASIBLE' ? [AIRFIBER_ID] : [],
  };
}

function currentActivationDate(state: OrderState): string {
  return state.delay?.newDate ?? state.plan.expectedActivationDate;
}

function stageAfter(stage: OrderStage): OrderStage | null {
  return ORDER_STAGES[ORDER_STAGES.indexOf(stage) + 1] ?? null;
}

// A delay moves only the products that were holding up activation.
function productDates(state: OrderState): ProductPlan[] {
  const { delay, plan } = state;
  if (!delay) return plan.products;
  return plan.products.map((product) =>
    product.expectedDate === plan.expectedActivationDate ? { ...product, expectedDate: delay.newDate } : product,
  );
}

function expectedDates(state: OrderState, activationDate: string): Record<OrderStage, string> {
  const capped = (date: string) => (date > activationDate ? activationDate : date);
  const underReview = state.stage === 'ORDER_PLACED';
  const kyc = capped(addDays(state.placedOn, underReview ? KYC_REVIEW_DAYS : 0));
  const schedule = capped(addDays(kyc, DAYS_TO_SCHEDULE));
  const dayBefore = addDays(activationDate, -1);
  return {
    ORDER_PLACED: state.placedOn,
    KYC_CONFIRMED: kyc,
    PAYMENT_CONFIRMED: kyc,
    INSTALL_SCHEDULED: schedule,
    INSTALLING: dayBefore < schedule ? schedule : dayBefore,
    ACTIVATED: activationDate,
  };
}

function buildStages(state: OrderState, activationDate: string): TrackerStage[] {
  const dates = expectedDates(state, activationDate);
  const currentIndex = ORDER_STAGES.indexOf(state.stage);
  return ORDER_STAGES.map((stage, index) => ({
    stage,
    status: index < currentIndex ? 'DONE' : index === currentIndex ? 'CURRENT' : 'UPCOMING',
    expectedDate: dates[stage],
  }));
}

function nextStep(state: OrderState, activationDate: string): NextStep | null {
  const stage = stageAfter(state.stage);
  if (stage === null) return null;

  const expectedDate = expectedDates(state, activationDate)[stage];
  switch (stage) {
    case 'KYC_CONFIRMED':
      return { stage, action: 'ACCEL_REVIEWS_KYC', actor: 'ACCEL', expectedDate };
    case 'PAYMENT_CONFIRMED':
      return {
        stage,
        action: state.paymentStatus === 'FAILED' ? 'OWNER_RETRIES_PAYMENT' : 'OWNER_PAYS',
        actor: 'OWNER',
        expectedDate,
      };
    case 'INSTALL_SCHEDULED':
      return { stage, action: 'ACCEL_SCHEDULES_INSTALL', actor: 'ACCEL', expectedDate };
    case 'INSTALLING':
      return { stage, action: 'ACCEL_INSTALLS', actor: 'ACCEL', expectedDate };
    case 'ACTIVATED':
      return { stage, action: 'ACCEL_ACTIVATES', actor: 'ACCEL', expectedDate };
    case 'ORDER_PLACED':
      return null;
  }
}
