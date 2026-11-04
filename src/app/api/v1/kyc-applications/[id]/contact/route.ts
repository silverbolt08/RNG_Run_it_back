import { sessionRoute } from '@/server/http/api-route';
import { readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { kycContactSchema } from '@/server/http/schemas';
import { setContactName } from '@/server/services/kyc/kyc-service';

export const PUT = sessionRoute<{ id: string }>(
  'PUT /api/v1/kyc-applications/[id]/contact',
  { consent: 'kyc_verification' },
  async ({ app, request, session, params, requestId }) => {
    const { contactName } = await readJson(request, kycContactSchema);
    return json(await setContactName(app, session, params.id, contactName, requestId));
  },
);
