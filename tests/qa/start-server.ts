import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, rmSync } from 'node:fs';

/**
 * Runs the existing production build on its own port and its own copy of the database, with the LLM
 * off so nothing leaves the machine. It never rebuilds, because a dev server may share the folder.
 * Build first with `npm run build` if src has changed.
 */
const PORT = process.env.QA_PORT ?? '3200';
const NAME = `qa-${PORT}`;

for (const suffix of ['', '-wal', '-shm']) rmSync(`storage/${NAME}.db${suffix}`, { force: true });
rmSync(`storage/${NAME}-documents`, { recursive: true, force: true });
if (!existsSync('storage/app.db')) throw new Error('Run npm run db:migrate and npm run seed first');
copyFileSync('storage/app.db', `storage/${NAME}.db`);

spawn('npx', ['next', 'start', '-p', PORT], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    LLM_PROVIDER: 'off',
    LLM_API_KEY: '',
    COOKIE_SECURE: 'false',
    ADMIN_TOKEN: 'e2e-admin-token-not-a-secret',
    NEXT_TELEMETRY_DISABLED: '1',
    DATABASE_URL: `file:storage/${NAME}.db`,
    DOCUMENT_DIR: `./storage/${NAME}-documents`,
  },
});
