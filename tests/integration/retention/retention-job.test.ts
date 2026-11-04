import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conversations, owners } from '@/server/db/schema';
import { RETENTION_POLICY } from '@/server/retention/retention-policy';
import { runRetention, startRetentionSchedule } from '@/server/retention/retention-job';
import { ApiClient, expectApiError, grant, newVisitor } from '../../helpers/api-client';
import { addLead, createTestApp, type TestApp } from '../../helpers/test-app';
import { acceptedQuote, ACTIVE_PROFILE, applicant, noGstinLines, seedRegistryFor, uploadAll } from '../../helpers/specimens';

describe('retention', () => {
  let app: TestApp;
  let owner: ApiClient;
  const admin = new ApiClient();

  beforeEach(async () => {
    app = await createTestApp();
    owner = await newVisitor();
  });
  afterEach(() => app.dispose());

  const count = async (sql: string) => {
    const result = await app.testDb.client.execute(sql);
    return Number(result.rows[0]?.total);
  };

  const storedFiles = () => {
    try {
      return readdirSync(app.documentDir);
    } catch {
      return [];
    }
  };

  const verified = async (key = 'K03') => {
    await seedRegistryFor(app, key);
    const quoteId = await acceptedQuote(owner);
    const created = await owner.post('/api/v1/kyc-applications', { quoteId, contactName: applicant(key).contactName });
    await uploadAll(app, owner, created.body.id, key);
    return { quoteId, kycApplicationId: created.body.id as string };
  };

  const activatedOrder = async () => {
    const refs = await verified();
    const placed = await owner.post('/api/v1/orders', refs, { headers: { 'idempotency-key': 'order-key-retention' } });
    const id = placed.body.id as string;
    await owner.post(`/api/v1/orders/${id}/payment-attempts`, { simulate: 'SUCCESS' });
    for (let i = 0; i < 3; i++) await admin.admin('POST', `/api/v1/admin/orders/${id}/stage-advances`);
    return { ...refs, id, contractMonths: placed.body.contractMonths as number };
  };

  it('keeps the periods in one place, matching the proposal in privacy-security', () => {
    expect(RETENTION_POLICY).toMatchObject({
      rawDocumentDaysAfterVerification: 30,
      advisorConversationDays: 90,
      abandonedLeadDays: 180,
      applicationLogDays: 30,
    });
  });

  describe('raw documents', () => {
    it('keeps them just inside 30 days after verification', async () => {
      await verified();
      app.fixedClock.advanceDays(29);
      const report = await runRetention(app);
      expect(report.rawDocumentsDeleted).toBe(0);
      expect(storedFiles()).toHaveLength(4);
    });

    it('deletes them after 30 days, keeping the extracted fields', async () => {
      await verified();
      app.fixedClock.advanceDays(31);
      const report = await runRetention(app);
      expect(report.rawDocumentsDeleted).toBe(4);
      expect(storedFiles()).toEqual([]);

      const fields = await count(`SELECT COUNT(*) AS total FROM kyc_documents WHERE sealed_fields IS NOT NULL AND storage_key IS NULL AND file_deleted_at IS NOT NULL`);
      expect(fields).toBe(4);
      expect(await count(`SELECT COUNT(*) AS total FROM kyc_applications WHERE verdict = 'VERIFIED'`)).toBe(1);
    });

    it('deletes straight away on a rejected application, whatever its age', async () => {
      const { kycApplicationId } = await verified();
      await app.testDb.client.execute({
        sql: `UPDATE kyc_applications SET verdict = 'REJECTED', verified_at = NULL WHERE id = ?`,
        args: [kycApplicationId],
      });
      const report = await runRetention(app);
      expect(report.rawDocumentsDeleted).toBe(4);
      expect(storedFiles()).toEqual([]);
    });

    it('also clears an application abandoned before any verdict', async () => {
      await seedRegistryFor(app, 'K03');
      const quoteId = await acceptedQuote(owner);
      const created = await owner.post('/api/v1/kyc-applications', { quoteId, contactName: 'Asha Rao' });
      const { uploadSpecimen } = await import('../../helpers/specimens');
      await uploadSpecimen(app, owner, created.body.id, 'K03', 'SIGNATORY_ID');
      expect(storedFiles()).toHaveLength(1);

      app.fixedClock.advanceDays(31);
      await runRetention(app);
      expect(storedFiles()).toEqual([]);
    });
  });

  describe('extracted KYC fields', () => {
    it('keeps them during the contract, after the raw documents have gone', async () => {
      await activatedOrder();
      app.fixedClock.advanceDays(200);
      await runRetention(app);
      expect(storedFiles()).toEqual([]);
      expect(await count(`SELECT COUNT(*) AS total FROM kyc_applications WHERE sealed_identity IS NOT NULL`)).toBe(1);
    });

    it('erases them once the contract term has ended, keeping the order', async () => {
      const { id, contractMonths } = await activatedOrder();
      app.fixedClock.advanceDays(contractMonths * 31 + 1);
      const report = await runRetention(app);
      expect(report.applicationsErased).toBe(1);
      expect(await count(`SELECT COUNT(*) AS total FROM kyc_applications WHERE sealed_identity IS NULL AND status = 'ERASED'`)).toBe(1);
      expect(await count(`SELECT COUNT(*) AS total FROM kyc_documents`)).toBe(0);
      expect(await count(`SELECT COUNT(*) AS total FROM orders WHERE id = '${id}'`)).toBe(1);
    });

    it('records the erasure in the consent history for an owner who withdrew during the contract', async () => {
      const { contractMonths } = await activatedOrder();
      await owner.post('/api/v1/consents/kyc_verification/withdrawal');

      app.fixedClock.advanceDays(contractMonths * 31 + 1);
      await runRetention(app);

      const history = await app.testDb.client.execute(
        `SELECT status FROM consents WHERE purpose_id = 'kyc_verification' ORDER BY rowid`,
      );
      expect(history.rows.map((row) => row.status)).toEqual(['GRANTED', 'WITHDRAWN', 'ERASED']);
    });

    it('erases an abandoned application after 180 days', async () => {
      await verified();
      app.fixedClock.advanceDays(181);
      const report = await runRetention(app);
      expect(report.applicationsErased).toBe(1);
      expect(await count(`SELECT COUNT(*) AS total FROM kyc_applications`)).toBe(0);
      expect(await count(`SELECT COUNT(*) AS total FROM kyc_checks`)).toBe(0);
    });

    it('keeps an abandoned application just inside 180 days', async () => {
      await verified();
      app.fixedClock.advanceDays(179);
      const report = await runRetention(app);
      expect(report.applicationsErased).toBe(0);
      expect(await count(`SELECT COUNT(*) AS total FROM kyc_applications WHERE sealed_identity IS NOT NULL`)).toBe(1);
    });
  });

  describe('advisor conversations', () => {
    const addConversation = async (ownerId: string) => {
      const now = app.clock.now().toISOString();
      await app.db.insert(conversations).values({
        id: 'cnv_1',
        ownerId,
        status: 'OPEN',
        language: 'en',
        redactedMessages: '[]',
        createdAt: now,
        updatedAt: now,
      });
    };

    it('keeps them for 90 days and deletes them after', async () => {
      const [row] = await app.db.select({ id: owners.id }).from(owners).limit(1);
      await addConversation(row?.id ?? '');

      app.fixedClock.advanceDays(89);
      expect((await runRetention(app)).conversationsDeleted).toBe(0);

      app.fixedClock.advanceDays(2);
      expect((await runRetention(app)).conversationsDeleted).toBe(1);
      expect(await count('SELECT COUNT(*) AS total FROM conversations')).toBe(0);
    });
  });

  describe('abandoned leads', () => {
    const draft = async () => {
      await grant(owner, 'advisor_profile');
      return owner.post('/api/v1/quotes', { profile: ACTIVE_PROFILE, lines: noGstinLines });
    };

    it('keeps a draft quote just inside 180 days', async () => {
      await draft();
      app.fixedClock.advanceDays(179);
      expect((await runRetention(app)).abandonedQuotesDeleted).toBe(0);
      expect(await count('SELECT COUNT(*) AS total FROM quotes')).toBe(1);
    });

    it('erases a draft quote and its owner after 180 days', async () => {
      await draft();
      app.fixedClock.advanceDays(181);
      const report = await runRetention(app);
      expect(report.abandonedQuotesDeleted).toBe(1);
      expect(report.abandonedOwnersDeleted).toBe(1);
      expect(await count('SELECT COUNT(*) AS total FROM quotes')).toBe(0);
      expect(await count('SELECT COUNT(*) AS total FROM quote_lines')).toBe(0);
      expect(await count('SELECT COUNT(*) AS total FROM owners')).toBe(0);
    });

    it('never touches a quote with an order', async () => {
      await activatedOrder();
      app.fixedClock.advanceDays(181);
      const report = await runRetention(app);
      expect(report.abandonedQuotesDeleted).toBe(0);
      expect(await count('SELECT COUNT(*) AS total FROM quotes')).toBe(1);
      expect(await count('SELECT COUNT(*) AS total FROM owners')).toBeGreaterThanOrEqual(1);
    });

    it('leaves the seeded leads alone, because they are reference data, not abandoned journeys', async () => {
      await addLead(app, { id: 'L00001', gstin: null, contactName: 'A Person', businessName: 'A Business' });
      app.fixedClock.advanceDays(400);
      await runRetention(app);
      expect(await count('SELECT COUNT(*) AS total FROM leads')).toBe(1);
    });
  });

  describe('housekeeping', () => {
    it('removes long-expired sessions, OTP challenges and idempotency keys', async () => {
      await verified();
      expect(await count('SELECT COUNT(*) AS total FROM otp_challenges')).toBeGreaterThan(0);
      expect(await count('SELECT COUNT(*) AS total FROM idempotency_keys')).toBeGreaterThan(0);

      app.fixedClock.advanceDays(40);
      const report = await runRetention(app);
      expect(report.sessionsDeleted).toBeGreaterThan(0);
      expect(await count('SELECT COUNT(*) AS total FROM otp_challenges')).toBe(0);
      expect(await count('SELECT COUNT(*) AS total FROM idempotency_keys')).toBe(0);
    });

    it('keeps a live session', async () => {
      await runRetention(app);
      expect((await owner.get('/api/v1/sessions/current')).status).toBe(200);
    });
  });

  it('never deletes consent or audit records', async () => {
    await activatedOrder();
    const consentsBefore = await count('SELECT COUNT(*) AS total FROM consents');
    const auditBefore = await count('SELECT COUNT(*) AS total FROM audit_log');

    app.fixedClock.advanceDays(2000);
    await runRetention(app);

    expect(await count('SELECT COUNT(*) AS total FROM consents')).toBe(consentsBefore);
    expect(await count('SELECT COUNT(*) AS total FROM audit_log')).toBeGreaterThan(auditBefore);
  });

  it('is safe to run twice', async () => {
    await verified();
    app.fixedClock.advanceDays(31);
    expect((await runRetention(app)).rawDocumentsDeleted).toBe(4);
    expect((await runRetention(app)).rawDocumentsDeleted).toBe(0);
  });

  describe('manual trigger', () => {
    it('needs the admin token', async () => {
      expectApiError(await owner.post('/api/v1/admin/retention-runs'), 403, 'ADMIN_REQUIRED');
    });

    it('runs the job and reports the counts', async () => {
      await verified();
      app.fixedClock.advanceDays(31);
      const response = await admin.admin('POST', '/api/v1/admin/retention-runs');
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ rawDocumentsDeleted: 4 });
      expect(response.body.ranAt).toEqual(expect.any(String));
      expect(storedFiles()).toEqual([]);
    });

    it('rejects unknown fields', async () => {
      expectApiError(await admin.admin('POST', '/api/v1/admin/retention-runs', { force: true }), 400, 'INVALID_REQUEST');
    });
  });

  describe('schedule', () => {
    it('runs the job on its interval until stopped', async () => {
      vi.useFakeTimers();
      try {
        await verified();
        app.fixedClock.advanceDays(31);
        const stop = startRetentionSchedule(app, 1000);
        await vi.advanceTimersByTimeAsync(1000);
        vi.useRealTimers();
        await vi.waitFor(() => expect(storedFiles()).toEqual([]));
        stop();
      } finally {
        vi.useRealTimers();
      }
    });

    it('logs a failed run rather than stopping the server', async () => {
      vi.useFakeTimers();
      try {
        app.testDb.close();
        const stop = startRetentionSchedule(app, 1000);
        await vi.advanceTimersByTimeAsync(1000);
        vi.useRealTimers();
        await vi.waitFor(() =>
          expect(app.logs.some((entry) => entry.event === 'retention.failed')).toBe(true),
        );
        stop();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
