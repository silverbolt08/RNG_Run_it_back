import { describe, expect, it } from 'vitest';
import {
  addDays,
  advanceStage,
  applyDelay,
  buildTracker,
  canPay,
  initialStage,
  ORDER_STAGES,
  planOrder,
  type OrderState,
} from '@/domain/orders/orders';
import { loadTestCatalogue } from '../../../helpers/catalogue';

const catalogue = loadTestCatalogue();
const TODAY = '2026-07-15';

function stateFor(overrides: Partial<OrderState> = {}): OrderState {
  return {
    placedOn: TODAY,
    status: 'ACTIVE',
    stage: 'KYC_CONFIRMED',
    paymentStatus: 'PENDING',
    plan: planOrder(catalogue, [{ productId: 'P01', quantity: 1 }], TODAY),
    delay: null,
    ...overrides,
  };
}

describe('addDays', () => {
  it.each([
    ['2026-07-15', 0, '2026-07-15'],
    ['2026-07-15', 5, '2026-07-20'],
    ['2026-07-31', 1, '2026-08-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2028-02-28', 1, '2028-02-29'],
  ])('%s plus %i days is %s', (start, days, expected) => {
    expect(addDays(start, days)).toBe(expected);
  });

  it('rejects an invalid date', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow();
  });
});

describe('planOrder', () => {
  it('counts each product from the business date using its typical_install_days', () => {
    const plan = planOrder(
      catalogue,
      [
        { productId: 'P01', quantity: 1 }, // 5 days
        { productId: 'P07', quantity: 2 }, // 1 day
        { productId: 'P23', quantity: 4 }, // 4 days
      ],
      TODAY,
    );
    expect(plan.products).toEqual([
      { productId: 'P01', installDays: 5, expectedDate: '2026-07-20' },
      { productId: 'P07', installDays: 1, expectedDate: '2026-07-16' },
      { productId: 'P23', installDays: 4, expectedDate: '2026-07-19' },
    ]);
  });

  it('expects activation when the slowest product is installed', () => {
    const plan = planOrder(
      catalogue,
      [
        { productId: 'P06', quantity: 1 }, // 30 days
        { productId: 'P07', quantity: 1 }, // 1 day
      ],
      TODAY,
    );
    expect(plan.expectedActivationDate).toBe('2026-08-14');
  });

  it('refuses an empty order', () => {
    expect(() => planOrder(catalogue, [], TODAY)).toThrow();
  });
});

describe('initialStage', () => {
  it('starts past the KYC stage when verified', () => {
    expect(initialStage('VERIFIED')).toBe('KYC_CONFIRMED');
  });

  it('holds at order placed while KYC is under manual review', () => {
    expect(initialStage('MANUAL_REVIEW')).toBe('ORDER_PLACED');
  });
});

describe('advanceStage', () => {
  it('walks a paid order through every stage to activated', () => {
    let state = stateFor({ stage: 'PAYMENT_CONFIRMED', paymentStatus: 'PAID' });
    const seen: string[] = [];
    for (;;) {
      const result = advanceStage(state);
      if (!result.ok) break;
      seen.push(result.stage);
      state = { ...state, stage: result.stage };
    }
    expect(seen).toEqual(['INSTALL_SCHEDULED', 'INSTALLING', 'ACTIVATED']);
  });

  it('clears manual review to KYC confirmed', () => {
    expect(advanceStage(stateFor({ stage: 'ORDER_PLACED' }))).toEqual({ ok: true, stage: 'KYC_CONFIRMED' });
  });

  it.each(['PENDING', 'FAILED'] as const)('will not pass the payment stage with payment %s', (paymentStatus) => {
    expect(advanceStage(stateFor({ stage: 'KYC_CONFIRMED', paymentStatus }))).toEqual({
      ok: false,
      reason: 'PAYMENT_REQUIRED',
    });
  });

  it('moves to payment confirmed once paid', () => {
    expect(advanceStage(stateFor({ stage: 'KYC_CONFIRMED', paymentStatus: 'PAID' }))).toEqual({
      ok: true,
      stage: 'PAYMENT_CONFIRMED',
    });
  });

  it('has nowhere to go after activation', () => {
    expect(advanceStage(stateFor({ stage: 'ACTIVATED', paymentStatus: 'PAID' }))).toEqual({
      ok: false,
      reason: 'ALREADY_ACTIVATED',
    });
  });

  it('will not advance a cancelled order', () => {
    expect(advanceStage(stateFor({ status: 'CANCELLED', stage: 'PAYMENT_CONFIRMED', paymentStatus: 'PAID' }))).toEqual({
      ok: false,
      reason: 'NOT_ACTIVE',
    });
  });
});

describe('canPay', () => {
  it('lets the owner pay once KYC is confirmed', () => {
    expect(canPay(stateFor({ stage: 'KYC_CONFIRMED' }))).toEqual({ ok: true });
    expect(canPay(stateFor({ stage: 'KYC_CONFIRMED', paymentStatus: 'FAILED' }))).toEqual({ ok: true });
  });

  it('asks the owner to wait while KYC is under review', () => {
    expect(canPay(stateFor({ stage: 'ORDER_PLACED' }))).toEqual({ ok: false, reason: 'KYC_NOT_CONFIRMED' });
  });

  it('refuses a second payment', () => {
    expect(canPay(stateFor({ stage: 'PAYMENT_CONFIRMED', paymentStatus: 'PAID' }))).toEqual({
      ok: false,
      reason: 'ALREADY_PAID',
    });
  });

  it('refuses payment on a cancelled order', () => {
    expect(canPay(stateFor({ status: 'CANCELLED' }))).toEqual({ ok: false, reason: 'NOT_ACTIVE' });
  });
});

describe('applyDelay', () => {
  it('records the reason and moves activation to the new date', () => {
    const state = stateFor();
    const result = applyDelay(state, { reason: 'FIBRE_NOT_FEASIBLE', newDate: '2026-08-01' });
    expect(result).toEqual({
      ok: true,
      delay: { reason: 'FIBRE_NOT_FEASIBLE', newDate: '2026-08-01', previousDate: '2026-07-20' },
    });
  });

  it.each([
    ['the current expected date', '2026-07-20'],
    ['an earlier date', '2026-07-18'],
  ])('rejects %s, because that is no delay', (_label, newDate) => {
    expect(applyDelay(stateFor(), { reason: 'SITE_ACCESS', newDate })).toEqual({ ok: false, reason: 'NOT_LATER' });
  });

  it('measures a second delay from the first one', () => {
    const first = applyDelay(stateFor(), { reason: 'SITE_ACCESS', newDate: '2026-08-01' });
    if (!first.ok) throw new Error('first delay should apply');
    const state = stateFor({ delay: first.delay });
    expect(applyDelay(state, { reason: 'PARTNER_DELAY', newDate: '2026-07-25' })).toEqual({
      ok: false,
      reason: 'NOT_LATER',
    });
    expect(applyDelay(state, { reason: 'PARTNER_DELAY', newDate: '2026-08-05' })).toMatchObject({
      ok: true,
      delay: { previousDate: '2026-08-01', newDate: '2026-08-05' },
    });
  });

  it('refuses a delay on an activated order', () => {
    expect(
      applyDelay(stateFor({ stage: 'ACTIVATED', paymentStatus: 'PAID' }), {
        reason: 'SITE_ACCESS',
        newDate: '2026-08-01',
      }),
    ).toEqual({ ok: false, reason: 'ALREADY_ACTIVATED' });
  });
});

describe('buildTracker', () => {
  it('marks stages done, current and upcoming', () => {
    const tracker = buildTracker(stateFor({ stage: 'KYC_CONFIRMED' }));
    expect(tracker.stages.map((stage) => [stage.stage, stage.status])).toEqual([
      ['ORDER_PLACED', 'DONE'],
      ['KYC_CONFIRMED', 'CURRENT'],
      ['PAYMENT_CONFIRMED', 'UPCOMING'],
      ['INSTALL_SCHEDULED', 'UPCOMING'],
      ['INSTALLING', 'UPCOMING'],
      ['ACTIVATED', 'UPCOMING'],
    ]);
    expect(tracker.stages).toHaveLength(ORDER_STAGES.length);
  });

  it('says what happens next and when, for the owner to pay', () => {
    expect(buildTracker(stateFor()).next).toEqual({
      stage: 'PAYMENT_CONFIRMED',
      action: 'OWNER_PAYS',
      actor: 'OWNER',
      expectedDate: TODAY,
    });
  });

  it('says a failed payment needs a retry', () => {
    expect(buildTracker(stateFor({ paymentStatus: 'FAILED' })).next).toMatchObject({
      action: 'OWNER_RETRIES_PAYMENT',
      actor: 'OWNER',
    });
  });

  it('says KYC review comes next while under review, within a day', () => {
    expect(buildTracker(stateFor({ stage: 'ORDER_PLACED' })).next).toEqual({
      stage: 'KYC_CONFIRMED',
      action: 'ACCEL_REVIEWS_KYC',
      actor: 'ACCEL',
      expectedDate: '2026-07-16',
    });
  });

  it('gives the activation date as the next step once installing', () => {
    expect(buildTracker(stateFor({ stage: 'INSTALLING', paymentStatus: 'PAID' })).next).toEqual({
      stage: 'ACTIVATED',
      action: 'ACCEL_ACTIVATES',
      actor: 'ACCEL',
      expectedDate: '2026-07-20',
    });
  });

  it('has no next step once activated', () => {
    expect(buildTracker(stateFor({ stage: 'ACTIVATED', paymentStatus: 'PAID' })).next).toBeNull();
  });

  it('keeps stage dates in order and never past activation, even for a one-day install', () => {
    const plan = planOrder(catalogue, [{ productId: 'P07', quantity: 1 }], TODAY);
    const dates = buildTracker(stateFor({ plan })).stages.map((stage) => stage.expectedDate);
    expect(dates).toEqual([...dates].sort());
    expect(dates.at(-1)).toBe('2026-07-16');
  });

  it('shows a delay with its reason, the new date and the shifted product', () => {
    const tracker = buildTracker(
      stateFor({
        delay: { reason: 'FIBRE_NOT_FEASIBLE', newDate: '2026-08-01', previousDate: '2026-07-20' },
      }),
    );
    expect(tracker.expectedActivationDate).toBe('2026-08-01');
    expect(tracker.originalActivationDate).toBe('2026-07-20');
    expect(tracker.delay).toEqual({ reason: 'FIBRE_NOT_FEASIBLE', newDate: '2026-08-01', previousDate: '2026-07-20' });
    expect(tracker.products).toEqual([{ productId: 'P01', installDays: 5, expectedDate: '2026-08-01' }]);
    expect(tracker.stages.at(-1)?.expectedDate).toBe('2026-08-01');
  });

  it('only shifts the products that were holding up activation', () => {
    const plan = planOrder(
      catalogue,
      [
        { productId: 'P01', quantity: 1 },
        { productId: 'P07', quantity: 1 },
      ],
      TODAY,
    );
    const tracker = buildTracker(
      stateFor({ plan, delay: { reason: 'SITE_ACCESS', newDate: '2026-07-30', previousDate: '2026-07-20' } }),
    );
    expect(tracker.products).toEqual([
      { productId: 'P01', installDays: 5, expectedDate: '2026-07-30' },
      { productId: 'P07', installDays: 1, expectedDate: '2026-07-16' },
    ]);
  });

  it('offers AirFiber only when the delay is that fibre cannot reach the site', () => {
    const feasibility = buildTracker(
      stateFor({ delay: { reason: 'FIBRE_NOT_FEASIBLE', newDate: '2026-08-01', previousDate: '2026-07-20' } }),
    );
    expect(feasibility.alternativeProductIds).toEqual(['P04']);
    const access = buildTracker(
      stateFor({ delay: { reason: 'SITE_ACCESS', newDate: '2026-08-01', previousDate: '2026-07-20' } }),
    );
    expect(access.alternativeProductIds).toEqual([]);
    expect(buildTracker(stateFor()).alternativeProductIds).toEqual([]);
  });

  it('shows that a cancelled order has no next step', () => {
    const tracker = buildTracker(stateFor({ status: 'CANCELLED' }));
    expect(tracker.next).toBeNull();
    expect(tracker.status).toBe('CANCELLED');
  });
});
