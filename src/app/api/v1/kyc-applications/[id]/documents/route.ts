import { sessionRoute } from '@/server/http/api-route';
import { RATE_LIMITS } from '@/server/http/rate-limiter';
import { readIdempotencyKey } from '@/server/http/request';
import { json } from '@/server/http/response';
import { uploadDocument } from '@/server/services/kyc/kyc-upload';

/** The consent guard runs before the body is read, so a request without consent stores nothing. */
export const POST = sessionRoute<{ id: string }>(
  'POST /api/v1/kyc-applications/[id]/documents',
  { consent: 'kyc_verification', rateLimit: { name: 'upload', rule: RATE_LIMITS.upload } },
  async ({ app, request, session, params, requestId }) => {
    const idempotencyKey = readIdempotencyKey(request);
    const { created, replayed, document, application } = await uploadDocument(app, {
      ownerId: session.ownerId,
      subjectRef: session.subjectRef,
      applicationId: params.id,
      idempotencyKey,
      request,
      requestId,
    });
    return json({ document, application, replayed }, created ? 201 : 200);
  },
);
