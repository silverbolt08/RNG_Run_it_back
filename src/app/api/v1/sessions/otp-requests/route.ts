import { requestOtp } from '@/server/auth/session-service';
import { sessionRoute } from '@/server/http/api-route';
import { RATE_LIMITS } from '@/server/http/rate-limiter';
import { readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { otpRequestSchema } from '@/server/http/schemas';

export const POST = sessionRoute(
  'POST /api/v1/sessions/otp-requests',
  { rateLimit: { name: 'otp-request', rule: RATE_LIMITS.otpRequest } },
  async ({ app, request, session }) => {
    const { phone } = await readJson(request, otpRequestSchema);
    return json(await requestOtp(app, session, phone), 201);
  },
);
