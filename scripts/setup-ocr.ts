import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

// The file the OCR spike measured, which is what tesseract.js fetches by default for LSTM.
// Fetched once here at setup, so that nothing is fetched at runtime.
const SOURCE_URL = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz';
const EXPECTED_SHA256 = '5dc5d8d640a212c9d6184921ba103b186f50e0fed9ee716c53e6b312b400d747';

const FILE_NAME = 'eng.traineddata';

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function main(): Promise<void> {
  const dir = path.resolve(process.env.OCR_LANG_DIR ?? 'storage/ocr');
  const target = path.join(dir, FILE_NAME);

  if (existsSync(target) && sha256(readFileSync(target)) === EXPECTED_SHA256) {
    console.log(`OCR language file is already in place at ${target}`);
    return;
  }

  console.log(`Downloading the OCR language file from ${SOURCE_URL}`);
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`Download failed with status ${response.status}`);

  const data = gunzipSync(Buffer.from(await response.arrayBuffer()));
  const hash = sha256(data);
  if (hash !== EXPECTED_SHA256) throw new Error(`Downloaded file has an unexpected hash: ${hash}`);

  mkdirSync(dir, { recursive: true });
  writeFileSync(target, data);
  console.log(`OCR language file written to ${target} (${data.length} bytes)`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
