import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '@/server/config';
import nextConfig from '../../../next.config';

const VALID_ENV = {
  DOCUMENT_MASTER_KEY: randomBytes(32).toString('base64'),
  SESSION_SECRET: 'x'.repeat(40),
  OTP_TEST_CODE: '000000',
  ADMIN_TOKEN: 'an-admin-token',
  REGISTRY_SERVICE_TOKEN: 'a-service-token',
};

describe('configuration', () => {
  it('loads a valid environment', () => {
    const config = loadConfig(VALID_ENV);
    expect(config.documentMasterKey).toHaveLength(32);
    expect(config.otpTestCode).toBe('000000');
    expect(config.allowedOrigins).toEqual([]);
  });

  it.each(Object.keys(VALID_ENV))('refuses to start without %s, naming it but not its value', (name) => {
    const env: Record<string, string | undefined> = { ...VALID_ENV, [name]: undefined };
    expect(() => loadConfig(env)).toThrow(name);
    try {
      loadConfig(env);
    } catch (error) {
      for (const value of Object.values(VALID_ENV)) {
        expect(String(error)).not.toContain(value);
      }
    }
  });

  it('refuses a master key of the wrong length', () => {
    expect(() => loadConfig({ ...VALID_ENV, DOCUMENT_MASTER_KEY: randomBytes(16).toString('base64') })).toThrow(/32 bytes/);
  });

  it('turns on secure cookies in production, unless switched off', () => {
    expect(loadConfig({ ...VALID_ENV, NODE_ENV: 'production' }).secureCookies).toBe(true);
    expect(loadConfig({ ...VALID_ENV, NODE_ENV: 'development' }).secureCookies).toBe(false);
    expect(loadConfig({ ...VALID_ENV, NODE_ENV: 'production', COOKIE_SECURE: 'false' }).secureCookies).toBe(false);
  });

  it('reads allowed origins as a list', () => {
    expect(loadConfig({ ...VALID_ENV, ALLOWED_ORIGINS: 'https://a.example, https://b.example' }).allowedOrigins).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('keeps every secret out of .env.example', () => {
    const example = readFileSync('.env.example', 'utf8');
    for (const name of ['SESSION_SECRET', 'DOCUMENT_MASTER_KEY', 'ADMIN_TOKEN', 'REGISTRY_SERVICE_TOKEN', 'LLM_API_KEY']) {
      expect(example).toMatch(new RegExp(`^${name}=$`, 'm'));
    }
  });

  it('names the LLM settings without tying them to any provider', () => {
    const example = readFileSync('.env.example', 'utf8');
    for (const name of ['LLM_PROVIDER', 'LLM_MODEL', 'LLM_API_KEY']) {
      expect(example).toMatch(new RegExp(`^${name}=$`, 'm'));
    }
    expect(example).not.toMatch(/anthropic|claude|gemini|ollama/i);
  });

  it('keeps the LlmProvider interface free of any provider', () => {
    expect(readFileSync('src/server/llm/provider.ts', 'utf8')).not.toMatch(/anthropic|claude|gemini|ollama|openai/i);
  });
});

describe('security headers', () => {
  const headersFor = async (source: string) => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const rule = rules.find((item) => item.source === source);
    return Object.fromEntries((rule?.headers ?? []).map((header) => [header.key.toLowerCase(), header.value]));
  };

  it('sets the baseline on every route', async () => {
    const headers = await headersFor('/:path*');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toEqual(expect.any(String));
    expect(headers['strict-transport-security']).toContain('max-age=');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-frame-options']).toBe('DENY');
  });

  it('locks API responses down further, because they are never rendered', async () => {
    const headers = await headersFor('/api/:path*');
    expect(headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('keeps the native packages out of the bundle', () => {
    expect(nextConfig.serverExternalPackages).toEqual(expect.arrayContaining(['sharp', 'tesseract.js']));
  });

  it('turns off the framework banner', () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
