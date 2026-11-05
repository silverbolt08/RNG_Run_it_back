import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assessImageQuality, parseAddressProof, parseGstCertificate, parseSignatoryId, parseUdyamCertificate } from '@/domain/kyc/documents';
import { blurScore } from '@/server/adapters/images/blur-score';
import { validateUpload } from '@/server/adapters/images/upload-validation';
import type { OcrProvider } from '@/server/adapters/ocr/ocr-provider';
import { createTesseractOcr } from '@/server/adapters/ocr/tesseract-ocr';
import { imagePdf, onA4Pdf, textPdf } from '../helpers/pdf-fixtures';
import { applicant } from '../helpers/specimens';

const SPECIMENS = path.resolve('YTL_TrackA_Udyam_Digital_Data/kyc_documents');
const LANG_DIR = path.resolve('storage/ocr');
const ready = existsSync(path.join(SPECIMENS, 'K03_gst_certificate.png')) && existsSync(path.join(LANG_DIR, 'eng.traineddata'));

const DOCUMENTS = [
  ['gst_certificate', parseGstCertificate],
  ['udyam_certificate', parseUdyamCertificate],
  ['signatory_id', parseSignatoryId],
  ['address_proof', parseAddressProof],
] as const;

/** The same page, wrapped in a PDF the way a scanner or a phone's "save as PDF" would. */
async function asPdf(png: Buffer): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(png).metadata();
  return imagePdf(await sharp(png).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer(), width, height);
}

describe.skipIf(!ready)('a certificate sent as a PDF reads the same as the image', () => {
  let ocr: OcrProvider;

  beforeAll(() => {
    ocr = createTesseractOcr({ langDir: LANG_DIR });
  });
  afterAll(() => ocr.close());

  for (const key of ['K03', 'K12']) {
    for (const [file, parse] of DOCUMENTS) {
      const source = path.join(SPECIMENS, `${key}_${file}.png`);
      it.skipIf(!existsSync(source))(`scanned: ${key} ${file}`, async () => {
        const png = readFileSync(source);
        const direct = await ocr.read((await validateUpload(png)).image);
        const viaPdf = await ocr.read((await validateUpload(await asPdf(png))).image);
        expect(parse(viaPdf.text)).toEqual(parse(direct.text));
      }, 60_000);
    }
  }

  // Mostly blank paper looks "smooth", so this mustn't read as blurred, and the card must still read.
  it('an ID card scanned onto a blank A4 page', async () => {
    const png = readFileSync(path.join(SPECIMENS, 'K03_signatory_id.png'));
    const { width = 0, height = 0 } = await sharp(png).metadata();
    const jpeg = await sharp(png).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer();
    const { image } = await validateUpload(onA4Pdf(jpeg, width, height));

    expect(assessImageQuality(await blurScore(image))).toBe('OK');
    const direct = await ocr.read((await validateUpload(png)).image);
    expect(parseSignatoryId((await ocr.read(image)).text)).toEqual(parseSignatoryId(direct.text));
  }, 60_000);

  // The kind the GST portal gives: real text in a font, with no scan involved.
  it.each(['K03', 'K08', 'K12'])('text PDF: %s GST certificate', async (key) => {
    const text = applicant(key).documents.gst?.text ?? '';
    const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
    const { image } = await validateUpload(textPdf(lines));
    expect(assessImageQuality(await blurScore(image))).toBe('OK');

    const read = parseGstCertificate((await ocr.read(image)).text);
    const expected = parseGstCertificate(text);
    expect(read.gstin).toBe(expected.gstin);
    expect(read.legalName).toBe(expected.legalName);
    expect(read.tradeName).toBe(expected.tradeName);
  }, 60_000);
});

describe.skipIf(!ready)('the blur check treats a scanned PDF as it treats the image', () => {
  // One document per applicant keeps this quick. All 47 specimens agreed when run once, as the OCR note records.
  const files = ready ? readdirSync(SPECIMENS).filter((name) => name.endsWith('_gst_certificate.png')) : [];

  it.each(files)('%s', async (file) => {
    const png = readFileSync(path.join(SPECIMENS, file));
    const direct = assessImageQuality(await blurScore((await validateUpload(png)).image));
    const viaPdf = assessImageQuality(await blurScore((await validateUpload(await asPdf(png))).image));
    expect(viaPdf).toBe(direct);
  }, 30_000);
});
