import { and, asc, eq, gt, ne } from 'drizzle-orm';
import type { Catalogue } from '../../domain/catalogue/catalogue';
import { advanceStage, applyDelay, canPay, initialStage, planOrder, type DelayReason } from '../../domain/orders/orders';
import { newPublicId } from '../../lib/ids';
import type { AppContext } from '../app-context';
import type { SessionInfo } from '../auth/session-service';
import { hasActiveConsent } from '../consent/consent-service';
import { recordAudit } from '../db/repositories/audit-repository';
import { orderEvents, orders, owners, paymentAttempts } from '../db/schema';
import type { OrderEventType, PaymentOutcome } from '../db/schema/enums';
import { ApiError, notFound } from '../http/errors';
import { toPage, type Page, type PageQuery } from '../http/request';
import { completeKey, hashRequest, releaseKey, reserveKey } from './idempotency';
import { loadApplication } from './kyc/kyc-repository';
import { stateOf, toOrderView, type OrderRow, type OrderView, type SimulatedOrderView } from './order-view';
import { loadQuote } from './quote-repository';

const KYC_VERDICTS_FOR_ORDER = ['VERIFIED', 'MANUAL_REVIEW'] as const;

/** Filters by owner, so a wrong owner and a missing order look the same: 404. */
async function loadOwnedOrder(app: AppContext, ownerId: string, id: string): Promise<OrderRow> {
  const [row] = await app.db
    .select()
    .from(orders)
    .where(and(eq(orders.id, id), eq(orders.ownerId, ownerId)))
    .limit(1);
  if (!row) throw notFound();
  return row;
}

async function loadAnyOrder(app: AppContext, id: string): Promise<OrderRow> {
  const [row] = await app.db.select().from(orders).where(eq(orders.id, id)).limit(1);
  if (!row) throw notFound();
  return row;
}

async function addEvent(
  app: AppContext,
  orderId: string,
  type: OrderEventType,
  values: { stage?: string; reasonCode?: string; newDate?: string; simulated?: boolean } = {},
): Promise<void> {
  const now = app.clock.now().toISOString();
  await app.db.insert(orderEvents).values({
    id: newPublicId('evt'),
    orderId,
    type,
    stage: values.stage ?? null,
    reasonCode: values.reasonCode ?? null,
    newDate: values.newDate ?? null,
    occurredOn: app.clock.today(),
    simulated: values.simulated ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  });
}

/** The single place status messages go out, so none can skip the consent check. */
async function notify(
  app: AppContext,
  row: Pick<OrderRow, 'id' | 'ownerId'>,
  templateCode: string,
  params: Record<string, string> = {},
): Promise<void> {
  const [owner] = await app.db
    .select({ subjectRef: owners.subjectRef })
    .from(owners)
    .where(eq(owners.id, row.ownerId))
    .limit(1);
  if (!owner || !(await hasActiveConsent(app, owner.subjectRef, 'service_updates'))) return;
  await app.notifications.record({ ownerId: row.ownerId, orderId: row.id, templateCode, params });
}

export async function createOrder(
  app: AppContext,
  session: SessionInfo,
  input: { quoteId: string; kycApplicationId: string },
  idempotencyKey: string,
  requestId: string,
): Promise<{ created: boolean; order: OrderView }> {
  const catalogue = await app.catalogue();
  const reservation = await reserveKey(
    app,
    session.ownerId,
    'ORDER',
    idempotencyKey,
    hashRequest(input.quoteId, '|', input.kycApplicationId),
  );

  if ('replayOf' in reservation) {
    const existing = await loadOwnedOrder(app, session.ownerId, reservation.replayOf);
    return { created: false, order: await toOrderView(app, catalogue, existing) };
  }

  try {
    const row = await placeOrder(app, catalogue, session, input, requestId);
    await completeKey(app, reservation.reservationId, row.id);
    return { created: true, order: await toOrderView(app, catalogue, row) };
  } catch (error) {
    await releaseKey(app, reservation.reservationId);
    throw error;
  }
}

async function placeOrder(
  app: AppContext,
  catalogue: Catalogue,
  session: SessionInfo,
  input: { quoteId: string; kycApplicationId: string },
  requestId: string,
): Promise<OrderRow> {
  const quote = await loadQuote(app, catalogue, session.ownerId, input.quoteId);
  const application = await loadApplication(app, session.ownerId, input.kycApplicationId);

  if (application.quoteId !== input.quoteId) {
    throw new ApiError(422, 'KYC_QUOTE_MISMATCH', 'This verification is for a different quote.');
  }
  if (quote.row.status !== 'ACCEPTED') {
    throw new ApiError(409, 'QUOTE_NOT_ACCEPTED', 'Please accept the quote before placing the order.');
  }

  const verdict = application.verdict;
  if (verdict === 'REJECTED') {
    throw new ApiError(422, 'KYC_REJECTED', 'Verification did not pass for this bundle.', { verdict });
  }
  const suitable = KYC_VERDICTS_FOR_ORDER.find((value) => value === verdict);
  if (!suitable) {
    throw new ApiError(409, 'KYC_NOT_READY', 'Please finish verification before placing the order.', { verdict });
  }

  const now = app.clock.now().toISOString();
  const placedOn = app.clock.today();
  const id = newPublicId('ord');
  const { priced } = quote;

  const [row] = await app.db
    .insert(orders)
    .values({
      id,
      ownerId: session.ownerId,
      quoteId: input.quoteId,
      kycApplicationId: input.kycApplicationId,
      status: 'ACTIVE',
      stage: initialStage(suitable),
      placedOn,
      plan: JSON.stringify(planOrder(catalogue, quote.lines, placedOn)),
      paymentStatus: 'PENDING',
      // Assumption: the mock checkout takes the one-time setup fee and the first month.
      amountDueInr: priced.setupTotalInr + priced.monthlyTotalInr,
      monthlyTotalInr: priced.monthlyTotalInr,
      setupTotalInr: priced.setupTotalInr,
      contractMonths: priced.contractMonths,
      createdAt: now,
      updatedAt: now,
    })
    // The unique index on live orders settles this, because two requests with different keys can
    // both pass any check made before the insert.
    .onConflictDoNothing()
    .returning();
  if (!row) throw await orderExists(app, input.quoteId);

  await addEvent(app, id, 'ORDER_PLACED', { stage: row.stage });
  await notify(app, row, 'ORDER_PLACED');
  await recordAudit(app, {
    actorRef: session.subjectRef,
    action: 'ORDER_CREATED',
    objectType: 'order',
    objectId: id,
    requestId,
    metadata: { kycVerdict: suitable, stage: row.stage },
  });
  app.logger.info('order.created', { requestId, orderId: id });
  return row;
}

async function orderExists(app: AppContext, quoteId: string): Promise<ApiError> {
  const [existing] = await app.db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.quoteId, quoteId), ne(orders.status, 'CANCELLED')))
    .limit(1);
  return new ApiError(409, 'ORDER_EXISTS', 'An order already exists for this quote.', { orderId: existing?.id ?? null });
}

export async function getOrder(app: AppContext, ownerId: string, id: string): Promise<OrderView> {
  const catalogue = await app.catalogue();
  return toOrderView(app, catalogue, await loadOwnedOrder(app, ownerId, id));
}

export async function pageOrders(app: AppContext, ownerId: string, page: PageQuery): Promise<Page<OrderView>> {
  const catalogue = await app.catalogue();
  const rows = await app.db
    .select()
    .from(orders)
    .where(and(eq(orders.ownerId, ownerId), page.cursor ? gt(orders.id, page.cursor) : undefined))
    .orderBy(asc(orders.id))
    .limit(page.limit + 1);
  const views = new Map(await Promise.all(rows.map(async (row) => [row.id, await toOrderView(app, catalogue, row)] as const)));
  return toPage(rows, page.limit, (row) => row.id, (row) => views.get(row.id) as OrderView);
}

const PAYMENT_REFUSALS = {
  NOT_ACTIVE: new ApiError(409, 'ORDER_NOT_ACTIVE', 'This order is no longer active.'),
  KYC_NOT_CONFIRMED: new ApiError(409, 'KYC_NOT_CONFIRMED', 'We are still checking your documents. You can pay once that is done.'),
  ALREADY_PAID: new ApiError(409, 'ALREADY_PAID', 'This order has already been paid.'),
} as const;

/** A labelled mock: the caller says how it should go, and no card data exists to send. */
export async function attemptPayment(
  app: AppContext,
  session: SessionInfo,
  id: string,
  simulate: 'SUCCESS' | 'FAILURE',
  requestId: string,
): Promise<OrderView> {
  const catalogue = await app.catalogue();
  const row = await loadOwnedOrder(app, session.ownerId, id);
  const state = stateOf(row);

  const allowed = canPay(state);
  if (!allowed.ok) throw PAYMENT_REFUSALS[allowed.reason];

  const now = app.clock.now().toISOString();
  const outcome: PaymentOutcome = simulate === 'SUCCESS' ? 'SUCCESS' : 'FAILED';
  await app.db.insert(paymentAttempts).values({
    id: newPublicId('pay'),
    orderId: id,
    outcome,
    amountInr: row.amountDueInr,
    createdAt: now,
    updatedAt: now,
  });

  const changes: Partial<OrderRow> =
    outcome === 'SUCCESS'
      ? { paymentStatus: 'PAID', stage: 'PAYMENT_CONFIRMED', updatedAt: now }
      : { paymentStatus: 'FAILED', updatedAt: now };
  await app.db.update(orders).set(changes).where(eq(orders.id, id));

  await addEvent(app, id, outcome === 'SUCCESS' ? 'PAYMENT_CONFIRMED' : 'PAYMENT_FAILED');
  await notify(app, row, outcome === 'SUCCESS' ? 'PAYMENT_CONFIRMED' : 'PAYMENT_FAILED');
  await recordAudit(app, {
    actorRef: session.subjectRef,
    action: 'PAYMENT_ATTEMPTED',
    objectType: 'order',
    objectId: id,
    requestId,
    metadata: { outcome, mock: true },
  });
  return toOrderView(app, catalogue, await loadOwnedOrder(app, session.ownerId, id));
}

const ADVANCE_REFUSALS = {
  NOT_ACTIVE: new ApiError(409, 'ORDER_NOT_ACTIVE', 'This order is no longer active.'),
  PAYMENT_REQUIRED: new ApiError(409, 'PAYMENT_REQUIRED', 'This order has not been paid yet.'),
  ALREADY_ACTIVATED: new ApiError(409, 'ALREADY_ACTIVATED', 'This order is already active.'),
} as const;

/** Admin only: nothing real moves an order forward in the prototype, so each step is labelled a simulation. */
export async function advanceOrderStage(app: AppContext, id: string, requestId: string): Promise<SimulatedOrderView> {
  const catalogue = await app.catalogue();
  const row = await loadAnyOrder(app, id);
  const result = advanceStage(stateOf(row));
  if (!result.ok) throw ADVANCE_REFUSALS[result.reason];

  const now = app.clock.now().toISOString();
  await app.db
    .update(orders)
    .set({ stage: result.stage, updatedAt: now, ...(result.stage === 'ACTIVATED' ? { activatedAt: now } : {}) })
    .where(eq(orders.id, id));

  await addEvent(app, id, 'STAGE_ADVANCED', { stage: result.stage, simulated: true });
  await notify(app, row, 'ORDER_STAGE_CHANGED', { stage: result.stage });
  await recordAudit(app, {
    actorRef: 'admin',
    action: 'ORDER_STAGE_ADVANCED',
    objectType: 'order',
    objectId: id,
    requestId,
    metadata: { stage: result.stage, simulated: true },
  });
  return { ...(await toOrderView(app, catalogue, await loadAnyOrder(app, id))), simulated: true };
}

const DELAY_REFUSALS = {
  NOT_ACTIVE: new ApiError(409, 'ORDER_NOT_ACTIVE', 'This order is no longer active.'),
  ALREADY_ACTIVATED: new ApiError(409, 'ALREADY_ACTIVATED', 'This order is already active.'),
  NOT_LATER: new ApiError(422, 'DELAY_NOT_LATER', 'A delay must move the date later than currently expected.'),
} as const;

export async function markOrderDelay(
  app: AppContext,
  id: string,
  input: { reason: DelayReason; newDate: string },
  requestId: string,
): Promise<SimulatedOrderView> {
  const catalogue = await app.catalogue();
  const row = await loadAnyOrder(app, id);
  const result = applyDelay(stateOf(row), input);
  if (!result.ok) throw DELAY_REFUSALS[result.reason];

  const now = app.clock.now().toISOString();
  await app.db.update(orders).set({ delay: JSON.stringify(result.delay), updatedAt: now }).where(eq(orders.id, id));

  await addEvent(app, id, 'DELAY_MARKED', { reasonCode: input.reason, newDate: input.newDate, simulated: true });
  await notify(app, row, 'ORDER_DELAYED', { reason: input.reason, newDate: input.newDate });
  await recordAudit(app, {
    actorRef: 'admin',
    action: 'ORDER_DELAY_MARKED',
    objectType: 'order',
    objectId: id,
    requestId,
    metadata: { reason: input.reason, newDate: input.newDate, simulated: true },
  });
  return { ...(await toOrderView(app, catalogue, await loadAnyOrder(app, id))), simulated: true };
}
