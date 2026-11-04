import { sessionRoute } from '@/server/http/api-route';
import { RATE_LIMITS } from '@/server/http/rate-limiter';
import { readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { quoteLineSchema } from '@/server/http/schemas';
import { removeQuoteLine, setQuoteLine } from '@/server/services/quote-service';

type LineParams = { id: string; productId: string };

const OPTIONS = { consent: 'advisor_profile', rateLimit: { name: 'quote-change', rule: RATE_LIMITS.quoteChange } } as const;

export const PUT = sessionRoute<LineParams>(
  'PUT /api/v1/quotes/[id]/lines/[productId]',
  OPTIONS,
  async ({ app, request, session, params }) => {
    const { quantity } = await readJson(request, quoteLineSchema);
    return json(await setQuoteLine(app, session.ownerId, params.id, params.productId, quantity));
  },
);

export const DELETE = sessionRoute<LineParams>(
  'DELETE /api/v1/quotes/[id]/lines/[productId]',
  OPTIONS,
  async ({ app, session, params }) => json(await removeQuoteLine(app, session.ownerId, params.id, params.productId)),
);
