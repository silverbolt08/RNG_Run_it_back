import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, validateUpload, UploadRejectedError } from '@/server/adapters/images/upload-validation';

async function photo(format: 'png' | 'jpeg', width = 800, height = 600): Promise<Buffer> {
  const image = sharp({ create: { width, height, channels: 3, background: '#88aacc' } });
  return format === 'png' ? image.png().toBuffer() : image.jpeg().toBuffer();
}

async function rejectionCode(bytes: Buffer): Promise<string> {
  try {
    await validateUpload(bytes);
  } catch (error) {
    if (error instanceof UploadRejectedError) return error.code;
    throw error;
  }
  return 'ACCEPTED';
}

describe('validateUpload', () => {
  it.each(['png', 'jpeg'] as const)('accepts a %s and re-encodes it to the same format', async (format) => {
    const result = await validateUpload(await photo(format));
    expect(result.format).toBe(format);
    expect((await sharp(result.image).metadata()).format).toBe(format);
  });

  it('strips EXIF, including location', async () => {
    const withExif = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#88aacc' } })
      .withExif({ IFD3: { GPSLatitude: '19/1 4/1 0/1', GPSLongitude: '72/1 52/1 0/1' }, IFD0: { Copyright: 'FICTIONAL-MARKER' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const { image } = await validateUpload(withExif);
    expect((await sharp(image).metadata()).exif).toBeUndefined();
    expect(image.includes(Buffer.from('FICTIONAL-MARKER'))).toBe(false);
  });

  it('applies the camera orientation before removing it, so a phone photo stays upright', async () => {
    const sideways = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#88aacc' } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const { image } = await validateUpload(sideways);
    const metadata = await sharp(image).metadata();
    expect([metadata.width, metadata.height]).toEqual([600, 800]);
  });

  it('drops the density tag sharp adds to a PNG, because a 72 dpi tag stops OCR detecting skew', async () => {
    const { image } = await validateUpload(await photo('png'));
    expect(image.includes(Buffer.from('pHYs', 'latin1'))).toBe(false);
    // Still a valid PNG, with the same picture in it.
    expect((await sharp(image).metadata()).format).toBe('png');
    const pixels = await sharp(image).raw().toBuffer();
    expect(pixels.equals(await sharp(await photo('png')).raw().toBuffer())).toBe(true);
  });

  it('removes a payload appended after the image', async () => {
    const payload = Buffer.from('<script>alert(1)</script>');
    const { image } = await validateUpload(Buffer.concat([await photo('png'), payload]));
    expect(image.includes(payload)).toBe(false);
  });

  it('rejects a PDF clearly, because it cannot be rasterised without a heavy new dependency', async () => {
    expect(await rejectionCode(Buffer.from('%PDF-1.7\n1 0 obj\n'))).toBe('PDF_NOT_SUPPORTED');
  });

  it.each([
    ['SVG', '<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
    ['HTML', '<!doctype html><html></html>'],
    ['plain text', 'hello'],
    ['an empty file', ''],
  ])('rejects %s by its content', async (_label, content) => {
    expect(await rejectionCode(Buffer.from(content))).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('ignores what a file claims to be and reads its magic bytes', async () => {
    const script = Buffer.from('MZ fake executable named photo.png');
    expect(await rejectionCode(script)).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('rejects a file over 10 MB', async () => {
    const big = Buffer.concat([await photo('png'), Buffer.alloc(MAX_UPLOAD_BYTES)]);
    expect(await rejectionCode(big)).toBe('FILE_TOO_LARGE');
  });

  it('accepts a file exactly at the limit', async () => {
    const image = await photo('png');
    const padded = Buffer.concat([image, Buffer.alloc(MAX_UPLOAD_BYTES - image.length)]);
    expect(await rejectionCode(padded)).toBe('ACCEPTED');
  });

  it('rejects a decompression bomb by its pixel count', async () => {
    const bomb = await sharp({ create: { width: 9000, height: 9000, channels: 3, background: '#000000' } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(MAX_UPLOAD_BYTES);
    expect(await rejectionCode(bomb)).toBe('IMAGE_TOO_LARGE');
  }, 30_000);

  it('rejects an image too small to read', async () => {
    expect(await rejectionCode(await photo('png', 200, 150))).toBe('IMAGE_TOO_SMALL');
  });

  it('rejects a file that only starts like an image', async () => {
    const corrupt = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('not really')]);
    expect(await rejectionCode(corrupt)).toBe('UNREADABLE_IMAGE');
  });
});
