/**
 * How does OCR hold up on photos rather than clean PNGs? Simulates phone conditions on the clean
 * specimens and runs each through the real upload pipeline. A simulation, not real phone photos: it
 * shows whether the pipeline copes with JPEG and mild damage, and no more.
 *
 *   npx tsx scripts/ocr-phone-sim.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { assessImageQuality, detectDocumentType, parseAddressProof, parseGstCertificate, parseSignatoryId, parseUdyamCertificate } from '../src/domain/kyc/documents';
import { blurScore } from '../src/server/adapters/images/blur-score';
import { validateUpload } from '../src/server/adapters/images/upload-validation';
import { createTesseractOcr } from '../src/server/adapters/ocr/tesseract-ocr';

const DIR = 'YTL_TrackA_Udyam_Digital_Data/kyc_documents';
const KEYS = ['K02', 'K03', 'K08', 'K09', 'K12'];

const DOCUMENTS = {
  gst_certificate: { type: 'GST_CERTIFICATE', parse: parseGstCertificate },
  udyam_certificate: { type: 'UDYAM_CERTIFICATE', parse: parseUdyamCertificate },
  signatory_id: { type: 'SIGNATORY_ID', parse: parseSignatoryId },
  address_proof: { type: 'ADDRESS_PROOF', parse: parseAddressProof },
} as const;

type Condition = { name: string; apply(image: Sharp): Promise<Buffer> };

const CONDITIONS: readonly Condition[] = [
  { name: 'Clean PNG, the baseline', apply: (image) => image.png().toBuffer() },
  { name: 'JPEG, quality 80', apply: (image) => image.jpeg({ quality: 80 }).toBuffer() },
  { name: 'JPEG, quality 50', apply: (image) => image.jpeg({ quality: 50 }).toBuffer() },
  { name: 'Tilted 2 degrees', apply: (image) => image.rotate(2, { background: '#ffffff' }).jpeg({ quality: 80 }).toBuffer() },
  { name: 'Tilted 5 degrees', apply: (image) => image.rotate(5, { background: '#ffffff' }).jpeg({ quality: 80 }).toBuffer() },
  { name: 'Lower resolution, 800 px wide', apply: (image) => image.resize({ width: 800 }).jpeg({ quality: 80 }).toBuffer() },
  { name: 'Dim light', apply: (image) => image.modulate({ brightness: 0.7 }).jpeg({ quality: 80 }).toBuffer() },
  { name: 'Slightly soft focus', apply: (image) => image.blur(0.8).jpeg({ quality: 80 }).toBuffer() },
];

async function main(): Promise<void> {
  const ocr = createTesseractOcr({ langDir: path.resolve('storage/ocr') });
  const results = new Map<string, { fields: number; right: number; refused: number; wrongType: number; documents: number }>();
  const baseline = new Map<string, Record<string, string>>();

  for (const condition of CONDITIONS) {
    const tally = { fields: 0, right: 0, refused: 0, wrongType: 0, documents: 0 };
    for (const key of KEYS) {
      for (const [file, document] of Object.entries(DOCUMENTS)) {
        const source = path.join(DIR, `${key}_${file}.png`);
        let bytes: Buffer;
        try {
          bytes = readFileSync(source);
        } catch {
          continue;
        }

        const damaged = await condition.apply(sharp(bytes));
        const { image } = await validateUpload(damaged);
        tally.documents += 1;

        const id = `${key}_${file}`;
        if (assessImageQuality(await blurScore(image)) === 'BLURRED') {
          tally.refused += 1;
          tally.fields += Object.keys(baseline.get(id) ?? {}).length;
          continue;
        }

        const { text } = await ocr.read(image);
        if (detectDocumentType(text) !== document.type) {
          tally.wrongType += 1;
          tally.fields += Object.keys(baseline.get(id) ?? {}).length;
          continue;
        }

        const fields = document.parse(text) as unknown as Record<string, string>;
        if (!baseline.has(id)) baseline.set(id, fields);
        for (const [field, value] of Object.entries(baseline.get(id) ?? {})) {
          if (field === 'idNumber' || field === 'designation' || field === 'consumerNumber') continue;
          tally.fields += 1;
          if (fields[field] === value) tally.right += 1;
        }
      }
    }
    results.set(condition.name, tally);
    const percent = tally.fields === 0 ? 0 : Math.round((tally.right / tally.fields) * 1000) / 10;
    console.log(`${condition.name}: ${percent}% of fields same as clean, ${tally.refused} refused as blurred, ${tally.wrongType} not recognised, of ${tally.documents}`);
  }

  await ocr.close();
  writeFileSync('analytics/output/ocr-phone-sim.json', JSON.stringify(Object.fromEntries(results), null, 2));
}

void main();
