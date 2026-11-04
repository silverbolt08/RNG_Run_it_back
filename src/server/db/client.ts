import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from './schema';

export type Database = LibSQLDatabase<typeof schema>;

export type DatabaseHandle = { db: Database; client: Client; close(): void };

// Under the git-ignored storage folder, because it holds synthetic personal data.
export const DEFAULT_DATABASE_URL = 'file:storage/app.db';

// Long enough for one write to wait out another, since a transaction holds its own connection.
const BUSY_TIMEOUT_MS = 5000;

const MIGRATIONS_FOLDER = path.join(process.cwd(), 'src', 'server', 'db', 'migrations');

export function createDatabase(url: string = DEFAULT_DATABASE_URL): DatabaseHandle {
  ensureParentFolder(url);
  const client = createClient({ url, timeout: BUSY_TIMEOUT_MS });
  return { db: drizzle(client, { schema }), client, close: () => client.close() };
}

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/** Only a relative `file:` URL needs this. An absolute one comes from a caller that made its folder. */
function ensureParentFolder(url: string): void {
  if (!url.startsWith('file:') || url.startsWith('file:/')) return;
  mkdirSync(path.dirname(url.slice('file:'.length)), { recursive: true });
}
