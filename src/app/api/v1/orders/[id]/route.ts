import { sessionRoute } from '@/server/http/api-route';
import { json } from '@/server/http/response';
import { getOrder } from '@/server/services/order-service';

/** The tracker's data: stages, dates per product, and what happens next and when. */
export const GET = sessionRoute<{ id: string }>('GET /api/v1/orders/[id]', {}, async ({ app, session, params }) =>
  json(await getOrder(app, session.ownerId, params.id)),
);
