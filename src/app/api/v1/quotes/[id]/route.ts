import { sessionRoute } from '@/server/http/api-route';
import { json } from '@/server/http/response';
import { getQuote } from '@/server/services/quote-service';

export const GET = sessionRoute<{ id: string }>('GET /api/v1/quotes/[id]', {}, async ({ app, session, params }) =>
  json(await getQuote(app, session.ownerId, params.id)),
);
