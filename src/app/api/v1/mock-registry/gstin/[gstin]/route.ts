import { isValidGstinChecksum } from '@/domain/kyc/gstin';
import { serviceRoute } from '@/server/http/api-route';
import { ApiError, notFound } from '@/server/http/errors';
import { RATE_LIMITS } from '@/server/http/rate-limiter';
import { json } from '@/server/http/response';

/** Server-to-server only. Identifiers from a browser go by POST to our own routes instead. */
export const GET = serviceRoute<{ gstin: string }>(
  'GET /api/v1/mock-registry/gstin/[gstin]',
  { rateLimit: { name: 'registry-gstin', rule: RATE_LIMITS.registryRoute } },
  async ({ app, params }) => {
    if (await app.registryBackend.isOutage()) {
      throw new ApiError(503, 'REGISTRY_UNAVAILABLE', 'The GST registry is not responding. Please retry.');
    }
    if (!isValidGstinChecksum(params.gstin)) {
      throw new ApiError(400, 'INVALID_FORMAT', 'This is not a valid GSTIN.');
    }
    const record = await app.registryBackend.findGstin(params.gstin);
    if (!record) throw notFound();
    return json(record);
  },
);
