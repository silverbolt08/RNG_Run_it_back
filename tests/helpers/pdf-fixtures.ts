import { deflateSync } from 'node:zlib';

/**
 * Small real PDFs written by hand, so tests need no PDF-writing dependency. Each object is written
 * with a correct cross-reference table, because a reader that had to repair the file would hide a
 * problem rather than test the normal path.
 */
function assemble(objects: ReadonlyArray<Buffer>, trailerExtra = ''): Buffer {
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n', 'latin1')];
  let offset = parts[0]?.length ?? 0;
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    offsets.push(offset);
    const object = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
    parts.push(object);
    offset += object.length;
  });

  const entries = offsets.map((value) => `${String(value).padStart(10, '0')} 00000 n \n`).join('');
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}`;
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${trailerExtra} >>\nstartxref\n${offset}\n%%EOF\n`;
  parts.push(Buffer.from(xref + trailer, 'latin1'));
  return Buffer.concat(parts);
}

const dictionary = (text: string) => Buffer.from(text, 'latin1');

function stream(header: string, data: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`<< ${header} /Length ${data.length} >>\nstream\n`, 'latin1'),
    data,
    Buffer.from('\nendstream', 'latin1'),
  ]);
}

/** Like a scan or a phone app's "save as PDF": one page holding one JPEG. */
export function imagePdf(jpeg: Buffer, width: number, height: number): Buffer {
  return placedImagePdf(jpeg, width, height, { pageWidth: width, pageHeight: height, drawWidth: width, x: 0, y: 0 });
}

/** A card or a small slip scanned onto a page, with blank paper around it. */
export function onA4Pdf(jpeg: Buffer, width: number, height: number): Buffer {
  const drawWidth = 300;
  return placedImagePdf(jpeg, width, height, { pageWidth: 595, pageHeight: 842, drawWidth, x: 60, y: 480 });
}

function placedImagePdf(
  jpeg: Buffer,
  width: number,
  height: number,
  place: { pageWidth: number; pageHeight: number; drawWidth: number; x: number; y: number },
): Buffer {
  const drawHeight = Math.round((place.drawWidth * height) / width);
  const drawing = Buffer.from(`q ${place.drawWidth} 0 0 ${drawHeight} ${place.x} ${place.y} cm /Im0 Do Q`, 'latin1');
  return assemble([
    dictionary('<< /Type /Catalog /Pages 2 0 R >>'),
    dictionary('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    dictionary(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${place.pageWidth} ${place.pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`),
    stream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, jpeg),
    stream('', drawing),
  ]);
}

const escapeText = (line: string) => line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Like the GST portal's download: real text in a standard font, on an A4 page. */
export function textPdf(lines: readonly string[], options: { pages?: number; author?: string } = {}): Buffer {
  const pageCount = options.pages ?? 1;
  const drawing = Buffer.from(`BT /F1 11 Tf 16 TL 50 790 Td ${lines.map((line) => `(${escapeText(line)}) Tj T*`).join(' ')} ET`, 'latin1');
  const kids = Array.from({ length: pageCount }, (_, index) => `${5 + index} 0 R`).join(' ');
  const pages = Array.from({ length: pageCount }, () =>
    dictionary('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>'),
  );
  const info = options.author ? [dictionary(`<< /Author (${escapeText(options.author)}) >>`)] : [];
  return assemble(
    [
      dictionary('<< /Type /Catalog /Pages 2 0 R >>'),
      dictionary(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`),
      dictionary('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
      stream('', drawing),
      ...pages,
      ...info,
    ],
    options.author ? ` /Info ${5 + pageCount} 0 R` : '',
  );
}

/** Asks for a password to open: the check values match no password, so a reader can't get in. */
export function passwordProtectedPdf(): Buffer {
  const filler = 'A'.repeat(64);
  return assemble(
    [
      dictionary('<< /Type /Catalog /Pages 2 0 R >>'),
      dictionary('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
      dictionary('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>'),
      dictionary(`<< /Filter /Standard /V 2 /R 3 /Length 128 /P -44 /O <${filler}> /U <${filler}> >>`),
    ],
    ' /Encrypt 4 0 R /ID [<00112233445566778899AABBCCDDEEFF> <00112233445566778899AABBCCDDEEFF>]',
  );
}

/** About a kilobyte that unpacks to millions of drawing commands, which would hold a thread for minutes. */
export function slowToDrawPdf(): Buffer {
  const drawing = deflateSync(Buffer.from('0 0 595 842 re f\n'.repeat(120_000), 'latin1'), { level: 9 });
  return assemble([
    dictionary('<< /Type /Catalog /Pages 2 0 R >>'),
    dictionary('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    dictionary('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>'),
    stream('/Filter /FlateDecode', drawing),
  ]);
}

/** About 2 KB that declares and unpacks to a 16000 x 16000 image, which is gigabytes of memory. */
export function imageBombPdf(): Buffer {
  const side = 16_000;
  const pixels = deflateSync(deflateSync(Buffer.alloc(side * side * 3)), { level: 9 });
  const drawing = Buffer.from('q 595 0 0 842 0 0 cm /Im0 Do Q', 'latin1');
  return assemble([
    dictionary('<< /Type /Catalog /Pages 2 0 R >>'),
    dictionary('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    dictionary('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'),
    stream(`/Type /XObject /Subtype /Image /Width ${side} /Height ${side} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/FlateDecode /FlateDecode]`, pixels),
    stream('', drawing),
  ]);
}

/** Thirty images, each small enough to be allowed, that together need far more memory than a page should. */
export function manyImagesPdf(): Buffer {
  const side = 6000;
  const count = 30;
  const pixels = deflateSync(deflateSync(Buffer.alloc(side * side * 3, 0x80)), { level: 9 });
  const firstImage = 5;
  const names = Array.from({ length: count }, (_, index) => `/Im${index} ${firstImage + index} 0 R`).join(' ');
  const drawing = Array.from({ length: count }, (_, index) => `q 595 0 0 842 0 0 cm /Im${index} Do Q`).join('\n');
  return assemble([
    dictionary('<< /Type /Catalog /Pages 2 0 R >>'),
    dictionary('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    dictionary(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << ${names} >> >> /Contents 4 0 R >>`),
    stream('', Buffer.from(drawing, 'latin1')),
    ...Array.from({ length: count }, () =>
      stream(`/Type /XObject /Subtype /Image /Width ${side} /Height ${side} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/FlateDecode /FlateDecode]`, pixels),
    ),
  ]);
}

/** A page far bigger than any document, which would need gigabytes to draw at full size. */
export function hugePagePdf(): Buffer {
  return assemble([
    dictionary('<< /Type /Catalog /Pages 2 0 R >>'),
    dictionary('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    dictionary('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 14400 14400] >>'),
  ]);
}
