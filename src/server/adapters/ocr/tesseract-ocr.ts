import { existsSync } from 'node:fs';
import path from 'node:path';
import { createWorker, OEM, type Worker } from 'tesseract.js';
import { OcrUnavailableError, type OcrProvider, type OcrResult } from './ocr-provider';

export const LANGUAGE_FILE = 'eng.traineddata';

const RADIANS_TO_DEGREES = 180 / Math.PI;

/**
 * Local OCR, with settings from the measurements in docs/spikes/ocr-accuracy.md: no watermark
 * filter, because it removed parts of characters, and auto-rotation for skewed scans. A single
 * worker is reused, since starting one takes about as long as reading a page.
 *
 * Reads the language file only from a local folder. If it's missing this fails rather than
 * letting tesseract.js fall back to its CDN, because the privacy note says documents stay local.
 */
export function createTesseractOcr(options: { langDir: string }): OcrProvider {
  const langDir = path.resolve(assertLocalPath(options.langDir));
  let worker: Promise<Worker> | null = null;
  // A tesseract worker runs one job at a time, so requests take turns.
  let queue: Promise<unknown> = Promise.resolve();

  const getWorker = (): Promise<Worker> => {
    if (worker) return worker;
    if (!existsSync(path.join(langDir, LANGUAGE_FILE))) {
      throw new OcrUnavailableError('The OCR language file is missing. Run npm run setup:ocr.');
    }
    worker = createWorker('eng', OEM.LSTM_ONLY, {
      langPath: langDir,
      gzip: false,
      // 'none' reads from langPath only and writes no copy to the working folder.
      cacheMethod: 'none',
      // The default handler throws an uncaught error, which would stop the server.
      errorHandler: () => undefined,
    });
    return worker;
  };

  const run = async (image: Buffer): Promise<OcrResult> => {
    try {
      const active = await getWorker();
      const { data } = await active.recognize(image, { rotateAuto: true }, { text: true });
      return {
        text: data.text,
        confidence: data.confidence,
        rotationDegrees: (data.rotateRadians ?? 0) * RADIANS_TO_DEGREES,
      };
    } catch (error) {
      worker = null;
      if (error instanceof OcrUnavailableError) throw error;
      // Tesseract's own message can quote the document, so only a fixed reason goes further.
      throw new OcrUnavailableError('The OCR engine failed.');
    }
  };

  return {
    read: (image) => {
      const result = queue.then(() => run(image));
      queue = result.catch(() => undefined);
      return result;
    },
    close: async () => {
      const active = worker;
      worker = null;
      if (active) await (await active).terminate();
    },
  };
}

function assertLocalPath(value: string): string {
  if (/^[a-z][a-z0-9+.-]+:\/\//i.test(value)) {
    throw new Error('The OCR language path must be a local folder, so documents and models stay on this machine');
  }
  return value;
}
