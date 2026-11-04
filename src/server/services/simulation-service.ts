import type { AppContext } from '../app-context';
import { recordAudit } from '../db/repositories/audit-repository';
import { simulationFlags } from '../db/schema';
import type { SimulationFlag } from '../db/schema/enums';

export async function setSimulationFlag(
  app: AppContext,
  flag: SimulationFlag,
  enabled: boolean,
  requestId: string,
): Promise<void> {
  const now = app.clock.now().toISOString();
  const value = enabled ? 1 : 0;
  await app.db
    .insert(simulationFlags)
    .values({ id: flag, enabled: value, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: simulationFlags.id, set: { enabled: value, updatedAt: now } });
  await recordAudit(app, {
    actorRef: 'admin',
    action: 'SIMULATION_SET',
    objectType: 'simulation_flag',
    objectId: flag,
    requestId,
    metadata: { enabled },
  });
}
