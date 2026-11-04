import { sessionRoute } from '@/server/http/api-route';
import { readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { emptySchema } from '@/server/http/schemas';
import { acceptQuoteAndRefreshKyc } from '@/server/services/journey-service';

/** A phone number is asked for only here, when the owner commits. */
export const POST = sessionRoute<{ id: string }>(
  'POST /api/v1/quotes/[id]/acceptance',
  { verifiedPhone: true },
  async ({ app, request, session, params, requestId }) => {
    await readJson(request, emptySchema);
    return json(await acceptQuoteAndRefreshKyc(app, session, params.id, requestId));
  },
);
