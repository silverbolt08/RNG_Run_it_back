import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'udyam_session';

export function signToken(token: string, secret: string): string {
  return `${token}.${signature(token, secret)}`;
}

/** Returns the token only if its signature is right, so a forged cookie never reaches the database. */
export function verifySignedToken(value: string, secret: string): string | null {
  const separator = value.lastIndexOf('.');
  if (separator <= 0) return null;

  const token = value.slice(0, separator);
  const supplied = Buffer.from(value.slice(separator + 1));
  const expected = Buffer.from(signature(token, secret));
  return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? token : null;
}

export function readSessionCookie(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=') || null;
  }
  return null;
}

export function sessionCookieHeader(value: string, options: { secure: boolean; maxAgeSeconds: number }): string {
  const secure = options.secure ? '; Secure' : '';
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${options.maxAgeSeconds}${secure}`;
}

export function clearedSessionCookieHeader(options: { secure: boolean }): string {
  return sessionCookieHeader('', { ...options, maxAgeSeconds: 0 });
}

function signature(token: string, secret: string): string {
  return createHmac('sha256', secret).update(`session:${token}`).digest('base64url');
}
