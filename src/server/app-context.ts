import type { Catalogue } from '../domain/catalogue/catalogue';
import { createClockFromEnv, type Clock } from '../lib/clock';
import { createLogger, type Logger } from '../lib/logger';
import { createDbNotificationLog, type NotificationLog } from './adapters/notifications/notification-log';
import type { OcrProvider } from './adapters/ocr/ocr-provider';
import { createTesseractOcr } from './adapters/ocr/tesseract-ocr';
import { createDbRegistryBackend } from './adapters/registry/db-registry-backend';
import { createMockRegistryClient, type RegistryBackend } from './adapters/registry/mock-registry-client';
import type { RegistryClient } from './adapters/registry/registry-client';
import type { DocumentStorage } from './adapters/storage/document-storage';
import { createFileDocumentStorage } from './adapters/storage/file-document-storage';
import { loadConfig, type AppConfig } from './config';
import { createSealer, type Sealer } from './crypto/sealer';
import { createDatabase, runMigrations, type Database } from './db/client';
import { loadCatalogue } from './db/repositories/catalogue-repository';
import { createRateLimiter, type RateLimiter } from './http/rate-limiter';

export type AppContext = {
  config: AppConfig;
  clock: Clock;
  db: Database;
  logger: Logger;
  sealer: Sealer;
  storage: DocumentStorage;
  ocr: OcrProvider;
  registry: RegistryClient;
  registryBackend: RegistryBackend;
  notifications: NotificationLog;
  rateLimiter: RateLimiter;
  /** Loaded once, because the catalogue only changes when the data pack is seeded again. */
  catalogue(): Promise<Catalogue>;
};

type AppParts = Pick<AppContext, 'config' | 'clock' | 'db' | 'logger'> & Partial<Pick<AppContext, 'ocr'>>;

export function buildAppContext(parts: AppParts): AppContext {
  const { config, clock, db, logger } = parts;
  const sealer = createSealer(config.documentMasterKey);
  const registryBackend = createDbRegistryBackend(db);
  let catalogue: Promise<Catalogue> | null = null;

  return {
    config,
    clock,
    db,
    logger,
    sealer,
    storage: createFileDocumentStorage({ dir: config.documentDir, sealer }),
    ocr: parts.ocr ?? createTesseractOcr({ langDir: config.ocrLangDir }),
    registry: createMockRegistryClient(registryBackend, { timeoutMs: config.registryTimeoutMs }),
    registryBackend,
    notifications: createDbNotificationLog(db, clock),
    rateLimiter: createRateLimiter(clock),
    catalogue: () => {
      catalogue ??= loadCatalogue(db).catch((error: unknown) => {
        catalogue = null;
        throw error;
      });
      return catalogue;
    },
  };
}

// On globalThis, because Next.js can load each route in its own module instance, and all of them
// must share one database connection, OCR worker and rate limiter.
const HOLDER = globalThis as typeof globalThis & { __udyamApp?: Promise<AppContext> | null };

export function getAppContext(): Promise<AppContext> {
  HOLDER.__udyamApp ??= startApp().catch((error: unknown) => {
    HOLDER.__udyamApp = null;
    throw error;
  });
  return HOLDER.__udyamApp;
}

/** Lets tests supply their own database and adapters. */
export function setAppContext(app: AppContext | null): void {
  HOLDER.__udyamApp = app ? Promise.resolve(app) : null;
}

async function startApp(): Promise<AppContext> {
  const config = loadConfig(process.env);
  const { db } = createDatabase(config.databaseUrl);
  await runMigrations(db);
  return buildAppContext({ config, db, clock: createClockFromEnv(process.env), logger: createLogger() });
}
