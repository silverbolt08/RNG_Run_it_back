import { timingSafeEqual } from 'node:crypto';
import { newRequestId } from '../../lib/ids';
import { createLogger, type Logger } from '../../lib/logger';
import { isOcrUnavailable } from '../adapters/ocr/ocr-provider';
import { UploadRejectedError } from '../adapters/images/upload-validation';
import { getAppContext, type AppContext } from '../app-context';
import { readSessionCookie } from '../auth/session-cookie';
import { resolveSession, type SessionInfo } from '../auth/session-service';
import { hasActiveConsent } from '../consent/consent-service';
import type { ConsentPurpose } from '../db/schema/enums';
import {
  adminRequired,
  ApiError,
  consentRequired,
  crossSiteRequest,
  phoneVerificationRequired,
  rateLimited,
  serviceTokenRequired,
  sessionRequired,
} from './errors';
import type { RateLimitRule } from './rate-limiter';
import { json } from './response';

export type RouteParams = Record<string, string>;

/** The signature Next.js calls, with the params promise it passes since version 15. */
export type RouteHandler<P extends RouteParams> = (request: Request, context: { params: Promise<P> }) => Promise<Response>;

export type RouteContext<P extends RouteParams> = {
  app: AppContext;
  request: Request;
  params: P;
  requestId: string;
};

export type SessionRouteContext<P extends RouteParams> = RouteContext<P> & { session: SessionInfo };

type SessionRouteOptions = {
  consent?: ConsentPurpose;
  verifiedPhone?: boolean;
  rateLimit?: { name: string; rule: RateLimitRule };
};

const FALLBACK_LOGGER: Logger = createLogger();

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Default deny: every route.ts export must come from one of these factories, and each one states
// who it lets in. tests/integration/api/route-guards.test.ts fails on any route that doesn't.

/** Open to anyone, for what holds no personal data, such as the catalogue. */
export function publicRoute<P extends RouteParams = RouteParams>(
  name: string,
  handler: (context: RouteContext<P>) => Promise<Response>,
): RouteHandler<P> {
  return wrap(name, (context) => handler(context));
}

/** Needs a valid session, then checks rate limit, verified phone and consent, in that order. */
export function sessionRoute<P extends RouteParams = RouteParams>(
  name: string,
  options: SessionRouteOptions,
  handler: (context: SessionRouteContext<P>) => Promise<Response>,
): RouteHandler<P> {
  return wrap(name, async (context, logFields) => {
    const session = await requireSession(context.app, context.request);
    logFields.subjectRef = session.subjectRef;

    if (options.rateLimit) {
      enforceRateLimit(context.app, `${options.rateLimit.name}:${session.sessionId}`, options.rateLimit.rule);
    }
    if (options.verifiedPhone && !session.phoneVerified) throw phoneVerificationRequired();
    // Checked here, before any handler reads the body, so a request without consent stores nothing.
    if (options.consent && !(await hasActiveConsent(context.app, session.subjectRef, options.consent))) {
      throw consentRequired(options.consent);
    }
    return handler({ ...context, session });
  });
}

/** For simulation controls. Denies everyone if no token is configured. */
export function adminRoute<P extends RouteParams = RouteParams>(
  name: string,
  handler: (context: RouteContext<P>) => Promise<Response>,
): RouteHandler<P> {
  return wrap(name, (context) => {
    if (!tokenMatches(context.request.headers.get('x-admin-token'), context.app.config.adminToken)) {
      throw adminRequired();
    }
    return handler(context);
  });
}

/** Server-to-server only. A browser never holds this token. */
export function serviceRoute<P extends RouteParams = RouteParams>(
  name: string,
  options: { rateLimit?: { name: string; rule: RateLimitRule } },
  handler: (context: RouteContext<P>) => Promise<Response>,
): RouteHandler<P> {
  return wrap(name, (context) => {
    if (!tokenMatches(context.request.headers.get('x-service-token'), context.app.config.registryServiceToken)) {
      throw serviceTokenRequired();
    }
    if (options.rateLimit) enforceRateLimit(context.app, options.rateLimit.name, options.rateLimit.rule);
    return handler(context);
  });
}

export function enforceRateLimit(app: AppContext, key: string, rule: RateLimitRule): void {
  const retryAfter = app.rateLimiter.hit(key, rule);
  if (retryAfter !== null) throw rateLimited(retryAfter);
}

export function clientAddress(app: AppContext, request: Request): string {
  if (!app.config.trustProxy) return 'local';
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

function wrap<P extends RouteParams>(
  name: string,
  run: (context: RouteContext<P>, logFields: { subjectRef?: string }) => Promise<Response>,
): RouteHandler<P> {
  return async (request, nextContext) => {
    const started = performance.now();
    const requestId = newRequestId();
    const logFields: { subjectRef?: string } = {};
    let logger = FALLBACK_LOGGER;
    let response: Response;

    try {
      const app = await getAppContext();
      logger = app.logger;
      assertSameSite(request, app);
      response = await run({ app, request, params: await nextContext.params, requestId }, logFields);
    } catch (error) {
      response = toErrorResponse(error, requestId, name, logger);
    }

    response.headers.set('x-request-id', requestId);
    response.headers.set('cache-control', 'no-store');
    // The route's name, never its URL, because a URL can hold an identifier.
    logger.info('api.request', {
      route: name,
      status: response.status,
      durationMs: Math.round(performance.now() - started),
      requestId,
      ...logFields,
    });
    return response;
  };
}

async function requireSession(app: AppContext, request: Request): Promise<SessionInfo> {
  const value = readSessionCookie(request.headers.get('cookie'));
  const session = value ? await resolveSession(app, value) : null;
  if (!session) throw sessionRequired();
  return session;
}

/** CSRF defence alongside SameSite=Lax: a browser always sends Origin on a cross-site write. */
function assertSameSite(request: Request, app: AppContext): void {
  if (!WRITE_METHODS.has(request.method)) return;

  const origin = request.headers.get('origin');
  if (!origin) return;

  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw crossSiteRequest();
  }
  if (originHost !== host && !app.config.allowedOrigins.includes(origin)) throw crossSiteRequest();
}

function tokenMatches(supplied: string | null, expected: string): boolean {
  if (!supplied || !expected) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function errorBody(requestId: string, code: string, message: string, details: Record<string, unknown>) {
  return { error: { code, message, details, requestId } };
}

function toErrorResponse(error: unknown, requestId: string, route: string, logger: Logger): Response {
  if (error instanceof ApiError) {
    const headers: Record<string, string> =
      error.retryAfterSeconds === undefined ? {} : { 'retry-after': String(error.retryAfterSeconds) };
    return json(errorBody(requestId, error.code, error.message, error.details), error.status, headers);
  }
  if (error instanceof UploadRejectedError) {
    return json(errorBody(requestId, error.code, UPLOAD_MESSAGES[error.code], {}), 422);
  }
  if (isOcrUnavailable(error)) {
    logger.error('ocr.unavailable', { requestId, route, error });
    return json(errorBody(requestId, 'OCR_UNAVAILABLE', 'We could not read documents just now. Please try again.', {}), 503);
  }
  logger.error('api.failure', { requestId, route, error });
  return json(errorBody(requestId, 'INTERNAL_ERROR', 'Something went wrong on our side. Your progress is saved.', {}), 500);
}

const UPLOAD_MESSAGES: Record<UploadRejectedError['code'], string> = {
  FILE_TOO_LARGE: 'This file is over the 10 MB limit. Please use a smaller photo.',
  UNSUPPORTED_FILE_TYPE: 'Please upload a photo or a PDF.',
  PDF_PROTECTED: 'This PDF is locked with a password. Please upload an unlocked copy, or a photo of the document.',
  PDF_UNREADABLE: 'We could not open this PDF. Please try downloading it again, or upload a photo of the document.',
  UNREADABLE_IMAGE: 'We could not open this image. Please try a different photo.',
  IMAGE_TOO_LARGE: 'This image has too many pixels. Please use a smaller photo.',
  IMAGE_TOO_SMALL: 'This image is too small to read. Please take a closer photo.',
};
