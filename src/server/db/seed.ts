import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getTableColumns, sql, type InferInsertModel } from 'drizzle-orm';
import type { SQLiteTable, SQLiteUpdateSetSource } from 'drizzle-orm/sqlite-core';
import type { Clock } from '../../lib/clock';
import { parseCsv } from '../../lib/csv';
import type { Database } from './client';
import { gstRegistry, leads, products, udyamRegistry } from './schema';

// SQLite allows 32,766 bound values, and the widest table here has 21 columns.
const BATCH_SIZE = 500;

export type SeedCounts = { products: number; leads: number; gstRegistry: number; udyamRegistry: number };

/** Idempotent: a second run updates the same rows rather than adding new ones. */
export async function seedFromDataPack(db: Database, clock: Clock, dataDir: string): Promise<SeedCounts> {
  const now = clock.now().toISOString();
  const read = (name: string) => parseCsv(readFileSync(path.join(dataDir, name), 'utf8'));
  const stamps = { createdAt: now, updatedAt: now };

  const productRows = read('product_catalogue.csv').map((row) => toProduct(row, stamps));
  const leadRows = read('smb_leads.csv').map((row) => toLead(row, stamps));
  const gstRows = read('mock_gstin_registry.csv').map((row) => toGst(row, stamps));
  const udyamRows = read('mock_udyam_registry.csv').map((row) => toUdyam(row, stamps));

  await upsertAll(db, products, productRows);
  await upsertAll(db, leads, leadRows);
  await upsertAll(db, gstRegistry, gstRows);
  await upsertAll(db, udyamRegistry, udyamRows);

  return {
    products: productRows.length,
    leads: leadRows.length,
    gstRegistry: gstRows.length,
    udyamRegistry: udyamRows.length,
  };
}

/** The catalogue alone, for tests that have a copy of it but not the whole data pack. */
export async function seedProducts(db: Database, clock: Clock, rows: ReadonlyArray<Record<string, string>>): Promise<void> {
  const now = clock.now().toISOString();
  await upsertAll(db, products, rows.map((row) => toProduct(row, { createdAt: now, updatedAt: now })));
}

type Stamps = { createdAt: string; updatedAt: string };

function field(row: Record<string, string>, name: string): string {
  const value = row[name];
  if (value === undefined) throw new Error(`The data pack has no column named ${name}`);
  return value;
}

function wholeNumber(row: Record<string, string>, name: string): number {
  const value = Number(field(row, name));
  if (!Number.isInteger(value)) throw new Error(`Column ${name} holds a value that is not a whole number`);
  return value;
}

function toProduct(row: Record<string, string>, stamps: Stamps): InferInsertModel<typeof products> {
  return {
    id: field(row, 'product_id'),
    category: field(row, 'category'),
    name: field(row, 'product_name'),
    description: field(row, 'description'),
    unit: field(row, 'unit'),
    priceMinInr: wholeNumber(row, 'price_min_inr_per_month'),
    priceMaxInr: wholeNumber(row, 'price_max_inr_per_month'),
    setupInr: wholeNumber(row, 'one_time_setup_inr'),
    minContractMonths: wholeNumber(row, 'min_contract_months'),
    cityTiers: field(row, 'available_city_tiers'),
    minEmployees: wholeNumber(row, 'min_employees'),
    minSites: wholeNumber(row, 'min_sites'),
    requiresGstin: field(row, 'requires_gstin') === 'Y' ? 1 : 0,
    requiresOneOf: field(row, 'requires_one_of'),
    installDays: wholeNumber(row, 'typical_install_days'),
    targetSegments: field(row, 'target_segments'),
    ...stamps,
  };
}

function toLead(row: Record<string, string>, stamps: Stamps): InferInsertModel<typeof leads> {
  return {
    id: field(row, 'lead_id'),
    createdDate: field(row, 'created_date'),
    leadSource: field(row, 'lead_source'),
    businessName: field(row, 'business_name'),
    businessType: field(row, 'business_type'),
    segment: field(row, 'segment'),
    city: field(row, 'city'),
    cityTier: wholeNumber(row, 'city_tier'),
    state: field(row, 'state'),
    preferredLanguage: field(row, 'preferred_language'),
    employeeCount: wholeNumber(row, 'employee_count'),
    numSites: wholeNumber(row, 'num_sites'),
    // A blank means no number. Only these two become null, so the literal "None" elsewhere stays a value.
    gstin: field(row, 'gstin') || null,
    udyamNumber: field(row, 'udyam_number') || null,
    contactName: field(row, 'contact_name'),
    contactRole: field(row, 'contact_role'),
    stageReached: field(row, 'stage_reached'),
    outcome: field(row, 'outcome'),
    dropReason: field(row, 'drop_reason'),
    ...stamps,
  };
}

function toGst(row: Record<string, string>, stamps: Stamps): InferInsertModel<typeof gstRegistry> {
  return {
    id: field(row, 'gstin'),
    legalName: field(row, 'legal_name'),
    tradeName: field(row, 'trade_name'),
    constitution: field(row, 'constitution'),
    principalPlaceOfBusiness: field(row, 'principal_place_of_business'),
    state: field(row, 'state'),
    registrationDate: field(row, 'registration_date'),
    status: field(row, 'status'),
    ...stamps,
  };
}

function toUdyam(row: Record<string, string>, stamps: Stamps): InferInsertModel<typeof udyamRegistry> {
  return {
    id: field(row, 'udyam_number'),
    enterpriseName: field(row, 'enterprise_name'),
    enterpriseType: field(row, 'enterprise_type'),
    majorActivity: field(row, 'major_activity'),
    nicDescription: field(row, 'nic_description'),
    state: field(row, 'state'),
    city: field(row, 'city'),
    dateOfRegistration: field(row, 'date_of_registration'),
    ...stamps,
  };
}

async function upsertAll<T extends SQLiteTable>(
  db: Database,
  table: T,
  rows: ReadonlyArray<InferInsertModel<T>>,
): Promise<void> {
  const columns = getTableColumns(table);
  // Every column follows the file on a re-run, except created_at, which keeps the first import's time.
  const update = Object.fromEntries(
    Object.entries(columns)
      .filter(([key]) => key !== 'id' && key !== 'createdAt')
      .map(([key, column]) => [key, sql.raw(`excluded."${column.name}"`)]),
  );
  const idColumn = (columns as Record<string, (typeof columns)[keyof typeof columns]>).id;
  if (!idColumn) throw new Error('A seeded table needs an id column');

  await db.transaction(async (tx) => {
    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
      const batch = rows.slice(start, start + BATCH_SIZE) as InferInsertModel<T>[];
      await tx.insert(table).values(batch).onConflictDoUpdate({
        target: idColumn,
        // Generic over the table, so the compiler can't check these column names against it.
        set: update as SQLiteUpdateSetSource<T>,
      });
    }
  });
}
