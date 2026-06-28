// Pure calculation & statistics functions (no DOM, no network) — testable in isolation.

const BREAK_SECONDS = 30 * 60; // 30 min
const DRIVE_BLOCK_SECONDS = 2 * 3600; // every 2h of driving

/**
 * Break time added for a single one-way leg: 30 min for every full 2h of driving.
 * @param {number} legDurationSeconds one-way driving duration in seconds
 * @returns {number} break time in seconds
 */
export function computeBreakSeconds(legDurationSeconds) {
  if (!legDurationSeconds || legDurationSeconds <= 0) return 0;
  return Math.floor(legDurationSeconds / DRIVE_BLOCK_SECONDS) * BREAK_SECONDS;
}

/**
 * Total km / time / cost for one person, cumulated over all places.
 * Round trip = 2 x one-way; breaks computed per one-way leg; everything x quantity.
 *
 * @param {object} person {id, nom, ...}
 * @param {Array} places [{id, quantite}]
 * @param {object} matrix matrix[personId][placeId] = {distanceM, durationS} | {error}
 * @param {object} params {consumption (L/100km), fuelPrice (€/L)}
 * @returns {{km:number, timeSeconds:number, cost:number, error:string|null}}
 */
export function computePersonTotals(person, places, matrix, params) {
  const { consumption, fuelPrice } = params;
  let km = 0;
  let timeSeconds = 0;
  const personLegs = matrix[person.id] || {};

  for (const place of places) {
    const qty = Number(place.quantite) || 0;
    if (qty <= 0) continue;
    const leg = personLegs[place.id];
    if (!leg || leg.error || leg.distanceM == null || leg.durationS == null) {
      return { km: 0, timeSeconds: 0, cost: 0, error: `Trajet introuvable vers ${place.ville || place.codePostal || 'lieu'}` };
    }
    const oneWayKm = leg.distanceM / 1000;
    km += oneWayKm * 2 * qty;

    const breaks = computeBreakSeconds(leg.durationS);
    const roundTripTime = 2 * (leg.durationS + breaks);
    timeSeconds += roundTripTime * qty;
  }

  const cost = km * (consumption / 100) * fuelPrice;
  return { km, timeSeconds, cost, error: null };
}

// ---- Statistics helpers ----

export function mean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values) {
  return quantile(values, 0.5);
}

/** Linear-interpolation quantile (q in [0,1]). */
export function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

export function stdDev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Gini coefficient of a distribution (0 = perfectly equal, 1 = maximally unequal).
 * Uses the sorted-values formula: G = (2·Σ i·x_i)/(n·Σx) − (n+1)/n  (i = 1..n, ascending).
 * Returns 0 for an empty or all-equal distribution.
 */
export function gini(values) {
  const n = values.length;
  if (n < 2) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  if (sum <= 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * sorted[i];
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

/**
 * Build the full ranking from people + places + distance matrix.
 * @returns {{rows:Array, stats:object, errors:Array}}
 */
export function computeRanking(people, places, matrix, params, sortBy = 'km') {
  const rows = [];
  const errors = [];

  for (const person of people) {
    const totals = computePersonTotals(person, places, matrix, params);
    if (totals.error) {
      errors.push({ nom: person.nom, message: totals.error });
      continue;
    }
    rows.push({ person, km: totals.km, timeSeconds: totals.timeSeconds, cost: totals.cost });
  }

  if (!rows.length) {
    return { rows: [], stats: null, errors };
  }

  const kmValues = rows.map((r) => r.km);
  const minKm = Math.min(...rows.map((r) => r.km)) || 1;
  const minTime = Math.min(...rows.map((r) => r.timeSeconds)) || 1;
  const minCost = Math.min(...rows.map((r) => r.cost)) || 1;

  // statistics on km (the main dispersion metric)
  const med = median(kmValues);
  const q1 = quantile(kmValues, 0.25);
  const q3 = quantile(kmValues, 0.75);
  const iqr = q3 - q1;
  const outlierThreshold = q3 + 1.5 * iqr;

  for (const r of rows) {
    r.multKm = r.km / minKm;
    r.multTime = r.timeSeconds / minTime;
    r.multCost = r.cost / minCost;
    r.isOutlier = iqr > 0 && r.km > outlierThreshold;
  }

  const sortKey = { km: 'km', time: 'timeSeconds', cost: 'cost' }[sortBy] || 'km';
  rows.sort((a, b) => b[sortKey] - a[sortKey]);
  rows.forEach((r, i) => { r.rank = i + 1; });

  const stats = {
    count: rows.length,
    minKm: Math.min(...kmValues),
    maxKm: Math.max(...kmValues),
    medianKm: med,
    meanKm: mean(kmValues),
    stdKm: stdDev(kmValues),
    iqrKm: iqr,
    maxOverMedian: med > 0 ? Math.max(...kmValues) / med : 0,
    outlierThreshold,
  };

  return { rows, stats, errors };
}

/** Row field backing each metric. */
export const METRIC_FIELD = { km: 'km', time: 'timeSeconds', cost: 'cost' };

/**
 * Dispersion statistics for a given metric (km / time / cost) over the ranked rows.
 * Returns min/max/median/mean/std/q1/q3/iqr/outlierThreshold and maxOverMedian.
 */
export function metricStats(rows, metric = 'km') {
  const field = METRIC_FIELD[metric] || 'km';
  const values = rows.map((r) => r[field]);
  if (!values.length) return null;
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const med = median(values);
  const iqr = q3 - q1;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    count: values.length,
    min,
    max,
    sum,
    median: med,
    mean: mean(values),
    std: stdDev(values),
    q1,
    q3,
    iqr,
    outlierThreshold: q3 + 1.5 * iqr,
    maxOverMedian: med > 0 ? max / med : 0,
    iqrOverMedian: med > 0 ? iqr / med : 0,
    gini: gini(values),
  };
}

/** Format seconds as "Xh Ymin". */
export function formatDuration(seconds) {
  const totalMin = Math.round(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2, '0')}`;
}
