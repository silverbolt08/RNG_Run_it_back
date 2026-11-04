import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Sealer } from '../../crypto/sealer';
import type { DocumentStorage } from './document-storage';

const STORAGE_KEY = /^[a-f0-9]{32}$/;

/**
 * Encrypted files outside `public/`, under random names. The key is checked before it reaches a
 * path, so no value from a request or the database can walk out of the folder.
 */
export function createFileDocumentStorage(options: { dir: string; sealer: Sealer }): DocumentStorage {
  const { dir, sealer } = options;

  const fileFor = (key: string): string => {
    if (!STORAGE_KEY.test(key)) throw new Error('Invalid storage key');
    return path.join(dir, `${key}.enc`);
  };

  return {
    put: async (plain) => {
      const key = randomBytes(16).toString('hex');
      const file = fileFor(key);
      await mkdir(dir, { recursive: true });
      // Written then renamed, so a crash can't leave a half-written file under a real name.
      const partial = `${file}.tmp`;
      await writeFile(partial, sealer.seal(plain, key), { mode: 0o600 });
      await rename(partial, file);
      return key;
    },
    get: async (key) => sealer.open(await readFile(fileFor(key)), key),
    delete: async (key) => {
      await rm(fileFor(key), { force: true });
    },
  };
}
