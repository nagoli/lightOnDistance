import { test } from 'node:test';
import assert from 'node:assert/strict';
import { niceMax, linearScale, ticks } from '../js/charts.js';

test('niceMax: rounds up to a clean axis maximum', () => {
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(-5), 1);
  assert.equal(niceMax(1), 1);
  assert.equal(niceMax(7), 10);
  assert.equal(niceMax(12), 20);
  assert.equal(niceMax(230), 250);
  assert.equal(niceMax(1800), 2000);
});

test('linearScale: maps domain onto range', () => {
  const s = linearScale(0, 100, 0, 200);
  assert.equal(s(0), 0);
  assert.equal(s(50), 100);
  assert.equal(s(100), 200);
});

test('linearScale: guards a zero-width domain (no division by zero)', () => {
  const s = linearScale(5, 5, 0, 100);
  assert.equal(Number.isFinite(s(5)), true);
});

test('ticks: returns count+1 evenly spaced values from 0 to max', () => {
  assert.deepEqual(ticks(100, 4), [0, 25, 50, 75, 100]);
  assert.deepEqual(ticks(10, 5), [0, 2, 4, 6, 8, 10]);
});
