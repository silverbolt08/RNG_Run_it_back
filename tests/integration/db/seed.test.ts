import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixedClock } from '@/lib/clock';
import { seedFromDataPack } from '@/server/db/seed';
import { DATA_DIR } from '../../helpers/data-pack';
import { createTestDatabase, type TestDatabase } from '../../helpers/test-db';

const clock = createFixedClock({ today: '2026-07-15', now: '2026-11-04T10:00:00.000Z' });

describe.skipIf(!existsSync(path.join(DATA_DIR, 'product_catalogue.csv')))('seeding from the data pack', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(() => database.dispose());

  const count = async (table: string) => {
    const result = await database.client.execute(`SELECT COUNT(*) AS total FROM ${table}`);
    return Number(result.rows[0]?.total);
  };

  it('imports every row, and running it again changes nothing', async () => {
    const first = await seedFromDataPack(database.db, clock, DATA_DIR);
    expect(first).toEqual({ products: 25, leads: 5000, gstRegistry: 3534, udyamRegistry: 2723 });
    expect(await count('products')).toBe(25);
    expect(await count('leads')).toBe(5000);
    expect(await count('gst_registry')).toBe(3534);
    expect(await count('udyam_registry')).toBe(2723);

    await seedFromDataPack(database.db, clock, DATA_DIR);
    expect(await count('products')).toBe(25);
    expect(await count('leads')).toBe(5000);
    expect(await count('gst_registry')).toBe(3534);
    expect(await count('udyam_registry')).toBe(2723);
  }, 60_000);

  it('keeps the registry status counts', async () => {
    const result = await database.client.execute(`SELECT status, COUNT(*) AS total FROM gst_registry GROUP BY status`);
    const totals = Object.fromEntries(result.rows.map((row) => [String(row.status), Number(row.total)]));
    expect(totals).toEqual({ Active: 3266, Cancelled: 167, Suspended: 101 });
  });

  it('stores a lead with no GSTIN as null, not an empty string', async () => {
    const result = await database.client.execute(`SELECT COUNT(*) AS total FROM leads WHERE gstin IS NULL`);
    expect(Number(result.rows[0]?.total)).toBe(1466);
  });

  it('leaves out the lead columns no server flow reads', async () => {
    const result = await database.client.execute(`PRAGMA table_info(leads)`);
    const columns = result.rows.map((row) => String(row.name));
    for (const column of ['monthly_telecom_spend_inr', 'nps_score', 'acquisition_cost_inr', 'churned_within_6_months']) {
      expect(columns).not.toContain(column);
    }
  });

  it('holds the catalogue in a form the domain can load unchanged', async () => {
    const { loadCatalogue } = await import('@/server/db/repositories/catalogue-repository');
    const catalogue = await loadCatalogue(database.db);
    expect(catalogue.products).toHaveLength(25);
    expect(catalogue.byId.get('P09')?.requiresOneOf).toEqual(['P01', 'P02', 'P03', 'P05', 'P06']);
    expect(catalogue.byId.get('P03')?.cityTiers).toEqual([1]);
    expect(catalogue.byId.get('P15')?.requiresGstin).toBe(true);
  });
});
