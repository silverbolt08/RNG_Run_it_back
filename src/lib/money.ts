const INR_FORMAT = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/** For the display edge only. Everywhere else, money stays an integer in rupees. */
export function formatInr(amountInr: number): string {
  if (!Number.isInteger(amountInr)) throw new RangeError('Money must be a whole number of rupees');
  return INR_FORMAT.format(amountInr);
}
