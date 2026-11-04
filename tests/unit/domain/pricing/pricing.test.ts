import { describe, expect, it } from 'vitest';
import {
  compareQuotes,
  defaultQuantity,
  GST_RATE_PERCENT,
  gstOnInr,
  priceBundle,
  PRICE_POSITION,
  unitPriceInr,
  type BusinessSize,
} from '@/domain/pricing/pricing';
import { getProduct } from '@/domain/catalogue/catalogue';
import { loadTestCatalogue } from '../../../helpers/catalogue';

const catalogue = loadTestCatalogue();
const SIZE: BusinessSize = { employeeCount: 50, numSites: 4 };

describe('unitPriceInr', () => {
  it('uses the midpoint of the range', () => {
    expect(PRICE_POSITION).toBe(0.5);
    expect(unitPriceInr(getProduct(catalogue, 'P01'))).toBe(1099);
    expect(unitPriceInr(getProduct(catalogue, 'P05'))).toBe(10000);
  });

  // Cloud Email's range is 125 to 150, so its exact midpoint isn't a whole rupee.
  it('rounds a half-rupee midpoint up to a whole rupee', () => {
    expect(unitPriceInr(getProduct(catalogue, 'P16'))).toBe(138);
  });

  it('keeps every product inside its catalogue range, in whole rupees', () => {
    for (const product of catalogue.products) {
      const price = unitPriceInr(product);
      expect(Number.isInteger(price)).toBe(true);
      expect(price).toBeGreaterThanOrEqual(product.priceMinInr);
      expect(price).toBeLessThanOrEqual(product.priceMaxInr);
    }
  });
});

describe('priceBundle', () => {
  it('multiplies unit prices and setup fees by quantity', () => {
    const quote = priceBundle(catalogue, [{ productId: 'P09', quantity: 3 }]);
    expect(quote.lines).toEqual([
      { productId: 'P09', quantity: 3, unitPriceInr: 549, monthlyInr: 1647, setupInr: 4500 },
    ]);
  });

  it('adds up monthly and setup totals', () => {
    const quote = priceBundle(catalogue, [
      { productId: 'P01', quantity: 1 },
      { productId: 'P07', quantity: 1 },
      { productId: 'P22', quantity: 1 },
    ]);
    expect(quote.monthlyTotalInr).toBe(1947);
    expect(quote.setupTotalInr).toBe(1000);
  });

  it('takes the longest contract in the bundle', () => {
    const quote = priceBundle(catalogue, [
      { productId: 'P07', quantity: 1 },
      { productId: 'P01', quantity: 1 },
      { productId: 'P21', quantity: 1 },
    ]);
    expect(quote.contractMonths).toBe(24);
  });

  it('takes the longest install time in the bundle', () => {
    const quote = priceBundle(catalogue, [
      { productId: 'P07', quantity: 1 },
      { productId: 'P05', quantity: 1 },
    ]);
    expect(quote.installDays).toBe(21);
  });

  it('reproduces the blueprint example bundles', () => {
    const professional = priceBundle(catalogue, [
      { productId: 'P02', quantity: 1 },
      { productId: 'P08', quantity: 2 },
      { productId: 'P16', quantity: 8 },
      { productId: 'P20', quantity: 7 },
      { productId: 'P17', quantity: 1 },
    ]);
    expect(professional).toMatchObject({ monthlyTotalInr: 5618, setupTotalInr: 0, contractMonths: 12 });

    const multiSite = priceBundle(catalogue, [
      { productId: 'P02', quantity: 8 },
      { productId: 'P09', quantity: 8 },
      { productId: 'P08', quantity: 3 },
      { productId: 'P19', quantity: 3 },
      { productId: 'P23', quantity: 4 },
    ]);
    expect(multiSite).toMatchObject({ monthlyTotalInr: 22924, setupTotalInr: 26700, contractMonths: 12 });

    const manufacturer = priceBundle(catalogue, [
      { productId: 'P05', quantity: 1 },
      { productId: 'P21', quantity: 1 },
      { productId: 'P08', quantity: 3 },
      { productId: 'P16', quantity: 10 },
      { productId: 'P20', quantity: 10 },
    ]);
    expect(manufacturer).toMatchObject({ monthlyTotalInr: 17216, setupTotalInr: 14000, contractMonths: 24 });
  });

  it('gives zeros for an empty bundle', () => {
    expect(priceBundle(catalogue, [])).toEqual({
      lines: [],
      monthlyTotalInr: 0,
      monthlyGstInr: 0,
      monthlyFinalInr: 0,
      setupTotalInr: 0,
      setupGstInr: 0,
      setupFinalInr: 0,
      contractMonths: 0,
      installDays: 0,
    });
  });

  describe('the final price, including GST', () => {
    const micro = priceBundle(catalogue, [
      { productId: 'P01', quantity: 1 },
      { productId: 'P07', quantity: 1 },
      { productId: 'P22', quantity: 1 },
    ]);

    it('uses 18%', () => {
      expect(GST_RATE_PERCENT).toBe(18);
    });

    it('adds GST to the monthly total, rounded to a whole rupee', () => {
      expect(micro).toMatchObject({ monthlyTotalInr: 1947, monthlyGstInr: 350, monthlyFinalInr: 2297 });
    });

    it('adds GST to the setup fee separately', () => {
      expect(micro).toMatchObject({ setupTotalInr: 1000, setupGstInr: 180, setupFinalInr: 1180 });
    });

    it('rounds half a rupee of GST up', () => {
      // 18% of 25 is exactly 4.50.
      expect(gstOnInr(25)).toBe(5);
    });

    it('keeps every total in whole rupees across the catalogue', () => {
      for (const product of catalogue.products) {
        const quote = priceBundle(catalogue, [{ productId: product.id, quantity: 3 }]);
        expect(Number.isInteger(quote.monthlyFinalInr)).toBe(true);
        expect(Number.isInteger(quote.setupFinalInr)).toBe(true);
        expect(quote.monthlyFinalInr).toBe(quote.monthlyTotalInr + quote.monthlyGstInr);
        expect(quote.setupFinalInr).toBe(quote.setupTotalInr + quote.setupGstInr);
      }
    });
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects a quantity of %s', (quantity) => {
    expect(() => priceBundle(catalogue, [{ productId: 'P01', quantity }])).toThrow(/quantity/i);
  });

  it('rejects a product outside the catalogue', () => {
    expect(() => priceBundle(catalogue, [{ productId: 'P99', quantity: 1 }])).toThrow(/P99/);
  });

  it('rejects the same product twice, since the two lines could disagree', () => {
    expect(() =>
      priceBundle(catalogue, [
        { productId: 'P01', quantity: 1 },
        { productId: 'P01', quantity: 2 },
      ]),
    ).toThrow(/P01/);
  });
});

describe('compareQuotes', () => {
  it('reports every change a toggle causes', () => {
    const before = priceBundle(catalogue, [{ productId: 'P02', quantity: 1 }]);
    const after = priceBundle(catalogue, [
      { productId: 'P02', quantity: 1 },
      { productId: 'P21', quantity: 1 },
    ]);
    expect(compareQuotes(before, after)).toEqual({
      monthlyDeltaInr: 2499,
      monthlyFinalDeltaInr: 2949,
      setupDeltaInr: 4000,
      setupFinalDeltaInr: 4720,
      contractMonthsBefore: 12,
      contractMonthsAfter: 24,
      contractChanged: true,
      installDaysBefore: 5,
      installDaysAfter: 10,
      installChanged: true,
    });
  });

  it('reports no contract or install change when they stay the same', () => {
    const before = priceBundle(catalogue, [{ productId: 'P02', quantity: 1 }]);
    const after = priceBundle(catalogue, [{ productId: 'P02', quantity: 2 }]);
    expect(compareQuotes(before, after)).toMatchObject({
      monthlyDeltaInr: 1649,
      contractChanged: false,
      installChanged: false,
    });
  });
});

describe('defaultQuantity', () => {
  const quantityOf = (id: string, size = SIZE, counts = {}) =>
    defaultQuantity(getProduct(catalogue, id), size, counts);

  it('uses one per site', () => {
    expect(quantityOf('P02')).toBe(4);
  });

  it('assumes one site when the number is unknown', () => {
    expect(quantityOf('P02', { employeeCount: 50, numSites: null })).toBe(1);
  });

  it.each([
    ['per line', 'P07', 2],
    ['per user', 'P16', 8],
    ['per device', 'P20', 7],
    ['per camera', 'P23', 4],
    ['per counter', 'P19', 3],
    ['per vehicle', 'P25', 5],
    ['per channel', 'P12', 3],
    ['per IP', 'P11', 1],
    ['per account', 'P15', 1],
    ['per number', 'P13', 1],
    ['per pack', 'P14', 1],
  ])('uses the historic default %s', (_unit, id, expected) => {
    expect(quantityOf(id)).toBe(expected);
  });

  it('uses the number the owner gave', () => {
    expect(quantityOf('P16', SIZE, { users: 3 })).toBe(3);
    expect(quantityOf('P23', SIZE, { cameras: 12 })).toBe(12);
  });

  it('uses machines for machine monitoring', () => {
    expect(quantityOf('P24', SIZE, { machines: 6, devices: 2 })).toBe(6);
  });

  // A default of 8 email users would overcharge a 3-person shop.
  it('never defaults to more people-based units than the business has people', () => {
    expect(quantityOf('P16', { employeeCount: 3, numSites: 1 })).toBe(3);
    expect(quantityOf('P07', { employeeCount: 1, numSites: 1 })).toBe(1);
  });

  it('does not cap a number the owner gave', () => {
    expect(quantityOf('P07', { employeeCount: 3, numSites: 1 }, { lines: 5 })).toBe(5);
  });
});
