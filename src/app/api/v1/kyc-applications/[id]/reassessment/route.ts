import { sessionRoute } from '@/server/http/api-route';
import { readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { emptySchema } from '@/server/http/schemas';
import { reassessApplication } from '@/server/services/kyc/kyc-service';

export const POST = sessionRoute<{ id: string }>(
  'POST /api/v1/kyc-applications/[id]/reassessment',
  { consent: 'kyc_verification' },
  async ({ app, request, session, params, requestId }) => {
    await readJson(request, emptySchema);
    return json(await reassessApplication(app, session, params.id, requestId));
  },
);
