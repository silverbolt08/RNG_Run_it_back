import { sessionRoute } from '@/server/http/api-route';
import { RATE_LIMITS } from '@/server/http/rate-limiter';
import { readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { discoveryProfileSchema } from '@/server/http/schemas';
import { recommend } from '@/server/services/recommendation-service';

export const POST = sessionRoute(
  'POST /api/v1/recommendations',
  { consent: 'advisor_profile', rateLimit: { name: 'recommendation', rule: RATE_LIMITS.recommendation } },
  async ({ app, request }) => json(await recommend(app, await readJson(request, discoveryProfileSchema))),
);
