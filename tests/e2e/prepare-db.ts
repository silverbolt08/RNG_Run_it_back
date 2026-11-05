import { copyFileSync, existsSync, rmSync } from 'node:fs';

/**
 * A throwaway copy of the seeded database, so a browser run can't disturb local demo data. Run before
 * the server starts, because Playwright starts its web server ahead of any global setup.
 */
function prepare(): void {
  if (!existsSync('storage/app.db')) throw new Error('Run npm run db:migrate and npm run seed first');
  for (const suffix of ['', '-wal', '-shm']) rmSync(`storage/e2e.db${suffix}`, { force: true });
  rmSync('storage/e2e-documents', { recursive: true, force: true });
  copyFileSync('storage/app.db', 'storage/e2e.db');
}

prepare();
