import { checkProduct } from '../../domain/eligibility/eligibility';
import { defaultQuantity, unitPriceInr } from '../../domain/pricing/pricing';
import type { AppContext } from '../app-context';
import { loadQuote } from './quote-repository';

/**
 * Everything not yet in the bundle, each with its answer from the rules. A screen can then show a
 * blocked add-on disabled with its reason, instead of hiding it or finding out on the tap.
 */
export async function listAddOns(app: AppContext, ownerId: string, quoteId: string) {
  const catalogue = await app.catalogue();
  const stored = await loadQuote(app, catalogue, ownerId, quoteId);
  const inBundle = stored.lines.map((line) => line.productId);

  const items = catalogue.products
    .filter((product) => !inBundle.includes(product.id))
    .map((product) => {
      const result = checkProduct(catalogue, product.id, stored.profile, [...inBundle, product.id]);
      return {
        productId: product.id,
        category: product.category,
        name: product.name,
        description: product.description,
        unit: product.unit,
        unitPriceInr: unitPriceInr(product),
        setupInr: product.setupInr,
        defaultQuantity: defaultQuantity(product, stored.profile),
        eligible: result.eligible,
        blockers: result.blockers,
        alternatives: result.alternatives,
      };
    });

  return {
    items,
    // So a dependency or an alternative can be named without showing a product code.
    names: Object.fromEntries(catalogue.products.map((product) => [product.id, product.name])),
    nextCursor: null,
  };
}
