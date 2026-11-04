import { clearedSessionCookieHeader } from '@/server/auth/session-cookie';
import { endSession, toPublicSession } from '@/server/auth/session-service';
import { sessionRoute } from '@/server/http/api-route';
import { json } from '@/server/http/response';
import { findJourney } from '@/server/services/journey-service';

/** Includes where the owner got to, so they can resume after leaving. */
export const GET = sessionRoute('GET /api/v1/sessions/current', {}, async ({ app, session }) =>
  json({ ...toPublicSession(session), journey: await findJourney(app, session.ownerId) }),
);

export const DELETE = sessionRoute('DELETE /api/v1/sessions/current', {}, async ({ app, session }) => {
  await endSession(app, session);
  return json({ ended: true }, 200, {
    'set-cookie': clearedSessionCookieHeader({ secure: app.config.secureCookies }),
  });
});
