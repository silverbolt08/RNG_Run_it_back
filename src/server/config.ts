import path from 'node:path';
import { z } from 'zod';
import { DEFAULT_DATABASE_URL } from './db/client';

export type AppConfig = {
  databaseUrl: string;
  documentDir: string;
  ocrLangDir: string;
  documentMasterKey: Buffer;
  sessionSecret: string;
  /** Prototype only: the fixed code that every mock OTP accepts. */
  otpTestCode: string;
  adminToken: string;
  registryServiceToken: string;
  allowedOrigins: string[];
  secureCookies: boolean;
  registryTimeoutMs: number;
  /** Believe x-forwarded-for only behind a proxy that sets it, because a client can send its own. */
  trustProxy: boolean;
  llm: LlmConfig;
};

export type LlmConfig = {
  /** `off` runs the advisor on tappable choices alone, which is also how outages are drilled. */
  provider: 'gemini' | 'off';
  /** Tried in order. The first is the main model, and the rest cover it when it is busy. */
  models: string[];
  apiKey: string | null;
  timeoutMs: number;
};

const DEFAULT_REGISTRY_TIMEOUT_MS = 3000;
// Chosen by running our scenarios on each. See docs/spikes/llm-choice.md.
const DEFAULT_LLM_MODELS = 'gemini-3.5-flash-lite,gemini-2.5-flash';
const DEFAULT_LLM_TIMEOUT_MS = 8000;
const MASTER_KEY_BYTES = 32;
const MIN_SECRET_LENGTH = 32;

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  DOCUMENT_DIR: z.string().min(1).optional(),
  OCR_LANG_DIR: z.string().min(1).optional(),
  DOCUMENT_MASTER_KEY: z.string().min(1, 'is required'),
  SESSION_SECRET: z.string().min(MIN_SECRET_LENGTH, `needs at least ${MIN_SECRET_LENGTH} characters`),
  OTP_TEST_CODE: z.string().regex(/^\d{6}$/, 'must be 6 digits'),
  ADMIN_TOKEN: z.string().min(1, 'is required'),
  REGISTRY_SERVICE_TOKEN: z.string().min(1, 'is required'),
  ALLOWED_ORIGINS: z.string().optional(),
  COOKIE_SECURE: z.string().optional(),
  NODE_ENV: z.string().optional(),
  REGISTRY_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  TRUST_PROXY: z.string().optional(),
  LLM_PROVIDER: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
});

/** Fails with the names of what's missing, and never prints a value. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`);
    throw new Error(`Invalid configuration. Run npm run setup:env. Problems: ${problems.join('; ')}`);
  }

  const values = parsed.data;
  const documentMasterKey = Buffer.from(values.DOCUMENT_MASTER_KEY, 'base64');
  if (documentMasterKey.length !== MASTER_KEY_BYTES) {
    throw new Error('Invalid configuration: DOCUMENT_MASTER_KEY must be 32 bytes, base64 encoded');
  }

  return {
    databaseUrl: values.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    // The ignore comments stop Turbopack tracing the whole project, data pack and documents included.
    documentDir: path.resolve(/*turbopackIgnore: true*/ values.DOCUMENT_DIR ?? 'storage/documents'),
    ocrLangDir: path.resolve(/*turbopackIgnore: true*/ values.OCR_LANG_DIR ?? 'storage/ocr'),
    documentMasterKey,
    sessionSecret: values.SESSION_SECRET,
    otpTestCode: values.OTP_TEST_CODE,
    adminToken: values.ADMIN_TOKEN,
    registryServiceToken: values.REGISTRY_SERVICE_TOKEN,
    allowedOrigins: (values.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin !== ''),
    secureCookies: values.COOKIE_SECURE ? values.COOKIE_SECURE !== 'false' : values.NODE_ENV === 'production',
    registryTimeoutMs: values.REGISTRY_TIMEOUT_MS ?? DEFAULT_REGISTRY_TIMEOUT_MS,
    trustProxy: values.TRUST_PROXY === 'true',
    llm: {
      provider: values.LLM_PROVIDER === 'off' || !values.LLM_API_KEY ? 'off' : 'gemini',
      models: (values.LLM_MODEL || DEFAULT_LLM_MODELS)
        .split(',')
        .map((model) => model.trim())
        .filter((model) => model !== ''),
      apiKey: values.LLM_API_KEY || null,
      timeoutMs: values.LLM_TIMEOUT_MS ?? DEFAULT_LLM_TIMEOUT_MS,
    },
  };
}
