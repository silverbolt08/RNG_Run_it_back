import { adminRoute } from '@/server/http/api-route';
import { readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { orderDelaySchema } from '@/server/http/schemas';
import { markOrderDelay } from '@/server/services/order-service';

/** A demo control, labelled as a simulation in its response. */
export const POST = adminRoute<{ id: string }>(
  'POST /api/v1/admin/orders/[id]/delays',
  async ({ app, request, params, requestId }) => {
    const input = await readJson(request, orderDelaySchema);
    return json(await markOrderDelay(app, params.id, input, requestId));
  },
);
