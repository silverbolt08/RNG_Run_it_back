import { sessionRoute } from '@/server/http/api-route';
import { readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { conversationStartSchema } from '@/server/http/schemas';
import { requestHandoff } from '@/server/services/advisor/advisor-service';

export const POST = sessionRoute<{ id: string }>(
  'POST /api/v1/conversations/{id}/handoff',
  { consent: 'advisor_profile' },
  async ({ app, request, params, session }) => {
    const { language } = await readJson(request, conversationStartSchema);
    return json(await requestHandoff(app, session, params.id, language));
  },
);
