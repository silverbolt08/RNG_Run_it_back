import { sessionCookieHeader } from '@/server/auth/session-cookie';
import { toPublicSession, verifyOtp } from '@/server/auth/session-service';
import { sessionRoute } from '@/server/http/api-route';
import { RATE_LIMITS } from '@/server/http/rate-limiter';
import { readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { otpVerificationSchema } from '@/server/http/schemas';

export const POST = sessionRoute(
  'POST /api/v1/sessions/otp-verifications',
  { rateLimit: { name: 'otp-verify', rule: RATE_LIMITS.otpVerify } },
  async ({ app, request, session, requestId }) => {
    const { challengeId, code } = await readJson(request, otpVerificationSchema);
    const started = await verifyOtp(app, session, challengeId, code, requestId);
    return json(toPublicSession(started.info), 200, {
      'set-cookie': sessionCookieHeader(started.cookieValue, {
        secure: app.config.secureCookies,
        maxAgeSeconds: started.maxAgeSeconds,
      }),
    });
  },
);
