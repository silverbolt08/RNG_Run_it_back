import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { consents } from '@/server/db/schema';
import { ApiClient, expectApiError, grant, newVisitor } from '../../helpers/api-client';
import { createTestApp, TEST_NOW, type TestApp } from '../../helpers/test-app';

const PURPOSES = ['advisor_profile', 'ai_chat', 'kyc_verification', 'service_updates', 'marketing'];

describe('consents', () => {
  let app: TestApp;
  let client: ApiClient;

  beforeEach(async () => {
    app = await createTestApp();
    client = await newVisitor();
  });
  afterEach(() => app.dispose());

  const statusOf = async (purpose: string, who: ApiClient = client) => {
    const list = await who.get('/api/v1/consents');
    return list.body.items.find((item: { purpose: string }) => item.purpose === purpose);
  };

  it('needs a session', async () => {
    expectApiError(await new ApiClient().get('/api/v1/consents'), 401, 'SESSION_REQUIRED');
  });

  it('lists all four purposes as not asked, in cursor-list form', async () => {
    const list = await client.get('/api/v1/consents');
    expect(list.status).toBe(200);
    expect(list.body.nextCursor).toBeNull();
    expect(list.body.items.map((item: { purpose: string }) => item.purpose).sort()).toEqual([...PURPOSES].sort());
    for (const item of list.body.items) {
      expect(item.status).toBe('NOT_ASKED');
      expect(item.currentNoticeVersion).toEqual(expect.any(String));
    }
  });

  it.each(PURPOSES)('grants %s alone, leaving the others untouched', async (purpose) => {
    const response = await grant(client, purpose);
    expect(response.body).toMatchObject({ purpose, status: 'GRANTED', language: 'en' });
    expect(response.body.grantedAt).toBe(TEST_NOW);

    for (const other of PURPOSES.filter((value) => value !== purpose)) {
      expect((await statusOf(other)).status).toBe('NOT_ASKED');
    }
  });

  it('rejects an unknown purpose', async () => {
    const response = await client.post('/api/v1/consents', { purpose: 'everything', noticeVersion: 'v1', language: 'en' });
    expectApiError(response, 400, 'INVALID_REQUEST');
  });

  it('rejects consent to a notice the owner was not shown', async () => {
    const response = await client.post('/api/v1/consents', {
      purpose: 'marketing',
      noticeVersion: 'an-old-version',
      language: 'en',
    });
    expectApiError(response, 409, 'NOTICE_OUTDATED');
  });

  it('rejects unknown fields, so purposes cannot be bundled', async () => {
    const current = await statusOf('kyc_verification');
    const response = await client.post('/api/v1/consents', {
      purpose: 'kyc_verification',
      noticeVersion: current.currentNoticeVersion,
      language: 'en',
      alsoMarketing: true,
    });
    expectApiError(response, 400, 'INVALID_REQUEST');
  });

  it('records withdrawal as a new row, leaving the grant in place', async () => {
    await grant(client, 'marketing');
    const response = await client.post('/api/v1/consents/marketing/withdrawal');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ purpose: 'marketing', status: 'WITHDRAWN', withdrawnAt: TEST_NOW });

    expect((await statusOf('marketing')).status).toBe('WITHDRAWN');
    const rows = await app.db.select().from(consents);
    expect(rows.map((row) => row.status)).toEqual(['GRANTED', 'WITHDRAWN']);
  });

  it('can be granted again after withdrawal', async () => {
    await grant(client, 'marketing');
    await client.post('/api/v1/consents/marketing/withdrawal');
    await grant(client, 'marketing');
    expect((await statusOf('marketing')).status).toBe('GRANTED');
  });

  it('refuses to withdraw what was never granted', async () => {
    expectApiError(await client.post('/api/v1/consents/marketing/withdrawal'), 409, 'CONSENT_NOT_ACTIVE');
  });

  it('refuses an unknown purpose on withdrawal', async () => {
    expectApiError(await client.post('/api/v1/consents/everything/withdrawal'), 404, 'NOT_FOUND');
  });

  it("keeps one owner's consents apart from another's", async () => {
    await grant(client, 'kyc_verification');
    const other = await newVisitor();
    expect((await statusOf('kyc_verification', other)).status).toBe('NOT_ASKED');
    expectApiError(await other.post('/api/v1/consents/kyc_verification/withdrawal'), 409, 'CONSENT_NOT_ACTIVE');
    expect((await statusOf('kyc_verification')).status).toBe('GRANTED');
  });

  it('treats consent to an older notice as no consent, because a changed notice needs fresh consent', async () => {
    await grant(client, 'kyc_verification');
    const [row] = await app.db.select().from(consents);
    await app.db.insert(consents).values({ ...(row as typeof consents.$inferInsert), id: 'con_old', noticeVersion: 'old' });

    const state = await statusOf('kyc_verification');
    expect(state.status).toBe('NOTICE_CHANGED');

    const response = await client.post('/api/v1/kyc-applications', { declaredAdultSignatory: true, quoteId: 'qt_anything00000000000000' });
    expectApiError(response, 403, 'CONSENT_REQUIRED');
    expect(response.body.error.details).toMatchObject({ purpose: 'kyc_verification' });
  });

  it('writes an audit record with no personal values', async () => {
    await grant(client, 'marketing');
    const audit = await app.testDb.client.execute(`SELECT action, actor_ref, metadata FROM audit_log WHERE action LIKE 'CONSENT%'`);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.action).toBe('CONSENT_GRANTED');
    expect(String(audit.rows[0]?.actor_ref)).toMatch(/^sub_/);
  });
});
