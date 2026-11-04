import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient, expectApiError, grant, newVisitor, verifyPhone } from '../../helpers/api-client';
import { createTestApp, TEST_OTP_CODE, type TestApp } from '../../helpers/test-app';

const PHONE = '9876541234';

describe('sessions', () => {
  let app: TestApp;
  beforeEach(async () => {
    app = await createTestApp();
  });
  afterEach(() => app.dispose());

  describe('anonymous sessions', () => {
    it('starts one on the first visit, with a signed HttpOnly SameSite=Lax cookie', async () => {
      const client = new ApiClient();
      const response = await client.post('/api/v1/sessions');
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ phoneVerified: false, phoneMasked: null });

      const cookie = response.headers.get('set-cookie') ?? '';
      expect(cookie).toMatch(/^udyam_session=[^;]+\.[^;]+;/);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('Path=/');
    });

    it('returns the same session if there already is one, rather than starting another', async () => {
      const client = await newVisitor();
      const before = client.cookie;
      const response = await client.post('/api/v1/sessions');
      expect(response.status).toBe(200);
      expect(client.cookie).toBe(before);
    });

    it('rejects a missing cookie on a protected route', async () => {
      expectApiError(await new ApiClient().get('/api/v1/sessions/current'), 401, 'SESSION_REQUIRED');
    });

    it.each([
      ['a forged token', 'udyam_session=forged.signature'],
      ['no signature', 'udyam_session=abcdef'],
      ['an empty value', 'udyam_session='],
    ])('rejects %s', async (_label, cookie) => {
      const client = new ApiClient();
      client.cookie = cookie;
      expectApiError(await client.get('/api/v1/sessions/current'), 401, 'SESSION_REQUIRED');
    });

    it('rejects a real token with its signature changed', async () => {
      const client = await newVisitor();
      client.cookie = `${client.cookie?.slice(0, -2)}xx`;
      expectApiError(await client.get('/api/v1/sessions/current'), 401, 'SESSION_REQUIRED');
    });

    it('expires after its lifetime, using system time rather than the business date', async () => {
      const client = await newVisitor();
      expect((await client.get('/api/v1/sessions/current')).status).toBe(200);
      app.fixedClock.advanceDays(31);
      expectApiError(await client.get('/api/v1/sessions/current'), 401, 'SESSION_REQUIRED');
    });

    it('ends when asked, and the old cookie stops working', async () => {
      const client = await newVisitor();
      const oldCookie = client.cookie;
      const response = await client.delete('/api/v1/sessions/current');
      expect(response.status).toBe(200);
      expect(client.cookie).toBeNull();

      client.cookie = oldCookie;
      expectApiError(await client.get('/api/v1/sessions/current'), 401, 'SESSION_REQUIRED');
    });
  });

  describe('mock phone OTP', () => {
    it('labels the test code clearly and masks the phone', async () => {
      const client = await newVisitor();
      const response = await client.post('/api/v1/sessions/otp-requests', { phone: PHONE });
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        delivery: 'MOCK_NO_SMS_SENT',
        testCode: TEST_OTP_CODE,
        phoneMasked: '••••••1234',
      });
      expect(JSON.stringify(response.body)).not.toContain(PHONE);
    });

    it.each(['12345', '1234567890', 'abcdefghij', ''])('rejects the invalid phone %j', async (phone) => {
      const client = await newVisitor();
      expectApiError(await client.post('/api/v1/sessions/otp-requests', { phone }), 400, 'INVALID_REQUEST');
    });

    it('accepts a phone with a +91 prefix', async () => {
      const client = await newVisitor();
      const response = await client.post('/api/v1/sessions/otp-requests', { phone: `+91${PHONE}` });
      expect(response.status).toBe(201);
      expect(response.body.phoneMasked).toBe('••••••1234');
    });

    it('upgrades the session on the right code, and rotates the cookie', async () => {
      const client = await newVisitor();
      const oldCookie = client.cookie;
      await verifyPhone(client, PHONE);
      expect(client.cookie).not.toBe(oldCookie);

      const current = await client.get('/api/v1/sessions/current');
      expect(current.body).toMatchObject({ phoneVerified: true, phoneMasked: '••••••1234' });

      const stale = new ApiClient();
      stale.cookie = oldCookie;
      expectApiError(await stale.get('/api/v1/sessions/current'), 401, 'SESSION_REQUIRED');
    });

    it('rejects a wrong code', async () => {
      const client = await newVisitor();
      const challenge = await client.post('/api/v1/sessions/otp-requests', { phone: PHONE });
      const response = await client.post('/api/v1/sessions/otp-verifications', {
        challengeId: challenge.body.challengeId,
        code: '111111',
      });
      expectApiError(response, 422, 'OTP_INCORRECT');
      expect((await client.get('/api/v1/sessions/current')).body.phoneVerified).toBe(false);
    });

    it('locks a challenge after too many wrong codes, even for the right one', async () => {
      const client = await newVisitor();
      const challenge = await client.post('/api/v1/sessions/otp-requests', { phone: PHONE });
      const attempt = (code: string) =>
        client.post('/api/v1/sessions/otp-verifications', { challengeId: challenge.body.challengeId, code });

      for (let i = 0; i < 5; i++) expectApiError(await attempt('111111'), 422, 'OTP_INCORRECT');
      expectApiError(await attempt(TEST_OTP_CODE), 429, 'OTP_ATTEMPTS_EXCEEDED');
    });

    it('rejects an expired code', async () => {
      const client = await newVisitor();
      const challenge = await client.post('/api/v1/sessions/otp-requests', { phone: PHONE });
      app.fixedClock.advanceDays(1);
      const response = await client.post('/api/v1/sessions/otp-verifications', {
        challengeId: challenge.body.challengeId,
        code: TEST_OTP_CODE,
      });
      expectApiError(response, 422, 'OTP_EXPIRED');
    });

    it('rejects a code used twice', async () => {
      const client = await newVisitor();
      const challenge = await client.post('/api/v1/sessions/otp-requests', { phone: PHONE });
      const body = { challengeId: challenge.body.challengeId, code: TEST_OTP_CODE };
      expect((await client.post('/api/v1/sessions/otp-verifications', body)).status).toBe(200);
      expectApiError(await client.post('/api/v1/sessions/otp-verifications', body), 404, 'NOT_FOUND');
    });

    it("refuses another session's challenge, as not found", async () => {
      const owner = await newVisitor();
      const challenge = await owner.post('/api/v1/sessions/otp-requests', { phone: PHONE });
      const other = await newVisitor();
      const response = await other.post('/api/v1/sessions/otp-verifications', {
        challengeId: challenge.body.challengeId,
        code: TEST_OTP_CODE,
      });
      expectApiError(response, 404, 'NOT_FOUND');
    });

    it('rate limits OTP requests', async () => {
      const client = await newVisitor();
      const ask = () => client.post('/api/v1/sessions/otp-requests', { phone: PHONE });
      for (let i = 0; i < 5; i++) expect((await ask()).status).toBe(201);
      const limited = await ask();
      expectApiError(limited, 429, 'RATE_LIMITED');
      expect(limited.headers.get('retry-after')).toBeTruthy();
    });

    it('stores no full phone number anywhere', async () => {
      const client = await newVisitor();
      await verifyPhone(client, PHONE);
      for (const table of ['owners', 'otp_challenges', 'audit_log']) {
        const rows = await app.testDb.client.execute(`SELECT * FROM ${table}`);
        expect(JSON.stringify(rows.rows)).not.toContain(PHONE);
      }
    });
  });

  describe('coming back on the same phone', () => {
    it('carries the anonymous work over to the existing owner', async () => {
      const first = await newVisitor();
      await verifyPhone(first, PHONE);
      await first.delete('/api/v1/sessions/current');

      const second = await newVisitor();
      await grant(second, 'advisor_profile');
      const quote = await second.post('/api/v1/quotes', {
        profile: { cityTier: 1, employeeCount: 3, numSites: 1, gstinStatus: 'NONE', fibreAvailable: true },
        lines: [{ productId: 'P01', quantity: 1 }],
      });
      expect(quote.status).toBe(201);

      await verifyPhone(second, PHONE);
      const read = await second.get(`/api/v1/quotes/${quote.body.id}`);
      expect(read.status).toBe(200);

      const consents = await second.get('/api/v1/consents');
      const advisor = consents.body.items.find((item: { purpose: string }) => item.purpose === 'advisor_profile');
      expect(advisor.status).toBe('GRANTED');
    });

    it('leaves one owner holding the phone', async () => {
      const first = await newVisitor();
      await verifyPhone(first, PHONE);
      const second = await newVisitor();
      await verifyPhone(second, PHONE);
      const owners = await app.testDb.client.execute(`SELECT status FROM owners WHERE phone_hash IS NOT NULL`);
      expect(owners.rows).toHaveLength(1);
    });
  });

  describe('request hygiene', () => {
    it('rejects unknown fields', async () => {
      const client = await newVisitor();
      const response = await client.post('/api/v1/sessions/otp-requests', { phone: PHONE, admin: true });
      expectApiError(response, 400, 'INVALID_REQUEST');
    });

    it('rejects malformed JSON', async () => {
      const client = await newVisitor();
      const response = await client.request('POST', '/api/v1/sessions/otp-requests', { raw: '{not json' });
      expectApiError(response, 400, 'INVALID_REQUEST');
    });

    it('rejects a JSON body far larger than any request needs', async () => {
      const client = await newVisitor();
      const response = await client.request('POST', '/api/v1/sessions/otp-requests', {
        raw: JSON.stringify({ phone: PHONE, padding: 'x'.repeat(200_000) }),
      });
      expectApiError(response, 400, 'INVALID_REQUEST');
      expect(response.body.error.details.issues).toEqual([{ path: '', code: 'too_big' }]);
    });

    it('rejects a cross-site write', async () => {
      const client = await newVisitor();
      const response = await client.post(
        '/api/v1/sessions/otp-requests',
        { phone: PHONE },
        { headers: { origin: 'https://evil.example' } },
      );
      expectApiError(response, 403, 'CROSS_SITE_REQUEST');
    });

    it('allows a same-origin write', async () => {
      const client = await newVisitor();
      const response = await client.post(
        '/api/v1/sessions/otp-requests',
        { phone: PHONE },
        { headers: { origin: 'http://localhost', host: 'localhost' } },
      );
      expect(response.status).toBe(201);
    });

    it('returns a request ID and forbids caching', async () => {
      const client = await newVisitor();
      const response = await client.get('/api/v1/sessions/current');
      expect(response.headers.get('x-request-id')).toMatch(/^req_/);
      expect(response.headers.get('cache-control')).toBe('no-store');
    });

    it('never shows a stack trace', async () => {
      const client = await newVisitor();
      // Closing the database makes every query fail, as a real outage would.
      app.testDb.close();
      const response = await client.get('/api/v1/sessions/current');
      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(response.body)).not.toMatch(/at .*\.ts|Error:/);
    });
  });
});
