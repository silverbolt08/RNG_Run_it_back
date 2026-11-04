import { sessionRoute } from '@/server/http/api-route';
import { readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { conversationStartSchema } from '@/server/http/schemas';
import { startConversation } from '@/server/services/advisor/advisor-service';

export const POST = sessionRoute('POST /api/v1/conversations', { consent: 'advisor_profile' }, async ({ app, request, session }) => {
  const { created, view } = await startConversation(app, session.ownerId, await readJson(request, conversationStartSchema));
  return json(view, created ? 201 : 200);
});
