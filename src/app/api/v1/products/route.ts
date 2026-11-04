import { unitPriceInr } from '@/domain/pricing/pricing';
import { publicRoute } from '@/server/http/api-route';
import { pageQuerySchema, readQuery, toPage } from '@/server/http/request';
import { json } from '@/server/http/response';

/** Public, because the catalogue holds no personal data. Sorted by ID, which is also the cursor. */
export const GET = publicRoute('GET /api/v1/products', async ({ app, request }) => {
  const { limit, cursor } = readQuery(request, pageQuerySchema);
  const catalogue = await app.catalogue();
  const remaining = [...catalogue.products]
    .sort((a, b) => a.id.localeCompare(b.id))
    .filter((product) => !cursor || product.id > cursor);

  return json(
    toPage(
      remaining.slice(0, limit + 1),
      limit,
      (product) => product.id,
      (product) => ({ ...product, unitPriceInr: unitPriceInr(product) }),
    ),
  );
});
