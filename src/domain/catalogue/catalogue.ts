import { z } from 'zod';

export const SEGMENT_CODES = ['micro', 'prof', 'multi', 'mfg'] as const;
export type SegmentCode = (typeof SEGMENT_CODES)[number];

const PRODUCT_UNITS = [
  'per site',
  'per line',
  'per IP',
  'per channel',
  'per number',
  'per pack',
  'per account',
  'per user',
  'per counter',
  'per device',
  'per camera',
  'per vehicle',
] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export type Product = {
  id: string;
  category: string;
  name: string;
  description: string;
  unit: ProductUnit;
  priceMinInr: number;
  priceMaxInr: number;
  setupInr: number;
  minContractMonths: number;
  cityTiers: number[];
  minEmployees: number;
  minSites: number;
  requiresGstin: boolean;
  requiresOneOf: string[];
  installDays: number;
  targetSegments: SegmentCode[];
};

export type Catalogue = {
  products: readonly Product[];
  byId: ReadonlyMap<string, Product>;
};

const wholeNumber = z.string().regex(/^\d+$/).transform(Number);

const rowSchema = z.object({
  product_id: z.string().regex(/^P\d{2}$/),
  category: z.string().min(1),
  product_name: z.string().min(1),
  description: z.string().min(1),
  unit: z.enum(PRODUCT_UNITS),
  price_min_inr_per_month: wholeNumber,
  price_max_inr_per_month: wholeNumber,
  one_time_setup_inr: wholeNumber,
  min_contract_months: wholeNumber,
  available_city_tiers: z
    .string()
    .regex(/^\d+(;\d+)*$/)
    .transform((value) => value.split(';').map(Number)),
  min_employees: wholeNumber,
  min_sites: wholeNumber,
  requires_gstin: z.enum(['Y', 'N']).transform((value) => value === 'Y'),
  requires_one_of: z.string().transform((value) => (value === '' ? [] : value.split('|'))),
  typical_install_days: wholeNumber,
  target_segments: z.string().transform((value, context) => {
    const parsed = z.array(z.enum(SEGMENT_CODES)).safeParse(value.split(';'));
    if (parsed.success) return parsed.data;
    context.addIssue({ code: 'custom', message: `Unknown segment in "${value}"` });
    return z.NEVER;
  }),
});

export function parseCatalogue(rows: ReadonlyArray<Record<string, string>>): Catalogue {
  const products = rows.map(toProduct);

  const byId = new Map<string, Product>();
  for (const product of products) {
    if (byId.has(product.id)) throw new Error(`Duplicate product ${product.id} in the catalogue`);
    byId.set(product.id, product);
  }

  for (const product of products) {
    for (const base of product.requiresOneOf) {
      if (!byId.has(base)) throw new Error(`${product.id} depends on ${base}, which is not in the catalogue`);
    }
  }
  return { products, byId };
}

export function getProduct(catalogue: Catalogue, productId: string): Product {
  const product = catalogue.byId.get(productId);
  if (!product) throw new Error(`Unknown product ${productId}`);
  return product;
}

function toProduct(row: Record<string, string>): Product {
  const parsed = rowSchema.parse(row);
  if (parsed.price_min_inr_per_month > parsed.price_max_inr_per_month) {
    throw new Error(`${parsed.product_id} has a minimum price above its maximum`);
  }
  return {
    id: parsed.product_id,
    category: parsed.category,
    name: parsed.product_name,
    description: parsed.description,
    unit: parsed.unit,
    priceMinInr: parsed.price_min_inr_per_month,
    priceMaxInr: parsed.price_max_inr_per_month,
    setupInr: parsed.one_time_setup_inr,
    minContractMonths: parsed.min_contract_months,
    cityTiers: parsed.available_city_tiers,
    minEmployees: parsed.min_employees,
    minSites: parsed.min_sites,
    requiresGstin: parsed.requires_gstin,
    requiresOneOf: parsed.requires_one_of,
    installDays: parsed.typical_install_days,
    targetSegments: parsed.target_segments,
  };
}
