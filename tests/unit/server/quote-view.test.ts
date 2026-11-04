import { describe, expect, it } from 'vitest';
import { priceBundle, type Quote } from '@/domain/pricing/pricing';
import { totalsOf } from '@/server/services/quote-view';
import { loadTestCatalogue } from '../../helpers/catalogue';

describe('totalsOf', () => {
  const quote = priceBundle(loadTestCatalogue(), [{ productId: 'P01', quantity: 2 }]);

  it('gives the totals without the lines', () => {
    const totals = totalsOf(quote);
    expect(totals).not.toHaveProperty('lines');
    expect(totals).toMatchObject({ monthlyTotalInr: 2198, setupTotalInr: 0, contractMonths: 12, installDays: 5 });
  });

  it('forwards a total added to Quote later, with no change needed here', () => {
    const extended = { ...quote, anotherTotalInr: 123 } as Quote;
    expect(totalsOf(extended)).toHaveProperty('anotherTotalInr', 123);
  });
});
