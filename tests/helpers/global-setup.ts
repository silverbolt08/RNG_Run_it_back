import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Duplicated from test-db.ts, because this runs outside Vitest's module graph and path aliases.
const TEST_DIR_PREFIX = 'udyam-test-';

/** Clears temp folders left by earlier runs. Their databases and encrypted files are test data only. */
export default function setup(): void {
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith(TEST_DIR_PREFIX)) continue;
    try {
      rmSync(path.join(tmpdir(), name), { recursive: true, force: true });
    } catch {
      // Still held by another process. The next run gets it.
    }
  }
}
