import { z } from 'zod';
import { CONSENT_PURPOSES } from '@/server/db/schema/enums';
import { sessionRoute } from '@/server/http/api-route';
import { notFound } from '@/server/http/errors';
import { readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { emptySchema } from '@/server/http/schemas';
import { withdrawConsent } from '@/server/services/withdrawal-service';

const purposeSchema = z.enum(CONSENT_PURPOSES);

export const POST = sessionRoute<{ purpose: string }>(
  'POST /api/v1/consents/[purpose]/withdrawal',
  {},
  async ({ app, request, session, params, requestId }) => {
    await readJson(request, emptySchema);
    const purpose = purposeSchema.safeParse(params.purpose);
    if (!purpose.success) throw notFound();
    return json(await withdrawConsent(app, session, purpose.data, requestId));
  },
);
