import sharp from 'sharp';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// A 40 MP limit is above any phone photo we'd expect, and stops a small file that expands to gigabytes.
const MAX_INPUT_PIXELS = 40_000_000;
// Assumption: below this, OCR can't read document text. The smallest specimen is 1012 x 638.
const MIN_SHORT_SIDE_PX = 300;

const JPEG_QUALITY = 90;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');
const PNG_DENSITY_CHUNK = 'pHYs';
// Each PNG chunk has a 4-byte length, a 4-byte type and a 4-byte checksum around its data.
const PNG_CHUNK_OVERHEAD_BYTES = 12;

export type UploadRejectionCode =
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'PDF_NOT_SUPPORTED'
  | 'UNREADABLE_IMAGE'
  | 'IMAGE_TOO_LARGE'
  | 'IMAGE_TOO_SMALL';

export class UploadRejectedError extends Error {
  constructor(readonly code: UploadRejectionCode) {
    super(code);
    this.name = 'UploadRejectedError';
  }
}

export type ValidatedUpload = { image: Buffer; format: 'png' | 'jpeg' };

/**
 * Checks the bytes rather than what the file claims to be, then re-encodes through sharp. Only
 * decoded pixels survive that, so EXIF location data and any embedded payload are left behind.
 */
export async function validateUpload(bytes: Buffer): Promise<ValidatedUpload> {
  if (bytes.length > MAX_UPLOAD_BYTES) throw new UploadRejectedError('FILE_TOO_LARGE');

  // sharp's prebuilt binaries have no PDF support, and adding one means a heavy native dependency.
  if (startsWith(bytes, PDF_MAGIC)) throw new UploadRejectedError('PDF_NOT_SUPPORTED');
  const format = detectFormat(bytes);
  if (!format) throw new UploadRejectedError('UNSUPPORTED_FILE_TYPE');

  const metadata = await readMetadata(bytes);
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width * height > MAX_INPUT_PIXELS) throw new UploadRejectedError('IMAGE_TOO_LARGE');
  if (Math.min(width, height) < MIN_SHORT_SIDE_PX) throw new UploadRejectedError('IMAGE_TOO_SMALL');

  return { image: await reencode(bytes, format), format };
}

function detectFormat(bytes: Buffer): ValidatedUpload['format'] | null {
  if (startsWith(bytes, PNG_MAGIC)) return 'png';
  if (startsWith(bytes, JPEG_MAGIC)) return 'jpeg';
  return null;
}

function startsWith(bytes: Buffer, magic: Buffer): boolean {
  return bytes.length >= magic.length && bytes.subarray(0, magic.length).equals(magic);
}

async function readMetadata(bytes: Buffer) {
  try {
    // Reading the header decodes no pixels, so the count can be checked before a bomb expands.
    return await sharp(bytes, { limitInputPixels: false }).metadata();
  } catch {
    throw new UploadRejectedError('UNREADABLE_IMAGE');
  }
}

async function reencode(bytes: Buffer, format: ValidatedUpload['format']): Promise<Buffer> {
  try {
    // `rotate` applies the camera's orientation before the tag is dropped, so photos stay upright.
    const pipeline = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).rotate();
    if (format === 'png') return removePngChunk(await pipeline.png().toBuffer(), PNG_DENSITY_CHUNK);
    return await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();
  } catch {
    throw new UploadRejectedError('UNREADABLE_IMAGE');
  }
}

/**
 * sharp always writes a 72 dpi density tag. Tesseract believes it, and at 72 dpi its layout
 * analysis measures K02's -6.9 degree skew as 0, which garbles the GSTIN. With no tag it estimates
 * the resolution from the page, which is how the OCR accuracy was measured.
 */
function removePngChunk(png: Buffer, type: string): Buffer {
  const kept: Buffer[] = [png.subarray(0, PNG_MAGIC.length)];
  let offset = PNG_MAGIC.length;
  while (offset < png.length) {
    const end = offset + PNG_CHUNK_OVERHEAD_BYTES + png.readUInt32BE(offset);
    if (png.toString('latin1', offset + 4, offset + 8) !== type) kept.push(png.subarray(offset, end));
    offset = end;
  }
  return Buffer.concat(kept);
}
