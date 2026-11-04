import { sessionRoute } from '@/server/http/api-route';
import { readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { emptySchema } from '@/server/http/schemas';
import { saveQuote } from '@/server/services/quote-service';

export const POST = sessionRoute<{ id: string }>(
  'POST /api/v1/quotes/[id]/save',
  {},
  async ({ app, request, session, params }) => {
    await readJson(request, emptySchema);
    return json(await saveQuote(app, session.ownerId, params.id));
  },
);
