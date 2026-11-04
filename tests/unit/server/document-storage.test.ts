import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileDocumentStorage } from '@/server/adapters/storage/file-document-storage';
import { createSealer } from '@/server/crypto/sealer';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function samplePng(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: '#336699' } })
    .png()
    .toBuffer();
}

describe('createSealer', () => {
  const sealer = createSealer(randomBytes(32));

  it('round-trips bytes', () => {
    const plain = Buffer.from('fictional document');
    expect(sealer.open(sealer.seal(plain, 'a'), 'a').equals(plain)).toBe(true);
  });

  it('uses a fresh data key each time, so equal files seal differently', () => {
    const plain = Buffer.from('same');
    expect(sealer.seal(plain, 'a').equals(sealer.seal(plain, 'a'))).toBe(false);
  });

  it('refuses tampered ciphertext', () => {
    const sealed = sealer.seal(Buffer.from('fictional document'), 'a');
    const last = sealed.length - 1;
    sealed.writeUInt8(sealed.readUInt8(last) ^ 0xff, last);
    expect(() => sealer.open(sealed, 'a')).toThrow();
  });

  it('refuses a tampered wrapped key', () => {
    const sealed = sealer.seal(Buffer.from('fictional document'), 'a');
    sealed.writeUInt8(sealed.readUInt8(40) ^ 0xff, 40);
    expect(() => sealer.open(sealed, 'a')).toThrow();
  });

  it('binds a value to its context, so a sealed file cannot be swapped for another', () => {
    const sealed = sealer.seal(Buffer.from('fictional document'), 'a');
    expect(() => sealer.open(sealed, 'b')).toThrow();
  });

  it('refuses a different master key', () => {
    const other = createSealer(randomBytes(32));
    expect(() => other.open(sealer.seal(Buffer.from('x'), 'a'), 'a')).toThrow();
  });

  it('refuses a master key of the wrong length', () => {
    expect(() => createSealer(randomBytes(16))).toThrow(/32 bytes/);
  });

  it('round-trips JSON as text', () => {
    const value = { contactName: 'Fictional Person', gstin: '32TTNXB7384T1ZW' };
    const sealed = sealer.sealJson(value, 'a');
    expect(sealed).not.toContain('Fictional');
    expect(sealed).not.toContain('32TTN');
    expect(sealer.openJson(sealed, 'a')).toEqual(value);
  });
});

describe('file document storage', () => {
  let dir: string;
  const storageFor = (key = randomBytes(32)) => createFileDocumentStorage({ dir, sealer: createSealer(key) });

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'udyam-test-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns the same bytes it was given', async () => {
    const storage = storageFor();
    const image = await samplePng();
    const key = await storage.put(image);
    expect((await storage.get(key)).equals(image)).toBe(true);
  });

  it('stores nothing readable as a plain image', async () => {
    const storage = storageFor();
    const image = await samplePng();
    const key = await storage.put(image);

    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    const stored = readFileSync(path.join(dir, files[0] ?? ''));

    expect(stored.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(false);
    expect(stored.includes(PNG_SIGNATURE)).toBe(false);
    expect(stored.includes(image.subarray(0, 32))).toBe(false);
    await expect(sharp(stored).metadata()).rejects.toThrow();
    expect(key).not.toContain('png');
  });

  it('gives each file a random name unrelated to its content', async () => {
    const storage = storageFor();
    const image = await samplePng();
    const first = await storage.put(image);
    const second = await storage.put(image);
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[a-f0-9]{32}$/);
  });

  it('keeps nothing on disk after delete', async () => {
    const storage = storageFor();
    const key = await storage.put(await samplePng());
    await storage.delete(key);
    expect(readdirSync(dir)).toEqual([]);
    await expect(storage.get(key)).rejects.toThrow();
  });

  it('does not mind deleting a file twice', async () => {
    const storage = storageFor();
    const key = await storage.put(await samplePng());
    await storage.delete(key);
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });

  it.each(['../secret', '..\\secret', 'a/b', 'plain.png', ''])('refuses the path-like key %j', async (key) => {
    const storage = storageFor();
    await expect(storage.get(key)).rejects.toThrow(/storage key/i);
    await expect(storage.delete(key)).rejects.toThrow(/storage key/i);
  });

  it('refuses a file swapped under another name', async () => {
    const storage = storageFor();
    const image = await samplePng();
    const first = await storage.put(image);
    const second = await storage.put(image);
    const firstFile = path.join(dir, `${first}.enc`);
    writeFileSync(path.join(dir, `${second}.enc`), readFileSync(firstFile));
    await expect(storage.get(second)).rejects.toThrow();
  });
});
