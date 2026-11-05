export type OcrResult = { text: string; confidence: number; rotationDegrees: number };

/** Reads text from an image. OCR text is untrusted and must never be logged or sent to the LLM. */
export interface OcrProvider {
  read(image: Buffer): Promise<OcrResult>;
  close(): Promise<void>;
}

/** A dependency failure rather than a bad document, so the client can retry. */
export class OcrUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'OcrUnavailableError';
  }
}

/**
 * By name, not instanceof: Next.js can load the shared OCR client and each route as separate copies of
 * this module, and a class from one copy isn't an instance of the class from another.
 */
export function isOcrUnavailable(error: unknown): error is OcrUnavailableError {
  return error instanceof Error && error.name === 'OcrUnavailableError';
}
