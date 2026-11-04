import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../helpers/test-db';

const TABLES = [
  'products',
  'leads',
  'gst_registry',
  'udyam_registry',
  'conversations',
  'quotes',
  'quote_lines',
  'orders',
  'order_events',
  'consents',
  'kyc_applications',
  'kyc_documents',
  'kyc_checks',
  'audit_log',
  'owners',
  'sessions',
  'otp_challenges',
  'payment_attempts',
  'notifications',
  'idempotency_keys',
  'simulation_flags',
];

const NOW = '2026-11-04T10:00:00.000Z';

describe('schema and migrations', () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createTestDatabase();
  });
  afterEach(() => database.dispose());

  const insertOwner = (id: string) =>
    database.client.execute({
      sql: `INSERT INTO owners (id, subject_ref, status, created_at, updated_at) VALUES (?, ?, 'ANONYMOUS', ?, ?)`,
      args: [id, `sub_${id}`, NOW, NOW],
    });

  const insertConsent = (id: string, purpose = 'kyc_verification', status = 'GRANTED') =>
    database.client.execute({
      sql: `INSERT INTO consents (id, subject_ref, purpose_id, notice_version, language, status, granted_at, channel, created_at, updated_at)
            VALUES (?, 'sub_a', ?, 'v1', 'en', ?, ?, 'WEB', ?, ?)`,
      args: [id, purpose, status, NOW, NOW, NOW],
    });

  const insertAudit = (id: string) =>
    database.client.execute({
      sql: `INSERT INTO audit_log (id, actor_ref, action, object_type, created_at, updated_at) VALUES (?, 'sub_a', 'CONSENT_GRANTED', 'consent', ?, ?)`,
      args: [id, NOW, NOW],
    });

  it('creates every core table', async () => {
    const result = await database.client.execute(`SELECT name FROM sqlite_master WHERE type = 'table'`);
    const names = result.rows.map((row) => row.name);
    expect(names).toEqual(expect.arrayContaining(TABLES));
  });

  it.each(TABLES)('%s has id, created_at and updated_at', async (table) => {
    const result = await database.client.execute(`PRAGMA table_info(${table})`);
    const columns = result.rows.map((row) => row.name);
    expect(columns).toEqual(expect.arrayContaining(['id', 'created_at', 'updated_at']));
  });

  it('can run the migrations twice', async () => {
    const { runMigrations } = await import('@/server/db/client');
    await expect(runMigrations(database.db)).resolves.toBeUndefined();
  });

  describe('append-only tables', () => {
    it('refuses to update a consent', async () => {
      await insertConsent('con_1');
      await expect(database.client.execute(`UPDATE consents SET status = 'WITHDRAWN'`)).rejects.toThrow(/append-only/);
    });

    it('refuses to delete a consent', async () => {
      await insertConsent('con_1');
      await expect(database.client.execute(`DELETE FROM consents`)).rejects.toThrow(/append-only/);
    });

    it('refuses to update an audit record', async () => {
      await insertAudit('aud_1');
      await expect(database.client.execute(`UPDATE audit_log SET action = 'X'`)).rejects.toThrow(/append-only/);
    });

    it('refuses to delete an audit record', async () => {
      await insertAudit('aud_1');
      await expect(database.client.execute(`DELETE FROM audit_log`)).rejects.toThrow(/append-only/);
    });
  });

  describe('enums as check constraints', () => {
    it('rejects an unknown consent purpose', async () => {
      await expect(insertConsent('con_1', 'everything')).rejects.toThrow(/CHECK/i);
    });

    it('rejects an unknown consent status', async () => {
      await expect(insertConsent('con_1', 'marketing', 'MAYBE')).rejects.toThrow(/CHECK/i);
    });

    it('accepts each real purpose', async () => {
      for (const [index, purpose] of ['advisor_profile', 'kyc_verification', 'service_updates', 'marketing'].entries()) {
        await expect(insertConsent(`con_${index}`, purpose)).resolves.toBeDefined();
      }
    });

    it('rejects an unknown quote status', async () => {
      await insertOwner('own_1');
      await expect(
        database.client.execute({
          sql: `INSERT INTO quotes (id, owner_id, status, revision, gstin_status, monthly_total_inr, setup_total_inr, contract_months, install_days, created_at, updated_at)
                VALUES ('qt_1', 'own_1', 'NEARLY', 1, 'NONE', 0, 0, 0, 0, ?, ?)`,
          args: [NOW, NOW],
        }),
      ).rejects.toThrow(/CHECK/i);
    });

    it('rejects a quote line with no quantity', async () => {
      await insertOwner('own_1');
      await database.client.execute({
        sql: `INSERT INTO quotes (id, owner_id, status, revision, gstin_status, monthly_total_inr, setup_total_inr, contract_months, install_days, created_at, updated_at)
              VALUES ('qt_1', 'own_1', 'DRAFT', 1, 'NONE', 0, 0, 0, 0, ?, ?)`,
        args: [NOW, NOW],
      });
      await database.client.execute({
        sql: `INSERT INTO products (id, category, name, description, unit, price_min_inr, price_max_inr, setup_inr, min_contract_months, city_tiers, min_employees, min_sites, requires_gstin, requires_one_of, install_days, target_segments, created_at, updated_at)
              VALUES ('P01', 'C', 'N', 'D', 'per site', 1, 2, 0, 12, '1;2', 1, 1, 0, '', 5, 'micro', ?, ?)`,
        args: [NOW, NOW],
      });
      await expect(
        database.client.execute({
          sql: `INSERT INTO quote_lines (id, quote_id, product_id, quantity, unit_price_inr, monthly_inr, setup_inr, created_at, updated_at)
                VALUES ('ql_1', 'qt_1', 'P01', 0, 1, 0, 0, ?, ?)`,
          args: [NOW, NOW],
        }),
      ).rejects.toThrow(/CHECK/i);
    });
  });

  it('enforces foreign keys', async () => {
    await expect(
      database.client.execute({
        sql: `INSERT INTO sessions (id, owner_id, token_hash, expires_at, created_at, updated_at) VALUES ('ses_1', 'own_missing', 'x', ?, ?, ?)`,
        args: [NOW, NOW, NOW],
      }),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });

  it('keeps KYC tables free of any link from marketing or analytics tables', async () => {
    for (const table of ['leads', 'consents', 'audit_log', 'conversations', 'notifications']) {
      const result = await database.client.execute(`PRAGMA foreign_key_list(${table})`);
      const targets = result.rows.map((row) => String(row.table));
      expect(targets.filter((target) => target.startsWith('kyc_'))).toEqual([]);
    }
  });
});
