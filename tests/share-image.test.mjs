import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResultsSvg } from '../js/share-image.js';

const rows = [
  {
    rank: 1,
    person: { nom: 'Alice & Bob <test>' },
    km: 600,
    timeSeconds: 7200,
    cost: 72,
    multKm: 3,
    multTime: 2,
    multCost: 3,
    isOutlier: true,
  },
  {
    rank: 2,
    person: { nom: 'Claire' },
    km: 200,
    timeSeconds: 3600,
    cost: 24,
    multKm: 1,
    multTime: 1,
    multCost: 1,
    isOutlier: false,
  },
];

test('buildResultsSvg: creates a standalone SVG without foreignObject', () => {
  const image = buildResultsSvg({
    rows,
    places: [{ ville: 'Mélionnec', codePostal: '56480', quantite: 2 }],
    metric: 'km',
    errors: [{ nom: 'Noémie', message: 'Trajet introuvable' }],
    generatedAt: '12 juin 2026 10:30',
  });

  assert.equal(image.width, 1200);
  assert.ok(image.height > 0);
  assert.ok(image.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.equal(image.svg.includes('<foreignObject'), false);
  assert.ok(image.svg.includes('Palmarès des trajets'));
  assert.ok(image.svg.includes('×2 Mélionnec'));
  assert.equal(image.svg.includes('Mélionnec ×2'), false);
  assert.equal(image.svg.includes('Mélionnec 56480 ×2'), false);
  assert.ok(image.svg.includes('Personnes exclues (1)'));
});

test('buildResultsSvg: escapes text content for XML serialization', () => {
  const { svg } = buildResultsSvg({ rows, metric: 'km', generatedAt: 'date fixe' });

  assert.ok(svg.includes('Alice &amp; Bob &lt;test&gt;'));
  assert.equal(svg.includes('Alice & Bob <test>'), false);
});

test('buildResultsSvg: follows the selected metric labels', () => {
  const { svg } = buildResultsSvg({ rows, metric: 'time', generatedAt: 'date fixe' });

  assert.ok(svg.includes('Classement par temps'));
  assert.ok(svg.includes('2 h 00'));
  assert.ok(svg.includes('x2.00'));
});

test('buildResultsSvg: rounds displayed table time to hours above 20h', () => {
  const { svg } = buildResultsSvg({
    rows: [{
      rank: 1,
      person: { nom: 'Diane' },
      km: 100,
      timeSeconds: (432 * 3600) + (9 * 60),
      cost: 12,
      multKm: 1,
      multTime: 1,
      multCost: 1,
      isOutlier: false,
    }],
    metric: 'km',
    generatedAt: 'date fixe',
  });

  assert.ok(svg.includes('433 h'));
  assert.ok(svg.includes('100km – 433h – 12€'));
});

test('buildResultsSvg: detailed table only keeps the km multiplier', () => {
  const { svg } = buildResultsSvg({
    rows: [{
      rank: 1,
      person: { nom: 'Diane' },
      km: 600,
      timeSeconds: 7200,
      cost: 72,
      multKm: 3,
      multTime: 7.42,
      multCost: 8.53,
      isOutlier: true,
    }],
    metric: 'km',
    generatedAt: 'date fixe',
  });

  assert.ok(svg.includes('x3.00'));
  assert.equal(svg.includes('x7.42'), false);
  assert.equal(svg.includes('x8.53'), false);
  assert.equal(svg.includes('#f59e0b'), false);
});
