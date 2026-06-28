import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBreakSeconds, computePersonTotals, computeRanking,
  formatDuration, mean, median, quantile, stdDev,
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
