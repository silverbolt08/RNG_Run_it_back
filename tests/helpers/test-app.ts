import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createFixedClock } from '@/lib/clock';
import { parseCsv } from '@/lib/csv';
import { createLogger, type LogEntry } from '@/lib/logger';
import type { OcrProvider, OcrResult } from '@/server/adapters/ocr/ocr-provider';
import { setAppContext, buildAppContext, type AppContext } from '@/server/app-context';
import type { AppConfig } from '@/server/config';
import type { LlmProvider } from '@/server/llm/provider';
import { seedProducts } from '@/server/db/seed';
import { gstRegistry, leads, udyamRegistry } from '@/server/db/schema';
import { createTestDatabase, type TestDatabase } from './test-db';

export const TEST_TODAY = '2026-07-15';
export const TEST_NOW = '2026-11-04T10:00:00.000Z';
export const TEST_OTP_CODE = '000000';
export const TEST_ADMIN_TOKEN = 'test-admin-token-not-a-secret';
export const TEST_SERVICE_TOKEN = 'test-service-token-not-a-secret';

const CATALOGUE_FIXTURE = fileURLToPath(new URL('../fixtures/product_catalogue.csv', import.meta.url));

/** Reads what it is told to, so API tests don't depend on real OCR or the data pack. */
export class StubOcr implements OcrProvider {
  private texts: string[] = [];
  calls = 0;
  failing = false;

  willRead(...texts: string[]): void {
    this.texts.push(...texts);
  }

  async read(): Promise<OcrResult> {
    this.calls += 1;
    if (this.failing) {
      const { OcrUnavailableError } = await import('@/server/adapters/ocr/ocr-provider');
      throw new OcrUnavailableError('stubbed outage');
    }
    return { text: this.texts.shift() ?? '', confidence: 90, rotationDegrees: 0 };
  }

  async close(): Promise<void> {}
}

export type TestApp = AppContext & {
  testDb: TestDatabase;
  fixedClock: ReturnType<typeof createFixedClock>;
  logs: LogEntry[];
  stubOcr: StubOcr;
  documentDir: string;
  dispose(): Promise<void>;
};

export function testConfig(dir: string): AppConfig {
  return {
    databaseUrl: 'unused-in-tests',
    documentDir: path.join(dir, 'documents'),
    ocrLangDir: path.resolve('storage/ocr'),
    documentMasterKey: randomBytes(32),
    sessionSecret: 'test-session-secret-not-used-anywhere-else',
    otpTestCode: TEST_OTP_CODE,
    adminToken: TEST_ADMIN_TOKEN,
    registryServiceToken: TEST_SERVICE_TOKEN,
    allowedOrigins: [],
    secureCookies: true,
    registryTimeoutMs: 1000,
    trustProxy: false,
    llm: { provider: 'off', models: [], apiKey: null, timeoutMs: 1000 },
  };
}

export async function createTestApp(options: { ocr?: OcrProvider; llm?: LlmProvider | null } = {}): Promise<TestApp> {
  const testDb = await createTestDatabase();
  const fixedClock = createFixedClock({ today: TEST_TODAY, now: TEST_NOW });
  const logs: LogEntry[] = [];
  const stubOcr = new StubOcr();
  const config = testConfig(testDb.dir);

  const app = buildAppContext({
    config,
    clock: fixedClock,
    db: testDb.db,
    logger: createLogger((entry) => logs.push(entry)),
    ocr: options.ocr ?? stubOcr,
    llm: options.llm ?? null,
  });
  setAppContext(app);

  await seedProducts(testDb.db, fixedClock, parseCsv(readFileSync(CATALOGUE_FIXTURE, 'utf8')));

  return {
    ...app,
    testDb,
    fixedClock,
    logs,
    stubOcr,
    documentDir: config.documentDir,
    dispose: async () => {
      setAppContext(null);
      await (options.ocr ?? stubOcr).close();
      testDb.dispose();
    },
  };
}

const STAMPS = { createdAt: TEST_NOW, updatedAt: TEST_NOW };

export async function addGstRecord(
  app: TestApp,
  record: { gstin: string; legalName: string; tradeName: string; address: string; status: string; state?: string },
): Promise<void> {
  await app.db.insert(gstRegistry).values({
    id: record.gstin,
    legalName: record.legalName,
    tradeName: record.tradeName,
    constitution: 'Proprietorship',
    principalPlaceOfBusiness: record.address,
    state: record.state ?? 'Kerala',
    registrationDate: '2020-01-01',
    status: record.status,
    ...STAMPS,
  });
}

export async function addUdyamRecord(
  app: TestApp,
  record: { udyamNumber: string; enterpriseName: string; majorActivity?: string; city?: string; state?: string },
): Promise<void> {
  await app.db.insert(udyamRegistry).values({
    id: record.udyamNumber,
    enterpriseName: record.enterpriseName,
    enterpriseType: 'Micro',
    majorActivity: record.majorActivity ?? 'Services',
    nicDescription: 'Test',
    state: record.state ?? 'Kerala',
    city: record.city ?? 'Kochi',
    dateOfRegistration: '2021-01-01',
    ...STAMPS,
  });
}

export async function addLead(
  app: TestApp,
  lead: { id: string; gstin: string | null; contactName: string; businessName: string; udyamNumber?: string | null },
): Promise<void> {
  await app.db.insert(leads).values({
    id: lead.id,
    createdDate: '2026-05-01',
    leadSource: 'Website form',
    businessName: lead.businessName,
    businessType: 'Dental clinic',
    segment: 'Professional offices',
    city: 'Kochi',
    cityTier: 2,
    state: 'Kerala',
    preferredLanguage: 'English',
    employeeCount: 5,
    numSites: 1,
    gstin: lead.gstin,
    udyamNumber: lead.udyamNumber ?? null,
    contactName: lead.contactName,
    contactRole: 'Owner',
    stageReached: 'Needs assessed',
    outcome: 'Dropped',
    dropReason: '',
    ...STAMPS,
  });
}

/** A readable-looking image with hard edges, unique each time so each hash differs. */
export async function documentImage(format: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
  const seed = randomBytes(4).toString('hex');
  const rows = Array.from(
    { length: 16 },
    (_, row) => `<rect x="30" y="${30 + row * 30}" width="${280 + ((row * 37) % 300)}" height="10" fill="black"/>`,
  ).join('');
  const svg = `<svg width="900" height="600" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/>${rows}<text x="30" y="590" font-size="10">${seed}</text></svg>`;
  const image = sharp(Buffer.from(svg));
  return format === 'png' ? image.png().toBuffer() : image.jpeg({ quality: 95 }).toBuffer();
}

export async function blurredImage(): Promise<Buffer> {
  return sharp(await documentImage()).blur(10).png().toBuffer();
}
