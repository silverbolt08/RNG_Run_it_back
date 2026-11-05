/**
 * Scores a lead with the coefficients analytics/propensity.py exports, so the app needs no Python
 * service. It ranks who to call first and decides nothing about what anyone can buy. Language and
 * state are left out, because including them didn't improve it.
 */
export type PropensityModel = {
  intercept: number;
  weights: Readonly<Record<string, number>>;
  numeric_scaling: Readonly<Record<string, { mean: number; scale: number }>>;
};

/** One value per feature, as named in the model: categories as text, the rest as numbers. */
export type LeadFeatures = {
  categories: Readonly<Record<string, string>>;
  numbers: Readonly<Record<string, number>>;
};

export function propensityScore(model: PropensityModel, lead: LeadFeatures): number {
  let total = model.intercept;

  for (const [feature, value] of Object.entries(lead.categories)) {
    total += model.weights[`${feature}_${value}`] ?? 0;
  }
  for (const [feature, value] of Object.entries(lead.numbers)) {
    const scaling = model.numeric_scaling[feature];
    if (scaling) total += (model.weights[feature] ?? 0) * ((value - scaling.mean) / scaling.scale);
  }
  return 1 / (1 + Math.exp(-total));
}
