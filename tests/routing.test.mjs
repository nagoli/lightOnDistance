import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  messageForStatus, toAddress, RoutingError, geocode, buildDistanceMatrix,
} from '../js/routing.js';
import { createOrsCache } from '../js/storage.js';

test('toAddress: builds "code postal ville"', () => {
  assert.equal(toAddress({ codePostal: '75001', ville: 'Paris' }), '75001 Paris');
  assert.equal(toAddress({ codePostal: '', ville: 'Lyon' }), 'Lyon');
  assert.equal(toAddress({ codePostal: '56480', ville: '' }), '56480');
});

test('messageForStatus: maps HTTP statuses to kinds', () => {
  assert.equal(messageForStatus(401).kind, 'auth');
  assert.equal(messageForStatus(403).kind, 'auth');
  assert.equal(messageForStatus(429).kind, 'quota');
  assert.equal(messageForStatus(400).kind, 'request');
  assert.equal(messageForStatus(404).kind, 'request');
  assert.equal(messageForStatus(500).kind, 'service');
  assert.equal(messageForStatus(503).kind, 'service');
  assert.equal(messageForStatus(418).kind, 'unknown');
});

test('messageForStatus: appends detail when provided', () => {
  assert.match(messageForStatus(429, 'rate limit').message, /rate limit/);
});

// ---- network / connection handling (stubbing global fetch) ----

function withFetch(stub, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  return Promise.resolve()
    .then(fn)
    .finally(() => { globalThis.fetch = original; });
}

test('geocode: connection failure surfaces a RoutingError(network)', async () => {
  await withFetch(() => { throw new TypeError('Failed to fetch'); }, async () => {
    await assert.rejects(
      () => geocode('key', '75001 Paris'),
      (e) => e instanceof RoutingError && e.kind === 'network',
    );
  });
});

test('buildDistanceMatrix: propagates connection errors', async () => {
  await withFetch(() => { throw new Error('offline'); }, async () => {
    await assert.rejects(
      () => buildDistanceMatrix('key', [{ id: 'a', ville: 'Paris' }], [{ id: 'p', ville: 'Lyon' }]),
      (e) => e instanceof RoutingError && e.kind === 'network',
    );
  });
});

test('geocode: HTTP 401 surfaces a RoutingError(auth)', async () => {
  const stub = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: { message: 'invalid key' } }),
  });
  await withFetch(stub, async () => {
    await assert.rejects(
      () => geocode('bad', '75001 Paris'),
      (e) => e instanceof RoutingError && e.kind === 'auth' && e.status === 401,
    );
  });
});

// ---- caching: avoid re-calling ORS when already done ----

/** A fetch stub that geocodes any address and returns a constant matrix; counts calls. */
function countingOrsStub() {
  const calls = { geocode: 0, matrix: 0 };
  const fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('/geocode/')) {
      calls.geocode += 1;
      return { ok: true, status: 200, json: async () => ({ features: [{ geometry: { coordinates: [1, 1] } }] }) };
    }
    calls.matrix += 1;
    // parse body to size the matrix correctly
    const body = JSON.parse(opts.body);
    const ns = body.sources.length;
    const nd = body.destinations.length;
    const distances = Array.from({ length: ns }, () => Array.from({ length: nd }, () => 1000));
    const durations = Array.from({ length: ns }, () => Array.from({ length: nd }, () => 60));
    return { ok: true, status: 200, json: async () => ({ distances, durations }) };
  };
  return { fetch, calls };
}

test('buildDistanceMatrix: uses the cache to skip already-known geocodes and legs', async () => {
  const { fetch, calls } = countingOrsStub();
  const cache = createOrsCache({ geo: {}, legs: {} });
  const people = [{ id: 'a', codePostal: '75001', ville: 'Paris' }];
  const places = [{ id: 'p1', codePostal: '44000', ville: 'Nantes' }];

  await withFetch(fetch, async () => {
    const m1 = await buildDistanceMatrix('key', people, places, null, cache);
    assert.deepEqual(m1.a.p1, { distanceM: 1000, durationS: 60 });
    const afterFirst = { ...calls };
    assert.ok(afterFirst.geocode > 0 && afterFirst.matrix > 0);

    // Second run with the same data: cache hit -> no new ORS calls at all.
    const m2 = await buildDistanceMatrix('key', people, places, null, cache);
    assert.deepEqual(m2.a.p1, { distanceM: 1000, durationS: 60 });
    assert.equal(calls.geocode, afterFirst.geocode);
    assert.equal(calls.matrix, afterFirst.matrix);
  });
});

test('buildDistanceMatrix: only fetches the newly added place (incremental cache)', async () => {
  const { fetch, calls } = countingOrsStub();
  const cache = createOrsCache({ geo: {}, legs: {} });
  const people = [{ id: 'a', codePostal: '75001', ville: 'Paris' }];
  const places = [{ id: 'p1', codePostal: '44000', ville: 'Nantes' }];

  await withFetch(fetch, async () => {
    await buildDistanceMatrix('key', people, places, null, cache);
    const before = { ...calls };

    // Add a second place: only it needs geocoding + one matrix request.
    const places2 = [...places, { id: 'p2', codePostal: '69001', ville: 'Lyon' }];
    const m = await buildDistanceMatrix('key', people, places2, null, cache);
    assert.deepEqual(m.a.p1, { distanceM: 1000, durationS: 60 }); // from cache
    assert.deepEqual(m.a.p2, { distanceM: 1000, durationS: 60 }); // freshly fetched
    assert.equal(calls.geocode, before.geocode + 1); // only Lyon geocoded
    assert.equal(calls.matrix, before.matrix + 1);   // one extra matrix request
  });
});

test('geocode: returns coordinates of first feature', async () => {
  const stub = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ features: [{ geometry: { coordinates: [2.35, 48.85] } }] }),
  });
  await withFetch(stub, async () => {
    const coords = await geocode('key', '75001 Paris');
    assert.deepEqual(coords, [2.35, 48.85]);
  });
});
