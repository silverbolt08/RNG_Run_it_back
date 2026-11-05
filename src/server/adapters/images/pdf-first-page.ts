import { spawn } from 'node:child_process';
import path from 'node:path';

/**
 * OCR reads images, so a PDF becomes a picture of its first page here. Certificates carry what we
 * check on page one, and only pixels come back, so what else is in the file (attachments, scripts,
 * metadata, later pages) isn't stored. A hash of the upload is kept, as for a photo, to spot a repeat.
 *
 * The drawing happens in a separate process, because a PDF of a kilobyte can hold a thread for
 * minutes or ask for gigabytes of memory. There, it can be killed, and no other request waits for it.
 */
const RENDER_TIMEOUT_MS = 15_000;
// Certificates come one at a time, and a queue this long means something is wrong.
const MAX_WAITING = 8;
// A generous page. Anything larger isn't a document we'd read, and shouldn't fill the server's memory.
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

const EXIT_PROTECTED = 10;

// The worker runs from disk, so Next.js doesn't bundle it or the PDF library.
const WORKER = path.resolve(/*turbopackIgnore: true*/ 'scripts/pdf-render-process.mjs');
// The library insists on a trailing forward slash, on Windows as well.
const STANDARD_FONTS_DIR = `${path.resolve(/*turbopackIgnore: true*/ 'node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/')}/`;
// Only what Windows needs to start a process, so the API keys and encryption key stay in this one.
const WORKER_ENV = (process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) as NodeJS.ProcessEnv;

export type PdfFailure = 'PDF_PROTECTED' | 'PDF_UNREADABLE';

export class PdfRenderError extends Error {
  constructor(readonly code: PdfFailure) {
    super(code);
    this.name = 'PdfRenderError';
  }
}

// On globalThis, because Next.js can load each route as its own copy of this module, and the limit
// of one at a time is for the whole server.
const SHARED = globalThis as typeof globalThis & { __udyamPdfQueue?: { tail: Promise<unknown>; waiting: number } };
const queue = (SHARED.__udyamPdfQueue ??= { tail: Promise.resolve(), waiting: 0 });

/** One at a time, so that many hostile files use one CPU core at most. */
export async function renderFirstPdfPage(bytes: Buffer): Promise<Buffer> {
  if (queue.waiting >= MAX_WAITING) throw new PdfRenderError('PDF_UNREADABLE');
  queue.waiting += 1;

  const result = queue.tail.then(() => renderInProcess(bytes));
  queue.tail = result.catch(() => undefined);
  try {
    return await result;
  } finally {
    queue.waiting -= 1;
  }
}

function renderInProcess(bytes: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--max-old-space-size=512', WORKER, STANDARD_FONTS_DIR], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: WORKER_ENV,
    });

    const chunks: Buffer[] = [];
    let size = 0;
    let oversized = false;

    const timer = setTimeout(() => child.kill('SIGKILL'), RENDER_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) {
        oversized = true;
        child.kill('SIGKILL');
        return;
      }
      chunks.push(chunk);
    });

    child.on('error', () => {
      clearTimeout(timer);
      reject(new PdfRenderError('PDF_UNREADABLE'));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && !oversized) resolve(Buffer.concat(chunks));
      else reject(new PdfRenderError(code === EXIT_PROTECTED ? 'PDF_PROTECTED' : 'PDF_UNREADABLE'));
    });

    // A process killed early closes this pipe, and the 'close' event above reports the outcome.
    child.stdin.on('error', () => undefined);
    child.stdin.end(bytes);
  });
}
