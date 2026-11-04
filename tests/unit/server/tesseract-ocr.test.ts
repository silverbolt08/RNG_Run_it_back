import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { detectDocumentType, parseGstCertificate } from '@/domain/kyc/documents';
import { validateUpload } from '@/server/adapters/images/upload-validation';
import { OcrUnavailableError } from '@/server/adapters/ocr/ocr-provider';
import { createTesseractOcr } from '@/server/adapters/ocr/tesseract-ocr';
import { DATA_DIR } from '../../helpers/data-pack';

const LANG_DIR = path.resolve('storage/ocr');
const specimen = (name: string) => path.join(DATA_DIR, 'kyc_documents', name);

describe('tesseract OCR provider', () => {
  it('fails clearly, rather than fetching from a CDN, when the language file is missing', async () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'udyam-test-'));
    const ocr = createTesseractOcr({ langDir: empty });
    await expect(ocr.read(Buffer.from('x'))).rejects.toBeInstanceOf(OcrUnavailableError);
    await ocr.close();
    rmSync(empty, { recursive: true, force: true });
  });

  it('refuses a language path that is a URL, which would leave the machine', () => {
    expect(() => createTesseractOcr({ langDir: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng' })).toThrow(/local/i);
  });

  const hasRealFiles =
    existsSync(path.join(LANG_DIR, 'eng.traineddata')) && existsSync(specimen('K03_gst_certificate.png'));

  describe.skipIf(!hasRealFiles)('on the real specimens', () => {
    const ocr = createTesseractOcr({ langDir: LANG_DIR });
    afterAll(() => ocr.close());

    it('reads a certificate through the watermark, from the local language file', async () => {
      const result = await ocr.read(readFileSync(specimen('K03_gst_certificate.png')));
      expect(detectDocumentType(result.text)).toBe('GST_CERTIFICATE');
      expect(parseGstCertificate(result.text).tradeName).toBe('Ganesh Woodcraft');
      expect(result.confidence).toBeGreaterThan(0);
    }, 60_000);

    it("auto-rotates K02's skewed certificate", async () => {
      const result = await ocr.read(readFileSync(specimen('K02_gst_certificate.png')));
      expect(Math.abs(result.rotationDegrees)).toBeGreaterThan(5);
      expect(parseGstCertificate(result.text).tradeName).toContain('Harmony');
    }, 60_000);

    it("still reads K02's skewed certificate after upload validation re-encodes it", async () => {
      const { image } = await validateUpload(readFileSync(specimen('K02_gst_certificate.png')));
      const result = await ocr.read(image);
      expect(Math.abs(result.rotationDegrees)).toBeGreaterThan(5);
      expect(parseGstCertificate(result.text).gstin).toBe('19E0GXH4115Y1ZL');
    }, 60_000);

    it('handles requests one at a time on the shared worker', async () => {
      const image = readFileSync(specimen('K03_signatory_id.png'));
      const [first, second] = await Promise.all([ocr.read(image), ocr.read(image)]);
      expect(first?.text).toBe(second?.text);
      expect(detectDocumentType(first?.text ?? '')).toBe('SIGNATORY_ID');
    }, 60_000);
  });
});
