import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from 'vitest';
import { TEST_ADMIN_TOKEN, TEST_OTP_CODE, TEST_SERVICE_TOKEN } from './test-app';

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

type RouteModule = Partial<Record<'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', Handler>>;

type RouteEntry = { pattern: RegExp; paramNames: string[]; load: () => Promise<RouteModule>; file: string };

const API_ROOT = path.resolve('src/app/api');

/** Every route.ts on disk, matched by the same folder convention Next.js uses. */
export function listRouteFiles(): string[] {
  return readdirSync(API_ROOT, { recursive: true, encoding: 'utf8' })
    .filter((file) => path.basename(file) === 'route.ts')
    .map((file) => path.join(API_ROOT, file));
}

function buildRoutes(): RouteEntry[] {
  return listRouteFiles().map((file) => {
    const segments = path.relative(API_ROOT, path.dirname(file)).split(path.sep);
    const paramNames: string[] = [];
    const parts = segments.map((segment) => {
      const param = /^\[(.+)\]$/.exec(segment)?.[1];
      if (!param) return segment;
      paramNames.push(param);
      return '([^/]+)';
    });
    return {
      file,
      paramNames,
      pattern: new RegExp(`^/api/${parts.join('/')}$`),
      load: () => import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<RouteModule>,
    };
  });
}

const ROUTES = buildRoutes();

export type ApiResponse = {
  status: number;
  // The shape varies by endpoint, and each test asserts the fields it cares about.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  headers: Headers;
};

type RequestOptions = { body?: unknown; raw?: string; form?: FormData; headers?: Record<string, string> };

/** Calls the real route handlers the way a browser would, with a cookie jar. */
export class ApiClient {
  cookie: string | null = null;

  async request(method: keyof RouteModule, url: string, options: RequestOptions = {}): Promise<ApiResponse> {
    const { pathname } = new URL(url, 'http://localhost');
    const route = ROUTES.find((entry) => entry.pattern.test(pathname));
    if (!route) throw new Error(`No route.ts serves ${pathname}`);

    const handler = (await route.load())[method];
    if (!handler) return { status: 405, body: null, headers: new Headers() };

    const match = route.pattern.exec(pathname);
    const params = Object.fromEntries(
      route.paramNames.map((name, index) => [name, decodeURIComponent(match?.[index + 1] ?? '')]),
    );

    const headers = new Headers(options.headers);
    if (this.cookie) headers.set('cookie', this.cookie);
    let requestBody: BodyInit | undefined;
    if (options.form) {
      requestBody = options.form;
    } else if (options.raw !== undefined) {
      headers.set('content-type', 'application/json');
      requestBody = options.raw;
    } else if (options.body !== undefined) {
      headers.set('content-type', 'application/json');
      requestBody = JSON.stringify(options.body);
    }

    const response = await handler(
      new Request(`http://localhost${url}`, { method, headers, body: requestBody }),
      { params: Promise.resolve(params) },
    );

    this.applySetCookie(response.headers.get('set-cookie'));
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  }

  get(url: string, options?: RequestOptions) {
    return this.request('GET', url, options);
  }
  post(url: string, body?: unknown, options?: RequestOptions) {
    return this.request('POST', url, { body, ...options });
  }
  put(url: string, body?: unknown, options?: RequestOptions) {
    return this.request('PUT', url, { body, ...options });
  }
  delete(url: string, options?: RequestOptions) {
    return this.request('DELETE', url, options);
  }

  admin(method: keyof RouteModule, url: string, body?: unknown) {
    return this.request(method, url, { body, headers: { 'x-admin-token': TEST_ADMIN_TOKEN } });
  }
  service(url: string) {
    return this.request('GET', url, { headers: { 'x-service-token': TEST_SERVICE_TOKEN } });
  }

  private applySetCookie(value: string | null): void {
    if (!value) return;
    const pair = value.split(';')[0] ?? '';
    const [name, ...rest] = pair.split('=');
    const cookieValue = rest.join('=');
    this.cookie = cookieValue === '' ? null : `${name}=${cookieValue}`;
  }
}

/** A browser that has just opened the site. */
export async function newVisitor(): Promise<ApiClient> {
  const client = new ApiClient();
  const response = await client.post('/api/v1/sessions');
  expect(response.status).toBe(201);
  return client;
}

/** Grants a consent with the notice version the server currently shows. */
export async function grant(client: ApiClient, purpose: string): Promise<ApiResponse> {
  const list = await client.get('/api/v1/consents');
  const entry = list.body.items.find((item: { purpose: string }) => item.purpose === purpose);
  const response = await client.post('/api/v1/consents', {
    purpose,
    noticeVersion: entry.currentNoticeVersion,
    language: 'en',
  });
  expect(response.status).toBe(201);
  return response;
}

export async function verifyPhone(client: ApiClient, phone = '9876541234'): Promise<void> {
  const challenge = await client.post('/api/v1/sessions/otp-requests', { phone });
  expect(challenge.status).toBe(201);
  const verified = await client.post('/api/v1/sessions/otp-verifications', {
    challengeId: challenge.body.challengeId,
    code: TEST_OTP_CODE,
  });
  expect(verified.status).toBe(200);
}

export function expectApiError(response: ApiResponse, status: number, code: string): void {
  expect(response.body?.error?.code, JSON.stringify(response.body)).toBe(code);
  expect(response.status).toBe(status);
  expect(typeof response.body.error.message).toBe('string');
  expect(response.body.error.details).toBeTypeOf('object');
  expect(response.body.error.requestId).toMatch(/^req_/);
  expect(Object.keys(response.body.error).sort()).toEqual(['code', 'details', 'message', 'requestId']);
}
