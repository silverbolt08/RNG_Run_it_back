import type { ConsentPurpose } from '../db/schema/enums';

/** `message` goes to the client, so it must be safe to show. It never holds personal data. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notFound = () => new ApiError(404, 'NOT_FOUND', 'We could not find that.');

export const sessionRequired = () => new ApiError(401, 'SESSION_REQUIRED', 'Your session has ended. Please start again.');

export const consentRequired = (purpose: ConsentPurpose) =>
  new ApiError(403, 'CONSENT_REQUIRED', 'We need your consent before we can do this.', { purpose });

export const phoneVerificationRequired = () =>
  new ApiError(403, 'PHONE_VERIFICATION_REQUIRED', 'Please verify your phone number first.');

export const adminRequired = () => new ApiError(403, 'ADMIN_REQUIRED', 'This action is not permitted.');

export const serviceTokenRequired = () =>
  new ApiError(401, 'SERVICE_TOKEN_REQUIRED', 'This service is for server-to-server calls only.');

export const rateLimited = (retryAfterSeconds: number) =>
  new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please wait a moment and try again.', {}, retryAfterSeconds);

export const invalidRequest = (issues: ReadonlyArray<{ path: string; code: string }> = []) =>
  new ApiError(400, 'INVALID_REQUEST', 'The request is not valid.', { issues });

export const crossSiteRequest = () => new ApiError(403, 'CROSS_SITE_REQUEST', 'This request came from another site.');
