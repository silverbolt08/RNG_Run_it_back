import { sessionRoute } from '@/server/http/api-route';
import { json } from '@/server/http/response';
import { getCurrentConversation } from '@/server/services/advisor/advisor-service';

export const GET = sessionRoute('GET /api/v1/conversations/current', { consent: 'advisor_profile' }, async ({ app, session }) =>
  json(await getCurrentConversation(app, session)),
);
