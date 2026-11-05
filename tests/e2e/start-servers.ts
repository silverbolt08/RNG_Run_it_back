import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, rmSync } from 'node:fs';

/**
 * Builds once, then runs the real app twice, each on a throwaway copy of the seeded database: one
 * normal, and one with no OCR language file, which is a real OCR outage. Playwright starts its web
 * server before any global setup, so the preparation lives here.
 */
const COMMON = {
  LLM_PROVIDER: 'gemini',
  // Refused by the provider, so these tests exercise a really failing LLM, and spend no quota.
  LLM_API_KEY: 'invalid-key-for-browser-tests',
  LLM_TIMEOUT_MS: '3000',
  COOKIE_SECURE: 'false',
  ADMIN_TOKEN: 'e2e-admin-token-not-a-secret',
  NEXT_TELEMETRY_DISABLED: '1',
};

function prepareStorage(name: string): void {
  if (!existsSync('storage/app.db')) throw new Error('Run npm run db:migrate and npm run seed first');
  for (const suffix of ['', '-wal', '-shm']) rmSync(`storage/${name}.db${suffix}`, { force: true });
  rmSync(`storage/${name}-documents`, { recursive: true, force: true });
  copyFileSync('storage/app.db', `storage/${name}.db`);
}

function start(name: string, port: number, extra: Record<string, string> = {}): void {
  prepareStorage(name);
  spawn('npx', ['next', 'start', '-p', String(port)], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...COMMON, DATABASE_URL: `file:storage/${name}.db`, DOCUMENT_DIR: `./storage/${name}-documents`, ...extra },
  });
}

const build = spawnSync('npx', ['next', 'build'], { stdio: 'inherit', shell: true, env: { ...process.env, ...COMMON } });
if (build.status !== 0) process.exit(build.status ?? 1);

start('e2e', 3100);
start('e2e-ocr-down', 3101, { OCR_LANG_DIR: './storage/no-ocr-language-here' });
