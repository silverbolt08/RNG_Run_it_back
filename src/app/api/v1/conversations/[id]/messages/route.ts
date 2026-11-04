import { sessionRoute } from '@/server/http/api-route';
import { RATE_LIMITS } from '@/server/http/rate-limiter';
import { readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { conversationMessageSchema } from '@/server/http/schemas';
import { sendMessage } from '@/server/services/advisor/advisor-service';

export const POST = sessionRoute<{ id: string }>(
  'POST /api/v1/conversations/{id}/messages',
  { consent: 'advisor_profile', rateLimit: { name: 'advisor-message', rule: RATE_LIMITS.advisorMessage } },
  async ({ app, request, params, session }) =>
    json(await sendMessage(app, session.ownerId, params.id, await readJson(request, conversationMessageSchema))),
);
