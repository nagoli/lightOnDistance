import { test } from 'node:test';
import assert from 'node:assert/strict';
import { niceMax, linearScale, ticks, niceTicks, renderCharts } from '../js/charts.js';

test('niceMax: rounds up to a clean axis maximum (fine steps)', () => {
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(-5), 1);
  assert.equal(niceMax(1), 1);
  assert.equal(niceMax(7), 8);
  assert.equal(niceMax(12), 15);
  assert.equal(niceMax(230), 250);
  assert.equal(niceMax(1800), 2000);
  assert.equal(niceMax(3200), 4000); // less empty space than 5000
});

test('niceTicks: round ticks from 0 to max', () => {
  assert.deepEqual(niceTicks(4000), [0, 1000, 2000, 3000, 4000]);
  assert.deepEqual(niceTicks(2500), [0, 500, 1000, 1500, 2000, 2500]);
  assert.deepEqual(niceTicks(0), [0]);
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

test('renderCharts: outliers do not get a separate amber legend or color class', () => {
  const container = { innerHTML: '' };
  renderCharts(container, [
    { person: { nom: 'Alice' }, km: 100, timeSeconds: 3600, cost: 12, multKm: 1, multTime: 1, multCost: 1, isOutlier: false },
    { person: { nom: 'Bob' }, km: 5000, timeSeconds: 7200, cost: 600, multKm: 50, multTime: 2, multCost: 50, isOutlier: true },
  ], 'km');

  assert.equal(container.innerHTML.includes('barres ambrées'), false);
  assert.equal(container.innerHTML.includes('bar-outlier'), false);
  assert.equal(container.innerHTML.includes('dot-outlier'), false);
});

test('renderCharts: bar labels have a translucent background', () => {
  const container = { innerHTML: '' };
  renderCharts(container, [
    { person: { nom: 'Alice' }, km: 100, timeSeconds: 3600, cost: 12, multKm: 1, multTime: 1, multCost: 1, isOutlier: false },
  ], 'km');

  assert.ok(container.innerHTML.includes('class="bar-label-bg"'));
});

test('renderCharts: ranking reference labels include the metric unit', () => {
  const container = { innerHTML: '' };
  renderCharts(container, [
    { person: { nom: 'Alice' }, km: 100, timeSeconds: 3600, cost: 12, multKm: 1, multTime: 1, multCost: 1, isOutlier: false },
    { person: { nom: 'Bob' }, km: 300, timeSeconds: 7200, cost: 36, multKm: 3, multTime: 2, multCost: 3, isOutlier: false },
  ], 'km');

  assert.ok(container.innerHTML.includes('médiane 200 km'));
  assert.ok(container.innerHTML.includes('moyenne 200 km'));
});

test('renderCharts: bar label shows full trip summary and km multiplier', () => {
  const container = { innerHTML: '' };
  renderCharts(container, [
    {
      person: { nom: 'Alice' },
      km: 35630,
      timeSeconds: (432 * 3600) + (9 * 60),
      cost: 4276,
      multKm: 3.51,
      multTime: 1,
      multCost: 1,
      isOutlier: false,
    },
  ], 'km');

  assert.ok(container.innerHTML.includes(`${(35630).toLocaleString('fr-FR')}km`));
  assert.ok(container.innerHTML.includes('class="bar-value-strong">433h</tspan>'));
  assert.ok(container.innerHTML.includes(`class="bar-value-strong">${(4276).toLocaleString('fr-FR')}€</tspan>`));
  assert.ok(container.innerHTML.includes('x3.51'));
});
