import { adminRoute } from '@/server/http/api-route';
import { json } from '@/server/http/response';
import { listHandoffs } from '@/server/services/backoffice-service';

export const GET = adminRoute('GET /api/v1/admin/handoffs', async ({ app }) => json(await listHandoffs(app)));
