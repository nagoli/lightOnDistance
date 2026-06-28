import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBreakSeconds, computePersonTotals, computeRanking,
  formatDuration, formatDurationCeilQuarter, formatDurationForDisplay,
  mean, median, quantile, stdDev, metricStats, gini,
} from '../js/compute.js';

const params = { consumption: 6, fuelPrice: 2 };

test('computeBreakSeconds: 30 min per full 2h block', () => {
  assert.equal(computeBreakSeconds(0), 0);
  assert.equal(computeBreakSeconds(3600), 0);        // 1h -> no break
  assert.equal(computeBreakSeconds(7200), 1800);     // 2h -> 1 break
  assert.equal(computeBreakSeconds(5 * 3600), 3600); // 5h -> 2 breaks
});

test('computePersonTotals: round trip x quantity, breaks per one-way leg', () => {
  const person = { id: 'a', nom: 'Alice' };
  const places = [{ id: 'p1', quantite: 2, ville: 'X' }];
  const matrix = { a: { p1: { distanceM: 100000, durationS: 3600 } } }; // 100km, 1h
  const t = computePersonTotals(person, places, matrix, params);
  assert.equal(t.km, 400);          // 100 * 2 (AR) * 2 (qty)
  assert.equal(t.timeSeconds, 14400); // 2*(3600+0)*2
  assert.equal(t.cost, 48);         // 400 * 0.06 * 2
  assert.equal(t.error, null);
});

test('computePersonTotals: long trip adds breaks', () => {
  const person = { id: 'b', nom: 'Bob' };
  const places = [{ id: 'p1', quantite: 1, ville: 'X' }];
  const matrix = { b: { p1: { distanceM: 300000, durationS: 4 * 3600 } } }; // 300km, 4h
  const t = computePersonTotals(person, places, matrix, params);
  assert.equal(t.km, 600);            // 300 * 2 * 1
  // breaks for 4h = 2*1800=3600 ; roundtrip = 2*(14400+3600)=36000
  assert.equal(t.timeSeconds, 36000);
});

test('computePersonTotals: missing leg -> error', () => {
  const person = { id: 'a', nom: 'Alice' };
  const places = [{ id: 'p1', quantite: 1, ville: 'X' }];
  const matrix = { a: { p1: { error: 'ZERO_RESULTS' } } };
  const t = computePersonTotals(person, places, matrix, params);
  assert.ok(t.error);
  assert.equal(t.km, 0);
});

test('computePersonTotals: quantity 0 places are skipped', () => {
  const person = { id: 'a', nom: 'Alice' };
  const places = [{ id: 'p1', quantite: 0, ville: 'X' }];
  const matrix = { a: { p1: { distanceM: 100000, durationS: 3600 } } };
  const t = computePersonTotals(person, places, matrix, params);
  assert.equal(t.km, 0);
  assert.equal(t.error, null);
});

test('computeRanking: sorts and computes xN relative to minimum', () => {
  const people = [{ id: 'a', nom: 'Alice' }, { id: 'b', nom: 'Bob' }];
  const places = [{ id: 'p1', quantite: 1, ville: 'X' }];
  const matrix = {
    a: { p1: { distanceM: 100000, durationS: 3600 } },
    b: { p1: { distanceM: 300000, durationS: 3600 } },
  };
  const { rows, stats, errors } = computeRanking(people, places, matrix, params, 'km');
  assert.equal(errors.length, 0);
  assert.equal(rows[0].person.id, 'b');     // most km first
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[0].multKm, 3);          // 600/200
  assert.equal(rows[1].multKm, 1);          // minimum
  assert.equal(stats.medianKm, 400);        // (200+600)/2
  assert.equal(stats.count, 2);
});

test('computeRanking: errored people excluded but reported', () => {
  const people = [{ id: 'a', nom: 'Alice' }, { id: 'b', nom: 'Bob' }];
  const places = [{ id: 'p1', quantite: 1, ville: 'X' }];
  const matrix = {
    a: { p1: { error: 'ZERO_RESULTS' } },
    b: { p1: { distanceM: 300000, durationS: 3600 } },
  };
  const { rows, errors } = computeRanking(people, places, matrix, params, 'km');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].person.id, 'b');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].nom, 'Alice');
});

test('computeRanking: outlier detection (Q3 + 1.5*IQR)', () => {
  const people = [1, 2, 3, 4, 50].map((d, i) => ({ id: 'p' + i, nom: 'P' + i, dist: d }));
  const places = [{ id: 'pl', quantite: 1, ville: 'X' }];
  const matrix = {};
  people.forEach((p) => { matrix[p.id] = { pl: { distanceM: p.dist * 1000, durationS: 60 } }; });
  const { rows } = computeRanking(people, places, matrix, params, 'km');
  const outliers = rows.filter((r) => r.isOutlier);
  assert.equal(outliers.length, 1);
  assert.equal(outliers[0].person.id, 'p4'); // the 50km one
});

test('stats helpers', () => {
  assert.equal(mean([2, 4, 6]), 4);
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(quantile([1, 2, 3, 4], 0.25), 1.75);
  assert.ok(Math.abs(stdDev([2, 4, 4, 4, 5, 5, 7, 9]) - 2) < 1e-9);
});

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0 min');
  assert.equal(formatDuration(90), '2 min');
  assert.equal(formatDuration(3600), '1 h 00');
  assert.equal(formatDuration(72000), '20 h 00');
});

test('formatDurationCeilQuarter: rounds display up to the next 15 min', () => {
  assert.equal(formatDurationCeilQuarter(0), '0 min');
  assert.equal(formatDurationCeilQuarter(90), '15 min');
  assert.equal(formatDurationCeilQuarter(3600), '1 h 00');
  assert.equal(formatDurationCeilQuarter((432 * 3600) + (9 * 60)), '432 h 15');
  assert.equal(formatDurationCeilQuarter((432 * 3600) + (9 * 60), true), '432h15');
});

test('formatDurationForDisplay: rounds to hours above 20h', () => {
  assert.equal(formatDurationForDisplay((19 * 3600) + (59 * 60)), '20 h 00');
  assert.equal(formatDurationForDisplay(20 * 3600), '20 h 00');
  assert.equal(formatDurationForDisplay((20 * 3600) + 60), '21 h');
  assert.equal(formatDurationForDisplay((432 * 3600) + (9 * 60)), '433 h');
  assert.equal(formatDurationForDisplay((432 * 3600) + (9 * 60), true), '433h');
});

test('metricStats: dispersion stats for the chosen metric', () => {
  const rows = [
    { km: 200, timeSeconds: 3600, cost: 10 },
    { km: 400, timeSeconds: 7200, cost: 20 },
    { km: 600, timeSeconds: 10800, cost: 30 },
  ];
  const s = metricStats(rows, 'km');
  assert.equal(s.count, 3);
  assert.equal(s.min, 200);
  assert.equal(s.max, 600);
  assert.equal(s.median, 400);
  assert.equal(s.mean, 400);
  assert.ok(Math.abs(s.std - 163.2993) < 1e-3);
  assert.equal(s.q1, 300);
  assert.equal(s.q3, 500);
  assert.equal(s.iqr, 200);
  assert.equal(s.outlierThreshold, 800); // 500 + 1.5*200
  assert.equal(s.maxOverMedian, 1.5);
  assert.equal(s.sum, 1200);
  assert.equal(s.iqrOverMedian, 0.5); // 200/400
  assert.ok(Math.abs(s.gini - gini([200, 400, 600])) < 1e-9);
});

test('gini: 0 for equal or empty distributions', () => {
  assert.equal(gini([]), 0);
  assert.equal(gini([5]), 0);
  assert.equal(gini([100, 100, 100]), 0);
});

test('gini: increases with inequality', () => {
  const equal = gini([100, 100, 100, 100]);
  const mild = gini([50, 100, 150, 200]);
  const extreme = gini([0, 0, 0, 400]);
  assert.equal(equal, 0);
  assert.ok(mild > 0 && mild < 1);
  assert.ok(extreme > mild);
  assert.ok(extreme <= 1);
});

test('metricStats: follows the metric (time)', () => {
  const rows = [
    { km: 200, timeSeconds: 3600, cost: 10 },
    { km: 400, timeSeconds: 7200, cost: 20 },
  ];
  const s = metricStats(rows, 'time');
  assert.equal(s.min, 3600);
  assert.equal(s.max, 7200);
  assert.equal(s.median, 5400);
});

test('metricStats: empty rows -> null', () => {
  assert.equal(metricStats([], 'km'), null);
});
