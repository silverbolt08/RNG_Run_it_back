/**
 * Draws page one of an untrusted PDF, in a process of its own. The library works on the main thread
 * and can hold it for as long as a hostile file likes, so it runs here, where the parent can kill it
 * and the app's other requests carry on. The parent keeps the app's settings and keys out of its
 * environment.
 *
 * Reads the PDF on stdin, and writes a PNG on stdout. The exit code says how it went.
 */
import { Worker } from 'node:worker_threads';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const EXIT_PROTECTED = 10;
const EXIT_UNREADABLE = 11;

// About 240 dpi on an A4 page, which reads cleanly and is the size of a good phone photo.
const TARGET_LONG_SIDE_PX = 2800;
// Matches the limit on uploaded images. A bigger image inside a PDF is skipped, not decoded.
const MAX_IMAGE_PIXELS = 40_000_000;

// A thread of its own, because the main thread can be too busy to notice. Node's heap limit doesn't
// cover image buffers, so this watches the whole process, on every operating system.
const MAX_MEMORY_BYTES = 1024 * 1024 * 1024;
const watchdog = new Worker(
  `const limit = ${MAX_MEMORY_BYTES};
   setInterval(() => { if (process.memoryUsage.rss() > limit) process.kill(process.pid, 'SIGKILL'); }, 100);`,
  { eval: true },
);
watchdog.unref();

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function render(bytes, fontsDir) {
  const task = getDocument({
    data: new Uint8Array(bytes),
    // The file is untrusted: nothing is fetched on its behalf, and fonts come only from this folder.
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: fontsDir,
    maxImageSize: MAX_IMAGE_PIXELS,
    stopAtErrors: false,
    verbosity: 0,
  });
  const document = await task.promise;
  const page = await document.getPage(1);
  const unscaled = page.getViewport({ scale: 1 });
  // Sized by the target, whatever the page claims, so the canvas stays small on a giant page.
  const viewport = page.getViewport({ scale: TARGET_LONG_SIDE_PX / Math.max(unscaled.width, unscaled.height) });

  const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport }).promise;
  return canvas.toBuffer('image/png');
}

try {
  const png = await render(await readInput(), process.argv[2]);
  process.stdout.write(png, () => process.exit(0));
} catch (error) {
  process.exit(error instanceof Error && error.name === 'PasswordException' ? EXIT_PROTECTED : EXIT_UNREADABLE);
}
