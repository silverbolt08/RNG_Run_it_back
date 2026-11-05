import { getProduct, type Catalogue, type Product, type ProductUnit } from '../catalogue/catalogue';

/**
 * Where a unit price sits within its catalogue range, from 0 (minimum) to 1 (maximum).
 *
 * Assumption: the brief wants one clear price but the catalogue gives ranges. Historic prices
 * show no pattern by tier, segment or volume and average about 48% of the range, so we use
 * the midpoint. Change it here and every quote follows.
 */
export const PRICE_POSITION = 0.5;

/**
 * The team wants owners to see the final price. Assumptions: catalogue prices exclude GST, since
 * the catalogue doesn't state tax treatment, and telecom services carry the usual 18%. Change it
 * here and every quote follows.
 */
export const GST_RATE_PERCENT = 18;

/** The most one line can hold, which is also what the API accepts. */
export const MAX_LINE_QUANTITY = 1000;

export type BundleLine = { productId: string; quantity: number };

export type QuoteLine = BundleLine & {
  unitPriceInr: number;
  monthlyInr: number;
  setupInr: number;
};

export type Quote = {
  lines: QuoteLine[];
  /** Before GST. The owner sees monthlyFinalInr. */
  monthlyTotalInr: number;
  monthlyGstInr: number;
  monthlyFinalInr: number;
  /** Before GST. The owner sees setupFinalInr. */
  setupTotalInr: number;
  setupGstInr: number;
  setupFinalInr: number;
  contractMonths: number;
  installDays: number;
};

export type QuoteComparison = {
  monthlyDeltaInr: number;
  monthlyFinalDeltaInr: number;
  setupDeltaInr: number;
  setupFinalDeltaInr: number;
  contractMonthsBefore: number;
  contractMonthsAfter: number;
  contractChanged: boolean;
  installDaysBefore: number;
  installDaysAfter: number;
  installChanged: boolean;
};

export type UnitCounts = Partial<
  Record<'lines' | 'users' | 'devices' | 'cameras' | 'counters' | 'vehicles' | 'channels' | 'machines', number>
>;

export type BusinessSize = { employeeCount: number | null; numSites: number | null };

const MACHINE_MONITORING_ID = 'P24';

// Historic medians for units the owner hasn't counted, from the msme-advisor skill.
const DEFAULT_LINES = 2;
const DEFAULT_USERS = 8;
const DEFAULT_DEVICES = 7;
const DEFAULT_CAMERAS = 4;
const DEFAULT_COUNTERS = 3;
const DEFAULT_VEHICLES = 5;
const DEFAULT_CHANNELS = 3;

export function unitPriceInr(product: Product): number {
  return Math.round(product.priceMinInr + (product.priceMaxInr - product.priceMinInr) * PRICE_POSITION);
}

/** GST on an amount before tax, in whole rupees. */
export function gstOnInr(amountInr: number): number {
  return Math.round((amountInr * GST_RATE_PERCENT) / 100);
}

export function priceBundle(catalogue: Catalogue, bundle: readonly BundleLine[]): Quote {
  const seen = new Set<string>();
  const lines = bundle.map((line) => {
    if (seen.has(line.productId)) throw new Error(`${line.productId} appears twice in the bundle`);
    seen.add(line.productId);
    return toQuoteLine(catalogue, line);
  });

  const products = bundle.map((line) => getProduct(catalogue, line.productId));
  const monthlyTotalInr = sum(lines.map((line) => line.monthlyInr));
  const setupTotalInr = sum(lines.map((line) => line.setupInr));
  const monthlyGstInr = gstOnInr(monthlyTotalInr);
  const setupGstInr = gstOnInr(setupTotalInr);
  return {
    lines,
    monthlyTotalInr,
    monthlyGstInr,
    monthlyFinalInr: monthlyTotalInr + monthlyGstInr,
    setupTotalInr,
    setupGstInr,
    setupFinalInr: setupTotalInr + setupGstInr,
    contractMonths: Math.max(0, ...products.map((product) => product.minContractMonths)),
    installDays: Math.max(0, ...products.map((product) => product.installDays)),
  };
}

/** Says what a change did, so the screen can show a contract jump as well as the new price. */
export function compareQuotes(before: Quote, after: Quote): QuoteComparison {
  return {
    monthlyDeltaInr: after.monthlyTotalInr - before.monthlyTotalInr,
    monthlyFinalDeltaInr: after.monthlyFinalInr - before.monthlyFinalInr,
    setupDeltaInr: after.setupTotalInr - before.setupTotalInr,
    setupFinalDeltaInr: after.setupFinalInr - before.setupFinalInr,
    contractMonthsBefore: before.contractMonths,
    contractMonthsAfter: after.contractMonths,
    contractChanged: before.contractMonths !== after.contractMonths,
    installDaysBefore: before.installDays,
    installDaysAfter: after.installDays,
    installChanged: before.installDays !== after.installDays,
  };
}

/** A starting quantity the owner can always edit. */
export function defaultQuantity(product: Product, size: BusinessSize, counts: UnitCounts = {}): number {
  const quantity = product.id === MACHINE_MONITORING_ID && counts.machines !== undefined ? counts.machines : quantityForUnit(product.unit, size, counts);
  return Math.min(MAX_LINE_QUANTITY, Math.max(1, quantity));
}

function quantityForUnit(unit: ProductUnit, size: BusinessSize, counts: UnitCounts): number {
  switch (unit) {
    case 'per site':
      return size.numSites ?? 1;
    case 'per line':
      return counts.lines ?? cappedByPeople(DEFAULT_LINES, size);
    case 'per user':
      return counts.users ?? cappedByPeople(DEFAULT_USERS, size);
    case 'per device':
      return counts.devices ?? DEFAULT_DEVICES;
    case 'per camera':
      return counts.cameras ?? DEFAULT_CAMERAS;
    case 'per counter':
      return counts.counters ?? DEFAULT_COUNTERS;
    case 'per vehicle':
      return counts.vehicles ?? DEFAULT_VEHICLES;
    case 'per channel':
      return counts.channels ?? DEFAULT_CHANNELS;
    case 'per IP':
    case 'per number':
    case 'per pack':
    case 'per account':
      return 1;
  }
}

// A default of 8 email users would overcharge a 3-person shop.
function cappedByPeople(quantity: number, size: BusinessSize): number {
  return size.employeeCount === null ? quantity : Math.min(quantity, Math.max(size.employeeCount, 1));
}

function toQuoteLine(catalogue: Catalogue, line: BundleLine): QuoteLine {
  if (!Number.isInteger(line.quantity) || line.quantity < 1) {
    throw new RangeError(`Quantity for ${line.productId} must be a whole number of at least 1`);
  }
  const product = getProduct(catalogue, line.productId);
  const unit = unitPriceInr(product);
  return {
    productId: line.productId,
    quantity: line.quantity,
    unitPriceInr: unit,
    monthlyInr: unit * line.quantity,
    setupInr: product.setupInr * line.quantity,
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
