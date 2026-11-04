import { adminRoute } from '@/server/http/api-route';
import { readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { emptySchema } from '@/server/http/schemas';
import { runRetention } from '@/server/retention/retention-job';

/** The manual trigger. The same job also runs daily in-process. */
export const POST = adminRoute('POST /api/v1/admin/retention-runs', async ({ app, request, requestId }) => {
  await readJson(request, emptySchema);
  const report = await runRetention(app, requestId);
  return json({ ...report, ranAt: app.clock.now().toISOString() });
});
