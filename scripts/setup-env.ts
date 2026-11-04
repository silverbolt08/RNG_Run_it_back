import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const TARGET = '.env.local';

/**
 * Creates .env.local from .env.example with fresh random values, so nobody ends up sharing a
 * secret from the repo. It never overwrites an existing file.
 */
function main(): void {
  if (existsSync(TARGET)) {
    console.log(`${TARGET} already exists, so it was left alone.`);
    return;
  }

  const generated: Readonly<Record<string, string>> = {
    SESSION_SECRET: randomBytes(32).toString('base64url'),
    DOCUMENT_MASTER_KEY: randomBytes(32).toString('base64'),
    ADMIN_TOKEN: randomBytes(24).toString('base64url'),
    REGISTRY_SERVICE_TOKEN: randomBytes(24).toString('base64url'),
  };

  const output = readFileSync('.env.example', 'utf8').replace(/^([A-Z_]+)=$/gm, (line, name: string) =>
    generated[name] ? `${name}=${generated[name]}` : line,
  );
  writeFileSync(TARGET, output, { mode: 0o600 });
  console.log(`Wrote ${TARGET} with new random secrets.`);
}

main();
