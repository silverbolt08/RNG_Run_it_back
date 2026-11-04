import { asc } from 'drizzle-orm';
import { parseCatalogue, type Catalogue } from '../../../domain/catalogue/catalogue';
import type { Database } from '../client';
import { products } from '../schema';

/**
 * Rebuilds the CSV's row shape from the table, so `parseCatalogue` stays the only code that
 * interprets catalogue rules, whether they arrive from the file or from here.
 */
export async function loadCatalogue(db: Database): Promise<Catalogue> {
  const rows = await db.select().from(products).orderBy(asc(products.id));
  return parseCatalogue(
    rows.map((row) => ({
      product_id: row.id,
      category: row.category,
      product_name: row.name,
      description: row.description,
      unit: row.unit,
      price_min_inr_per_month: String(row.priceMinInr),
      price_max_inr_per_month: String(row.priceMaxInr),
      one_time_setup_inr: String(row.setupInr),
      min_contract_months: String(row.minContractMonths),
      available_city_tiers: row.cityTiers,
      min_employees: String(row.minEmployees),
      min_sites: String(row.minSites),
      requires_gstin: row.requiresGstin === 1 ? 'Y' : 'N',
      requires_one_of: row.requiresOneOf,
      typical_install_days: String(row.installDays),
      target_segments: row.targetSegments,
    })),
  );
}
