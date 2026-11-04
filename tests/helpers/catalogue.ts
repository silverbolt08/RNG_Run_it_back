import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCatalogue, type Catalogue } from '@/domain/catalogue/catalogue';
import { parseCsv } from '@/lib/csv';

const FIXTURE = fileURLToPath(new URL('../fixtures/product_catalogue.csv', import.meta.url));

/** A copy of the data pack's catalogue. A regression test checks the two stay identical. */
export function loadTestCatalogue(): Catalogue {
  return parseCatalogue(parseCsv(readFileSync(FIXTURE, 'utf8')));
}
