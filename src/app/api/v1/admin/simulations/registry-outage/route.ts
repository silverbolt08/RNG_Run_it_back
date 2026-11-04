import { adminRoute } from '@/server/http/api-route';
import { readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { simulationSchema } from '@/server/http/schemas';
import { setSimulationFlag } from '@/server/services/simulation-service';

/** A demo control, labelled as a simulation in its response. */
export const PUT = adminRoute(
  'PUT /api/v1/admin/simulations/registry-outage',
  async ({ app, request, requestId }) => {
    const { enabled } = await readJson(request, simulationSchema);
    await setSimulationFlag(app, 'REGISTRY_OUTAGE', enabled, requestId);
    return json({ flag: 'REGISTRY_OUTAGE', enabled, simulated: true });
  },
);
