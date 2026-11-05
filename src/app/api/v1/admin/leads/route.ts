import { adminRoute } from '@/server/http/api-route';
import { json } from '@/server/http/response';
import { listTopLeads } from '@/server/services/backoffice-service';

export const GET = adminRoute('GET /api/v1/admin/leads', async ({ app }) => json(await listTopLeads(app)));
