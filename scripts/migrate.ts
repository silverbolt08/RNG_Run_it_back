import { createDatabase, DEFAULT_DATABASE_URL, runMigrations } from '../src/server/db/client';
import { loadLocalEnv } from './load-env';

async function main(): Promise<void> {
  loadLocalEnv();
  const { db, close } = createDatabase(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
  await runMigrations(db);
  close();
  console.log('Migrations applied');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
