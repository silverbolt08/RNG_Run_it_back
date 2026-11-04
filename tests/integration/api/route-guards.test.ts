import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient, expectApiError, listRouteFiles } from '../../helpers/api-client';
import { createTestApp, TEST_ADMIN_TOKEN, type TestApp } from '../../helpers/test-app';

const ROUTE_FACTORIES = /^export const (GET|POST|PUT|PATCH|DELETE) = (publicRoute|sessionRoute|adminRoute|serviceRoute)\b/m;

describe('default deny', () => {
  const files = listRouteFiles();

  it('finds the API routes', () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
  });

  it.each(files.map((file) => [path.relative('src/app/api', file), file]))(
    '%s only exports handlers built by a guarded route factory',
    (_name, file) => {
      const source = readFileSync(file ?? '', 'utf8');
      expect(source).toMatch(ROUTE_FACTORIES);
      expect(source).not.toMatch(/export (async )?function/);
      for (const line of source.split('\n').filter((text) => /^export /.test(text))) {
        expect(line).toMatch(ROUTE_FACTORIES);
      }
    },
  );
});

describe('admin guard', () => {
  let app: TestApp;
  beforeEach(async () => {
    app = await createTestApp();
  });
  afterEach(() => app.dispose());

  const OUTAGE = '/api/v1/admin/simulations/registry-outage';

  it('refuses a request with no token', async () => {
    expectApiError(await new ApiClient().put(OUTAGE, { enabled: true }), 403, 'ADMIN_REQUIRED');
  });

  it('refuses a wrong token', async () => {
    const response = await new ApiClient().put(OUTAGE, { enabled: true }, { headers: { 'x-admin-token': 'wrong' } });
    expectApiError(response, 403, 'ADMIN_REQUIRED');
  });

  it('accepts the configured token', async () => {
    const response = await new ApiClient().put(OUTAGE, { enabled: true }, { headers: { 'x-admin-token': TEST_ADMIN_TOKEN } });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ flag: 'REGISTRY_OUTAGE', enabled: true, simulated: true });
  });

  it('refuses everyone when no token is configured, rather than allowing everyone', async () => {
    app.config.adminToken = '';
    const response = await new ApiClient().put(OUTAGE, { enabled: true }, { headers: { 'x-admin-token': '' } });
    expectApiError(response, 403, 'ADMIN_REQUIRED');
  });

  it('does not accept a signed-in owner as an admin', async () => {
    const owner = new ApiClient();
    await owner.post('/api/v1/sessions');
    expectApiError(await owner.put(OUTAGE, { enabled: true }), 403, 'ADMIN_REQUIRED');
  });
});
