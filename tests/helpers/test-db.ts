import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDatabase, runMigrations, type DatabaseHandle } from '@/server/db/client';

export const TEST_DIR_PREFIX = 'udyam-test-';

export type TestDatabase = DatabaseHandle & { dir: string; dispose(): void };

/** A real migrated database in a temp folder. A file rather than ":memory:", as in production. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const dir = mkdtempSync(path.join(tmpdir(), TEST_DIR_PREFIX));
  const handle = createDatabase(pathToFileURL(path.join(dir, 'test.db')).href);
  await runMigrations(handle.db);
  return {
    ...handle,
    dir,
    dispose: () => {
      handle.close();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // On Windows libsql can hold the file until garbage collection. tests/helpers/global-setup.ts
        // clears these folders at the start of the next run, when no process holds them.
      }
    },
  };
}
