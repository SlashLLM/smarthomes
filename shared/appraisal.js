/* Appraisal report maths.
 *
 * The same model as the hero calculator (src/app.js recalc/onResult), with the
 * admin's overrides from migration 0004 layered on top of the lead's stored
 * estimate. Kept free of Node and config imports so the admin dashboard can
 * bundle it for its live preview; the constants are passed in by the caller.
 *
 * Lives outside api/ because the dev server routes every /api/* URL to a
 * function, so the browser couldn't load it from there.
 */

/** Editable report fields: lead column, and the range the admin may enter. */
export const REPORT_FIELDS = {
  report_weekly_rent: { min: 50, max: 10000 },
  report_nightly_rate: { min: 20, max: 10000 },
  report_occupancy: { min: 0.05, max: 1 },
  report_costs_pct: { min: 0, max: 80 },
};
export const COMMENTARY_MAX = 2000;

const num = (v) => {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) ? n : null;
};

/**
 * @param {object} lead  a `leads` row
 * @param {{STR_NET_FACTOR:number, MAX_OCCUPANCY:number, STR_GROWTH:number, LTR_GROWTH:number}} calc
 * @returns {object|null} null when there isn't enough to price the property
 */
export function computeAppraisal(lead, calc) {
  const e = lead.estimate || {};

  const weeklyRent =
    num(lead.report_weekly_rent) ?? num(e.weeklyMarketRent) ?? num(lead.current_weekly_rent);
  const nightlyRate = num(lead.report_nightly_rate) ?? num(e.nightlyRate);
  // An explicit admin override is taken as-is; the model's figure keeps the
  // calculator's cap so the report never promises more than the site did.
  const occupancy =
    num(lead.report_occupancy) ??
    (num(e.occupancy) != null ? Math.min(calc.MAX_OCCUPANCY, num(e.occupancy)) : null);
  const costsPct = num(lead.report_costs_pct) ?? Math.round((1 - calc.STR_NET_FACTOR) * 100);

  if (!weeklyRent || !nightlyRate || !occupancy) return null;

  const nightsBooked = Math.round(365 * occupancy);
  // Priced on whole nights so the report's "rate × nights" equation adds up.
  const strGross = nightlyRate * nightsBooked;
  const strCosts = strGross * (costsPct / 100);
  const strNet = strGross - strCosts;
  const ltrAnnual = weeklyRent * 52;
  const diff = strNet - ltrAnnual;

  const years = [];
  let fiveYearStr = 0;
  let fiveYearLtr = 0;
  for (let i = 0; i < 5; i++) {
    const str = strNet * Math.pow(calc.STR_GROWTH, i);
    const ltr = ltrAnnual * Math.pow(calc.LTR_GROWTH, i);
    fiveYearStr += str;
    fiveYearLtr += ltr;
    years.push({ year: i + 1, str, ltr, diff: str - ltr });
  }

  return {
    weeklyRent,
    nightlyRate,
    occupancy,
    costsPct,
    nightsBooked,
    strGross,
    strCosts,
    strNet,
    strWeekly: strNet / 52,
    ltrAnnual,
    diff,
    upliftPct: ltrAnnual ? (diff / ltrAnnual) * 100 : 0,
    years,
    fiveYearStr,
    fiveYearLtr,
    fiveYearDiff: fiveYearStr - fiveYearLtr,
    strGrowthPct: (calc.STR_GROWTH - 1) * 100,
    ltrGrowthPct: (calc.LTR_GROWTH - 1) * 100,
    overridden: ["report_weekly_rent", "report_nightly_rate", "report_occupancy", "report_costs_pct"]
      .some((k) => num(lead[k]) != null),
  };
}
