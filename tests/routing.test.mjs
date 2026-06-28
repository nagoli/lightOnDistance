import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  messageForStatus, toAddress, RoutingError, geocode, buildDistanceMatrix,
} from '../js/routing.js';

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
