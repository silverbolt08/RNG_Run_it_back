import { sessionRoute } from '@/server/http/api-route';
import { RATE_LIMITS } from '@/server/http/rate-limiter';
import { pageQuerySchema, readJson, readQuery } from '@/server/http/request';
import { json } from '@/server/http/response';
import { quoteCreateSchema } from '@/server/http/schemas';
import { createQuote, pageQuotes } from '@/server/services/quote-service';

export const GET = sessionRoute('GET /api/v1/quotes', {}, async ({ app, request, session }) =>
  json(await pageQuotes(app, session.ownerId, readQuery(request, pageQuerySchema))),
);

export const POST = sessionRoute(
  'POST /api/v1/quotes',
  { consent: 'advisor_profile', rateLimit: { name: 'quote-change', rule: RATE_LIMITS.quoteChange } },
  async ({ app, request, session }) =>
    json(await createQuote(app, session.ownerId, await readJson(request, quoteCreateSchema)), 201),
);
