import { sessionRoute } from '@/server/http/api-route';
import { json } from '@/server/http/response';
import { getApplication } from '@/server/services/kyc/kyc-service';

/** Needs no consent, so an owner who withdrew can still see that their data was erased. */
export const GET = sessionRoute<{ id: string }>('GET /api/v1/kyc-applications/[id]', {}, async ({ app, session, params }) =>
  json(await getApplication(app, session.ownerId, params.id)),
);
