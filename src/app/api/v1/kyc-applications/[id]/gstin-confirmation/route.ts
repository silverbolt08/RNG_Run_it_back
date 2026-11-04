import { sessionRoute } from '@/server/http/api-route';
import { readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { gstinConfirmationSchema } from '@/server/http/schemas';
import { confirmGstin } from '@/server/services/kyc/kyc-service';

/** By POST, so the identifier stays out of the URL. */
export const POST = sessionRoute<{ id: string }>(
  'POST /api/v1/kyc-applications/[id]/gstin-confirmation',
  { consent: 'kyc_verification' },
  async ({ app, request, session, params, requestId }) => {
    const { gstin } = await readJson(request, gstinConfirmationSchema);
    return json(await confirmGstin(app, session, params.id, gstin, requestId));
  },
);
