import { asc, eq, sql } from 'drizzle-orm';
import { getProduct, type Catalogue } from '../../domain/catalogue/catalogue';
import {
  buildTracker,
  type OrderDelay,
  type OrderPlan,
  type OrderStage,
  type OrderState,
  type OrderStatus,
  type PaymentStatus,
  type Tracker,
} from '../../domain/orders/orders';
import type { LoggedMessage } from '../adapters/notifications/notification-log';
import type { AppContext } from '../app-context';
import { orderEvents, orders, paymentAttempts } from '../db/schema';
import type { OrderEventType, PaymentOutcome } from '../db/schema/enums';
import { namesOf } from './quote-view';

export type OrderRow = typeof orders.$inferSelect;
type EventRow = typeof orderEvents.$inferSelect;

export type OrderView = Omit<Tracker, 'products'> & {
  id: string;
  quoteId: string;
  kycApplicationId: string;
  priceBasis: 'EXCL_GST';
  monthlyTotalInr: number;
  setupTotalInr: number;
  contractMonths: number;
  products: Array<Tracker['products'][number] & { name: string; description: string; unit: string }>;
  /** The review a manual-review verdict needs before the order can move on. */
  kycUnderReview: boolean;
  payment: {
    status: PaymentStatus;
    amountDueInr: number;
    /** Prototype only: no card data is collected, and no money moves. */
    mock: true;
    attempts: Array<{ outcome: PaymentOutcome; amountInr: number; attemptedAt: string }>;
  };
  statusMessages: LoggedMessage[];
  events: Array<{
    type: OrderEventType;
    stage: string | null;
    reasonCode: string | null;
    newDate: string | null;
    occurredOn: string;
    simulated: boolean;
    recordedAt: string;
  }>;
  activatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SimulatedOrderView = OrderView & { simulated: true };

export function stateOf(row: OrderRow): OrderState {
  return {
    placedOn: row.placedOn,
    status: row.status as OrderStatus,
    stage: row.stage as OrderStage,
    paymentStatus: row.paymentStatus as PaymentStatus,
    plan: JSON.parse(row.plan) as OrderPlan,
    delay: row.delay ? (JSON.parse(row.delay) as OrderDelay) : null,
  };
}

export async function toOrderView(app: AppContext, catalogue: Catalogue, row: OrderRow): Promise<OrderView> {
  const tracker = buildTracker(stateOf(row));
  const attempts = await app.db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.orderId, row.id))
    .orderBy(asc(paymentAttempts.createdAt));
  const events = await listEvents(app, row.id);

  return {
    ...tracker,
    id: row.id,
    quoteId: row.quoteId,
    kycApplicationId: row.kycApplicationId,
    priceBasis: 'EXCL_GST',
    monthlyTotalInr: row.monthlyTotalInr,
    setupTotalInr: row.setupTotalInr,
    contractMonths: row.contractMonths,
    products: tracker.products.map((product) => ({ ...product, ...namesOf(getProduct(catalogue, product.productId)) })),
    kycUnderReview: row.status === 'ACTIVE' && row.stage === 'ORDER_PLACED',
    payment: {
      status: row.paymentStatus as PaymentStatus,
      amountDueInr: row.amountDueInr,
      mock: true,
      attempts: attempts.map((attempt) => ({
        outcome: attempt.outcome as PaymentOutcome,
        amountInr: attempt.amountInr,
        attemptedAt: attempt.createdAt,
      })),
    },
    statusMessages: await app.notifications.listForOrder(row.id),
    events: events.map((event) => ({
      type: event.type as OrderEventType,
      stage: event.stage,
      reasonCode: event.reasonCode,
      newDate: event.newDate,
      occurredOn: event.occurredOn,
      simulated: event.simulated === 1,
      recordedAt: event.createdAt,
    })),
    activatedAt: row.activatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function listEvents(app: AppContext, orderId: string): Promise<EventRow[]> {
  return app.db
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderId))
    // By insertion order, since events in one request share a timestamp.
    .orderBy(asc(sql`rowid`));
}

