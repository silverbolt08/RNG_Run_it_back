import { existsSync } from 'node:fs';

/** Scripts run outside Next.js, so they load .env.local themselves. Real environment values win. */
export function loadLocalEnv(): void {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
}
