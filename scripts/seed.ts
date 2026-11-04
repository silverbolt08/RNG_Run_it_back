import path from 'node:path';
import { createClockFromEnv } from '../src/lib/clock';
import { createDatabase, DEFAULT_DATABASE_URL, runMigrations } from '../src/server/db/client';
import { seedFromDataPack } from '../src/server/db/seed';
import { loadLocalEnv } from './load-env';

async function main(): Promise<void> {
  loadLocalEnv();
  const dataDir = path.resolve(process.env.DATA_DIR ?? 'YTL_TrackA_Udyam_Digital_Data');
  const { db, close } = createDatabase(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);

  await runMigrations(db);
  const counts = await seedFromDataPack(db, createClockFromEnv(process.env), dataDir);
  close();

  console.log('Seeded from the data pack:', counts);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
