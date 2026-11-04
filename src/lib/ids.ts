import { randomBytes } from 'node:crypto';

const ID_BYTES = 16;

/** A random public ID, so one object's ID says nothing about any other. */
export function newPublicId(prefix: string): string {
  return `${prefix}_${randomBytes(ID_BYTES).toString('base64url')}`;
}

export function newRequestId(): string {
  return newPublicId('req');
}
