import { adminRoute } from '@/server/http/api-route';
import { readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { emptySchema } from '@/server/http/schemas';
import { advanceOrderStage } from '@/server/services/order-service';

/** A demo control, labelled as a simulation in its response. */
export const POST = adminRoute<{ id: string }>(
  'POST /api/v1/admin/orders/[id]/stage-advances',
  async ({ app, request, params, requestId }) => {
    await readJson(request, emptySchema);
    return json(await advanceOrderStage(app, params.id, requestId));
  },
);
