import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, validateUpload, UploadRejectedError } from '@/server/adapters/images/upload-validation';
import { hugePagePdf, imageBombPdf, imagePdf, manyImagesPdf, passwordProtectedPdf, slowToDrawPdf, textPdf } from '../../helpers/pdf-fixtures';

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

  describe('PDFs', () => {
    const lines = ['Form GST REG-06', 'Registration Certificate', 'Legal name FICTIONAL TRADERS'];

    it('turns a text PDF into a clean image', async () => {
      const result = await validateUpload(textPdf(lines));
      expect(result.format).toBe('png');
      const { width, height } = await sharp(result.image).metadata();
      // Cropped to the three lines of text, at a size OCR can read.
      expect(Math.min(width, height)).toBeGreaterThanOrEqual(300);
      // Dark marks on a white page, so the text really was drawn.
      const { channels } = await sharp(result.image).stats();
      expect(channels[0]?.min).toBeLessThan(80);
      expect(channels[0]?.max).toBe(255);
    });

    it('turns a scanned PDF into an image of the scan', async () => {
      const jpeg = await sharp({ create: { width: 1000, height: 700, channels: 3, background: '#2040c0' } }).jpeg().toBuffer();
      const { image } = await validateUpload(imagePdf(jpeg, 1000, 700));
      const { width, height } = await sharp(image).metadata();
      expect(width / height).toBeCloseTo(1000 / 700, 1);
      const { dominant } = await sharp(image).stats();
      expect(dominant.b).toBeGreaterThan(dominant.r);
    });

    it('keeps nothing of the PDF but its first page as pixels', async () => {
      const { image } = await validateUpload(textPdf(lines, { author: 'FICTIONAL-AUTHOR-MARKER' }));
      expect(image.includes(Buffer.from('FICTIONAL-AUTHOR-MARKER'))).toBe(false);
      expect(image.includes(Buffer.from('%PDF'))).toBe(false);
    });

    it('crops the blank paper around what is on the page', async () => {
      const { image } = await validateUpload(textPdf(lines));
      const { width, height } = await sharp(image).metadata();
      // A full A4 page at this scale would be about 2000 x 2800.
      expect(height).toBeLessThan(1000);
      expect(Math.min(width, height)).toBeGreaterThanOrEqual(300);
    });

    it('does not fail on a blank page', async () => {
      const blank = textPdf([]);
      expect(await rejectionCode(blank)).toBe('ACCEPTED');
    });

    it('reads only the first page of a longer PDF', async () => {
      const one = await validateUpload(textPdf(lines));
      const many = await validateUpload(textPdf(lines, { pages: 5 }));
      expect(many.image.equals(one.image)).toBe(true);
    });

    it('draws a giant page at a safe size, rather than using gigabytes', async () => {
      const { image } = await validateUpload(hugePagePdf());
      const { width, height } = await sharp(image).metadata();
      expect(width * height).toBeLessThan(10_000_000);
    });

    describe('hostile PDFs', () => {
      // Measures how long this process's own thread goes without a turn while the PDF is being handled.
      async function longestStall(work: () => Promise<unknown>): Promise<number> {
        let last = performance.now();
        let longest = 0;
        const beat = setInterval(() => {
          longest = Math.max(longest, performance.now() - last);
          last = performance.now();
        }, 20);
        await work().catch(() => undefined);
        clearInterval(beat);
        return longest;
      }

      it('a PDF that takes minutes to draw is stopped, and nothing else has to wait', async () => {
        const started = performance.now();
        const code = { value: '' };
        const stall = await longestStall(async () => {
          code.value = await rejectionCode(slowToDrawPdf());
        });
        expect(code.value).toBe('PDF_UNREADABLE');
        expect(performance.now() - started).toBeLessThan(20_000);
        expect(stall).toBeLessThan(1000);
      }, 30_000);

      it('a tiny PDF holding an image of gigabytes has that image skipped, not decoded', async () => {
        const bomb = imageBombPdf();
        expect(bomb.length).toBeLessThan(5000);
        // Decoding it would hit the memory limit and be refused. A page comes back, without the image,
        // and is then treated like any other page with nothing on it.
        expect((await validateUpload(bomb)).format).toBe('png');
      }, 30_000);

      it('a PDF that needs too much memory in total is stopped, and this process stays small', async () => {
        const hungry = manyImagesPdf();
        const before = process.memoryUsage().rss;
        const started = performance.now();
        const code = { value: '' };
        const stall = await longestStall(async () => {
          code.value = await rejectionCode(hungry);
        });
        expect(code.value).toBe('PDF_UNREADABLE');
        // Well before the 15-second limit, so it was the memory limit that stopped it. It takes about
        // 2 seconds to reach. Without that limit it climbs past 6 GB until the time limit ends it.
        expect(performance.now() - started).toBeLessThan(10_000);
        expect(stall).toBeLessThan(1000);
        expect(process.memoryUsage().rss - before).toBeLessThan(500 * 1024 * 1024);
      }, 30_000);

      it('still reads a normal PDF straight after', async () => {
        await rejectionCode(slowToDrawPdf());
        expect((await validateUpload(textPdf(lines))).format).toBe('png');
      }, 40_000);
    });

    it('asks for an unlocked copy of a password-protected PDF', async () => {
      expect(await rejectionCode(passwordProtectedPdf())).toBe('PDF_PROTECTED');
    });

    it.each([
      ['only a header', Buffer.from('%PDF-1.7\n1 0 obj\n')],
      ['garbage after the header', Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(5000, 7)])],
      ['a cut-off file', textPdf(lines).subarray(0, 120)],
    ])('refuses a PDF that is %s, without crashing', async (_label, bytes) => {
      expect(await rejectionCode(bytes)).toBe('PDF_UNREADABLE');
    });

    it('applies the size limit to a PDF too', async () => {
      expect(await rejectionCode(Buffer.concat([textPdf(lines), Buffer.alloc(MAX_UPLOAD_BYTES)]))).toBe('FILE_TOO_LARGE');
    });

    it('goes by content, so a PDF renamed .png is still read as a PDF', async () => {
      const form = new File([new Uint8Array(textPdf(lines))], 'gst.png', { type: 'image/png' });
      const { format } = await validateUpload(Buffer.from(await form.arrayBuffer()));
      expect(format).toBe('png');
    });
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
