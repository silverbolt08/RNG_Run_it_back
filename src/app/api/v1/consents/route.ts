import { grantConsent, listConsents } from '@/server/consent/consent-service';
import { sessionRoute } from '@/server/http/api-route';
import { readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { consentGrantSchema } from '@/server/http/schemas';

export const GET = sessionRoute('GET /api/v1/consents', {}, async ({ app, session }) =>
  // One entry per purpose, so there is never a second page.
  json({ items: await listConsents(app, session.subjectRef), nextCursor: null }),
);

export const POST = sessionRoute('POST /api/v1/consents', {}, async ({ app, request, session, requestId }) => {
  const input = await readJson(request, consentGrantSchema);
  return json(await grantConsent(app, session.subjectRef, input, requestId), 201);
});
