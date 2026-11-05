import { sessionRoute } from '@/server/http/api-route';
import { json } from '@/server/http/response';
import { quoteFromConversation } from '@/server/services/advisor/advisor-service';

export const POST = sessionRoute<{ id: string }>('POST /api/v1/conversations/{id}/quote', { consent: 'advisor_profile' }, async ({ app, params, session }) =>
  json(await quoteFromConversation(app, session, params.id)),
);
