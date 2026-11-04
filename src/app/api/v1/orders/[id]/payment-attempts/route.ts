import { sessionRoute } from '@/server/http/api-route';
import { readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { paymentAttemptSchema } from '@/server/http/schemas';
import { attemptPayment } from '@/server/services/order-service';

/** A labelled mock with a failure and retry path. The strict schema refuses any card field. */
export const POST = sessionRoute<{ id: string }>(
  'POST /api/v1/orders/[id]/payment-attempts',
  {},
  async ({ app, request, session, params, requestId }) => {
    const { simulate } = await readJson(request, paymentAttemptSchema);
    return json(await attemptPayment(app, session, params.id, simulate, requestId), 201);
  },
);
