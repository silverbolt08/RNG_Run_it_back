import { sessionRoute } from '@/server/http/api-route';
import { json } from '@/server/http/response';
import { listAddOns } from '@/server/services/add-on-service';

export const GET = sessionRoute<{ id: string }>('GET /api/v1/quotes/[id]/add-ons', { consent: 'advisor_profile' }, async ({ app, session, params }) =>
  json(await listAddOns(app, session.ownerId, params.id)),
);
