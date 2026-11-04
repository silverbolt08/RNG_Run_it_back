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
