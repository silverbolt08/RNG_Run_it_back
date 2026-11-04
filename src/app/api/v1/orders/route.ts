import { sessionRoute } from '@/server/http/api-route';
import { pageQuerySchema, readIdempotencyKey, readJson, readQuery } from '@/server/http/request';
import { json } from '@/server/http/response';
import { orderCreateSchema } from '@/server/http/schemas';
import { createOrder, pageOrders } from '@/server/services/order-service';

export const GET = sessionRoute('GET /api/v1/orders', {}, async ({ app, request, session }) =>
  json(await pageOrders(app, session.ownerId, readQuery(request, pageQuerySchema))),
);

export const POST = sessionRoute(
  'POST /api/v1/orders',
  { consent: 'kyc_verification', verifiedPhone: true },
  async ({ app, request, session, requestId }) => {
    const idempotencyKey = readIdempotencyKey(request);
    const input = await readJson(request, orderCreateSchema);
    const { created, order } = await createOrder(app, session, input, idempotencyKey, requestId);
    return json(order, created ? 201 : 200);
  },
);
