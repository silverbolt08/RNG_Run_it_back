import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
// Identifies the layout, so a later change of format can still read older files.
const MAGIC = Buffer.from('UDE1', 'ascii');

export type Sealer = {
  seal(plain: Buffer, context: string): Buffer;
  open(sealed: Buffer, context: string): Buffer;
  sealJson(value: unknown, context: string): string;
  openJson<T>(sealed: string, context: string): T;
};

/**
 * AES-256-GCM with a fresh data key per value, wrapped by the master key. The context, such as a
 * storage key or row ID, is authenticated, so a sealed value can't be moved onto another record.
 */
export function createSealer(masterKey: Buffer): Sealer {
  if (masterKey.length !== KEY_BYTES) throw new Error('The master key must be exactly 32 bytes');

  const seal = (plain: Buffer, context: string): Buffer => {
    const dataKey = randomBytes(KEY_BYTES);
    const aad = Buffer.from(context, 'utf8');
    const wrapped = encrypt(masterKey, dataKey, aad);
    const body = encrypt(dataKey, plain, aad);
    return Buffer.concat([MAGIC, wrapped, body]);
  };

  const open = (sealed: Buffer, context: string): Buffer => {
    if (!sealed.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not a sealed value');
    const aad = Buffer.from(context, 'utf8');
    const wrappedEnd = MAGIC.length + IV_BYTES + TAG_BYTES + KEY_BYTES;
    const dataKey = decrypt(masterKey, sealed.subarray(MAGIC.length, wrappedEnd), aad);
    return decrypt(dataKey, sealed.subarray(wrappedEnd), aad);
  };

  return {
    seal,
    open,
    sealJson: (value, context) => seal(Buffer.from(JSON.stringify(value), 'utf8'), context).toString('base64'),
    openJson: <T>(sealed: string, context: string) =>
      JSON.parse(open(Buffer.from(sealed, 'base64'), context).toString('utf8')) as T,
  };
}

function encrypt(key: Buffer, plain: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function decrypt(key: Buffer, sealed: Buffer, aad: Buffer): Buffer {
  const decipher = createDecipheriv(ALGORITHM, key, sealed.subarray(0, IV_BYTES));
  decipher.setAAD(aad);
  decipher.setAuthTag(sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(sealed.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}
