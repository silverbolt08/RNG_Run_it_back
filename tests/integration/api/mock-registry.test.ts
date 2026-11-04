import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient, expectApiError } from '../../helpers/api-client';
import { addGstRecord, addUdyamRecord, createTestApp, type TestApp } from '../../helpers/test-app';

const GSTIN = '32TTNXB7384T1ZW';
const UDYAM = 'UDYAM-KL-00-3078801';

describe('mock registry routes', () => {
  let app: TestApp;
  const client = new ApiClient();

  beforeEach(async () => {
    app = await createTestApp();
    await addGstRecord(app, {
      gstin: GSTIN,
      legalName: 'Balaji Dental Care LLP',
      tradeName: 'Balaji Dental Care LLP',
      address: 'Shop/Unit 164, Station Road, Kochi, Kerala - 289398',
      status: 'Active',
    });
    await addUdyamRecord(app, { udyamNumber: UDYAM, enterpriseName: 'Balaji Dental Care LLP' });
  });
  afterEach(() => app.dispose());

  describe('GSTIN', () => {
    it('returns 200 with only the fields the flow needs', async () => {
      const response = await client.service(`/api/v1/mock-registry/gstin/${GSTIN}`);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        gstin: GSTIN,
        legalName: 'Balaji Dental Care LLP',
        tradeName: 'Balaji Dental Care LLP',
        address: 'Shop/Unit 164, Station Road, Kochi, Kerala - 289398',
        status: 'Active',
      });
    });

    it.each(['NOT-A-GSTIN', '32TTNXB7384T1Z', '32TTNXB7384T1ZX'])('returns 400 for %s', async (value) => {
      expectApiError(await client.service(`/api/v1/mock-registry/gstin/${value}`), 400, 'INVALID_FORMAT');
    });

    it('returns 404 for a valid number not in the registry', async () => {
      // Passes the checksum, but was never issued.
      expectApiError(await client.service('/api/v1/mock-registry/gstin/29AAAAA0000A1ZY'), 404, 'NOT_FOUND');
    });

    it('returns 503 during a simulated outage', async () => {
      await client.admin('PUT', '/api/v1/admin/simulations/registry-outage', { enabled: true });
      expectApiError(await client.service(`/api/v1/mock-registry/gstin/${GSTIN}`), 503, 'REGISTRY_UNAVAILABLE');
    });

    it('recovers when the outage ends', async () => {
      await client.admin('PUT', '/api/v1/admin/simulations/registry-outage', { enabled: true });
      await client.admin('PUT', '/api/v1/admin/simulations/registry-outage', { enabled: false });
      expect((await client.service(`/api/v1/mock-registry/gstin/${GSTIN}`)).status).toBe(200);
    });

    it('is server-to-server only, so a browser without the service token gets 401', async () => {
      expectApiError(await new ApiClient().get(`/api/v1/mock-registry/gstin/${GSTIN}`), 401, 'SERVICE_TOKEN_REQUIRED');
    });

    it('does not put the identifier in any log', async () => {
      await client.service(`/api/v1/mock-registry/gstin/${GSTIN}`);
      expect(JSON.stringify(app.logs)).not.toContain(GSTIN);
    });
  });

  describe('Udyam', () => {
    it('returns 200 with only the fields the flow needs', async () => {
      const response = await client.service(`/api/v1/mock-registry/udyam/${UDYAM}`);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        udyamNumber: UDYAM,
        enterpriseName: 'Balaji Dental Care LLP',
        majorActivity: 'Services',
        city: 'Kochi',
        state: 'Kerala',
        dateOfRegistration: '2021-01-01',
      });
    });

    it('returns 400 for a malformed number', async () => {
      expectApiError(await client.service('/api/v1/mock-registry/udyam/UDYAM-KL-3078801'), 400, 'INVALID_FORMAT');
    });

    it('returns 404 for a number not in the registry', async () => {
      expectApiError(await client.service('/api/v1/mock-registry/udyam/UDYAM-KL-00-0000000'), 404, 'NOT_FOUND');
    });

    it('returns 503 during a simulated outage', async () => {
      await client.admin('PUT', '/api/v1/admin/simulations/registry-outage', { enabled: true });
      expectApiError(await client.service(`/api/v1/mock-registry/udyam/${UDYAM}`), 503, 'REGISTRY_UNAVAILABLE');
    });

    it('needs the service token', async () => {
      expectApiError(await new ApiClient().get(`/api/v1/mock-registry/udyam/${UDYAM}`), 401, 'SERVICE_TOKEN_REQUIRED');
    });
  });
});
