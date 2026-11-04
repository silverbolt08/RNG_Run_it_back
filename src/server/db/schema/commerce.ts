import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { timestamps } from './columns';
import {
  CONVERSATION_STATUSES,
  enumCheck,
  GSTIN_STATUSES,
  IDEMPOTENCY_SCOPES,
  ORDER_EVENT_TYPES,
  ORDER_STAGES,
  ORDER_STATUSES,
  PAYMENT_OUTCOMES,
  PAYMENT_STATUSES,
  QUOTE_STATUSES,
  SIMULATION_FLAGS,
} from './enums';
import { owners } from './identity';
import { kycApplications } from './kyc';
import { products } from './reference';

/** Advisor chats, for Phase 4. Identifiers are redacted before anything is stored here. */
export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => owners.id),
    status: text('status').notNull(),
    language: text('language').notNull(),
    redactedMessages: text('redacted_messages'),
    /** JSON of the domain's AdvisorFacts: business facts only, with no names or identifiers. */
    facts: text('facts'),
    /** Why the advisor handed over to a person, as a code, so the back office can word it. */
    handoffReason: text('handoff_reason'),
    ...timestamps(),
  },
  (table) => [enumCheck('conversations_status_check', table.status, CONVERSATION_STATUSES)],
);

export const quotes = sqliteTable(
  'quotes',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => owners.id),
    status: text('status').notNull(),
    revision: integer('revision').notNull(),
    // The facts the rules read. Business facts only, with no names or identifiers.
    cityTier: integer('city_tier'),
    employeeCount: integer('employee_count'),
    numSites: integer('num_sites'),
    gstinStatus: text('gstin_status').notNull(),
    fibreAvailable: integer('fibre_available'),
    monthlyTotalInr: integer('monthly_total_inr').notNull(),
    setupTotalInr: integer('setup_total_inr').notNull(),
    contractMonths: integer('contract_months').notNull(),
    installDays: integer('install_days').notNull(),
    savedAt: text('saved_at'),
    acceptedAt: text('accepted_at'),
    ...timestamps(),
  },
  (table) => [
    index('quotes_owner_index').on(table.ownerId, table.id),
    enumCheck('quotes_status_check', table.status, QUOTE_STATUSES),
    enumCheck('quotes_gstin_status_check', table.gstinStatus, GSTIN_STATUSES),
    check('quotes_fibre_check', sql`${table.fibreAvailable} IS NULL OR ${table.fibreAvailable} IN (0, 1)`),
    check('quotes_money_check', sql`${table.monthlyTotalInr} >= 0 AND ${table.setupTotalInr} >= 0`),
  ],
);

export const quoteLines = sqliteTable(
  'quote_lines',
  {
    id: text('id').primaryKey(),
    quoteId: text('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    quantity: integer('quantity').notNull(),
    unitPriceInr: integer('unit_price_inr').notNull(),
    monthlyInr: integer('monthly_inr').notNull(),
    setupInr: integer('setup_inr').notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('quote_lines_quote_product_unique').on(table.quoteId, table.productId),
    check('quote_lines_quantity_check', sql`${table.quantity} >= 1`),
  ],
);

export const orders = sqliteTable(
  'orders',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => owners.id),
    quoteId: text('quote_id')
      .notNull()
      .references(() => quotes.id),
    // An operational link, so the tracker knows which verdict the order rests on. Nothing in
    // analytics or marketing reads through it.
    kycApplicationId: text('kyc_application_id')
      .notNull()
      .references(() => kycApplications.id),
    status: text('status').notNull(),
    stage: text('stage').notNull(),
    /** The business date the order was placed, which expected dates count from. */
    placedOn: text('placed_on').notNull(),
    /** JSON of the domain's OrderPlan, fixed when the order is placed. */
    plan: text('plan').notNull(),
    /** JSON of the domain's OrderDelay, or null. */
    delay: text('delay'),
    paymentStatus: text('payment_status').notNull(),
    amountDueInr: integer('amount_due_inr').notNull(),
    monthlyTotalInr: integer('monthly_total_inr').notNull(),
    setupTotalInr: integer('setup_total_inr').notNull(),
    contractMonths: integer('contract_months').notNull(),
    activatedAt: text('activated_at'),
    ...timestamps(),
  },
  (table) => [
    index('orders_owner_index').on(table.ownerId, table.id),
    // A cancelled order frees its quote, so an owner who withdrew consent can come back.
    uniqueIndex('orders_live_quote_unique').on(table.quoteId).where(sql`${table.status} <> 'CANCELLED'`),
    enumCheck('orders_status_check', table.status, ORDER_STATUSES),
    enumCheck('orders_stage_check', table.stage, ORDER_STAGES),
    enumCheck('orders_payment_status_check', table.paymentStatus, PAYMENT_STATUSES),
  ],
);

export const orderEvents = sqliteTable(
  'order_events',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    stage: text('stage'),
    reasonCode: text('reason_code'),
    newDate: text('new_date'),
    /** The business date, matching the dates the tracker shows. */
    occurredOn: text('occurred_on').notNull(),
    /** True when an admin control caused this, so a screen can label it a simulation. */
    simulated: integer('simulated').notNull(),
    ...timestamps(),
  },
  (table) => [
    index('order_events_order_index').on(table.orderId),
    enumCheck('order_events_type_check', table.type, ORDER_EVENT_TYPES),
    check('order_events_simulated_check', sql`${table.simulated} IN (0, 1)`),
  ],
);

/** Added for the mock checkout. Records only the outcome, because no card data is ever collected. */
export const paymentAttempts = sqliteTable(
  'payment_attempts',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    outcome: text('outcome').notNull(),
    amountInr: integer('amount_inr').notNull(),
    ...timestamps(),
  },
  (table) => [
    index('payment_attempts_order_index').on(table.orderId),
    enumCheck('payment_attempts_outcome_check', table.outcome, PAYMENT_OUTCOMES),
  ],
);

/**
 * Added for the mock status messages. Holds a template code and order facts rather than a
 * rendered message, so no personal data is stored and each language can word it.
 */
export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => owners.id),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    templateCode: text('template_code').notNull(),
    params: text('params').notNull(),
    ...timestamps(),
  },
  (table) => [index('notifications_order_index').on(table.orderId)],
);

/**
 * Added for repeat requests. Reserving the key before the work starts means a retry after a
 * network drop can't store a document or place an order twice.
 */
export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => owners.id),
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    /** A hash of the request, so a reused key with different content is refused. */
    requestHash: text('request_hash').notNull(),
    /** Null while the first request is still running. */
    resourceId: text('resource_id'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('idempotency_keys_unique').on(table.ownerId, table.scope, table.key),
    enumCheck('idempotency_keys_scope_check', table.scope, IDEMPOTENCY_SCOPES),
  ],
);

/**
 * Added for the outage demo. Held in the database rather than memory, because Next.js can load
 * route handlers in separate module instances, and every one of them must see the same switch.
 */
export const simulationFlags = sqliteTable(
  'simulation_flags',
  {
    id: text('id').primaryKey(),
    enabled: integer('enabled').notNull(),
    ...timestamps(),
  },
  (table) => [
    enumCheck('simulation_flags_id_check', table.id, SIMULATION_FLAGS),
    check('simulation_flags_enabled_check', sql`${table.enabled} IN (0, 1)`),
  ],
);
