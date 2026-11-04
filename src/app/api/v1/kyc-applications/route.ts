import { sessionRoute } from '@/server/http/api-route';
import { readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { kycApplicationCreateSchema } from '@/server/http/schemas';
import { createApplication } from '@/server/services/kyc/kyc-service';

export const POST = sessionRoute(
  'POST /api/v1/kyc-applications',
  { consent: 'kyc_verification' },
  async ({ app, request, session, requestId }) => {
    const input = await readJson(request, kycApplicationCreateSchema);
    const { created, application } = await createApplication(app, session, input, requestId);
    return json(application, created ? 201 : 200);
  },
);
