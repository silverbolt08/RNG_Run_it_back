import { isValidUdyamFormat } from '@/domain/kyc/udyam';
import { serviceRoute } from '@/server/http/api-route';
import { ApiError, notFound } from '@/server/http/errors';
import { RATE_LIMITS } from '@/server/http/rate-limiter';
import { json } from '@/server/http/response';

/** Server-to-server only. Identifiers from a browser go by POST to our own routes instead. */
export const GET = serviceRoute<{ number: string }>(
  'GET /api/v1/mock-registry/udyam/[number]',
  { rateLimit: { name: 'registry-udyam', rule: RATE_LIMITS.registryRoute } },
  async ({ app, params }) => {
    if (await app.registryBackend.isOutage()) {
      throw new ApiError(503, 'REGISTRY_UNAVAILABLE', 'The Udyam registry is not responding. Please retry.');
    }
    if (!isValidUdyamFormat(params.number)) {
      throw new ApiError(400, 'INVALID_FORMAT', 'This is not a valid Udyam number.');
    }
    const record = await app.registryBackend.findUdyam(params.number);
    if (!record) throw notFound();
    return json(record);
  },
);
