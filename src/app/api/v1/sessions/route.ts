import { readSessionCookie, sessionCookieHeader } from '@/server/auth/session-cookie';
import { resolveSession, startAnonymousSession, toPublicSession } from '@/server/auth/session-service';
import { clientAddress, enforceRateLimit, publicRoute } from '@/server/http/api-route';
import { RATE_LIMITS } from '@/server/http/rate-limiter';
import { json } from '@/server/http/response';

/** Public, because this is what a first-time visitor calls to get a session at all. */
export const POST = publicRoute('POST /api/v1/sessions', async ({ app, request }) => {
  const cookie = readSessionCookie(request.headers.get('cookie'));
  const existing = cookie ? await resolveSession(app, cookie) : null;
  if (existing) return json(toPublicSession(existing));

  enforceRateLimit(app, `new-session:${clientAddress(app, request)}`, RATE_LIMITS.newSession);
  const started = await startAnonymousSession(app);
  return json(toPublicSession(started.info), 201, {
    'set-cookie': sessionCookieHeader(started.cookieValue, {
      secure: app.config.secureCookies,
      maxAgeSeconds: started.maxAgeSeconds,
    }),
  });
});
