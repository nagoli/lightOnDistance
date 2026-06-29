import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePeopleCsv, peopleToCsv, serializeState, deserializeState,
  loadFromLocalStorage, cryptoId, createOrsCache, legKey,
  serializeSessionForExport, encodeSessionPayload, decodeSessionPayload,
  buildSessionRedirectUrl, buildSessionRedirectHtml, countSessionTrips, canExportSessionHtml,
  SESSION_EXPORT_TARGET_URL,
} from '../js/storage.js';

test('parsePeopleCsv: header + comma separator', () => {
  const csv = 'nom,code_postal,ville\nAlice,75001,Paris\nBob,69001,Lyon';
  const people = parsePeopleCsv(csv);
  assert.equal(people.length, 2);
  assert.deepEqual(
    people.map(({ nom, codePostal, ville }) => ({ nom, codePostal, ville })),
    [
      { nom: 'Alice', codePostal: '75001', ville: 'Paris' },
      { nom: 'Bob', codePostal: '69001', ville: 'Lyon' },
    ],
  );
  assert.ok(people.every((p) => p.id));
});

test('parsePeopleCsv: semicolon separator (Excel FR) without header', () => {
  const csv = 'Alice;75001;Paris\nBob;69001;Lyon';
  const people = parsePeopleCsv(csv);
  assert.equal(people.length, 2);
  assert.equal(people[0].ville, 'Paris');
});

test('parsePeopleCsv: handles quoted fields and blank lines', () => {
  const csv = 'nom,code_postal,ville\n"Doe, John",75001,Paris\n\n';
  const people = parsePeopleCsv(csv);
  assert.equal(people.length, 1);
  assert.equal(people[0].nom, 'Doe, John');
});

test('peopleToCsv: round-trips through parse', () => {
  const original = [
    { id: 'x', nom: 'Doe, John', codePostal: '75001', ville: 'Paris' },
  ];
  const csv = peopleToCsv(original);
  assert.ok(csv.startsWith('nom,code_postal,ville'));
  const back = parsePeopleCsv(csv);
  assert.equal(back[0].nom, 'Doe, John');
  assert.equal(back[0].codePostal, '75001');
});

test('serializeState: normalizes and fills ids', () => {
  const out = serializeState({
    apiKey: 'k', consumption: '6', fuelPrice: '2',
    people: [{ nom: 'A' }],
    places: [{ ville: 'X' }],
  });
  assert.equal(out.apiKey, 'k');
  assert.ok(out.people[0].id);
  assert.equal(out.people[0].codePostal, '');
  assert.equal(out.places[0].quantite, 1); // default
});

test('deserializeState: tolerant of missing/invalid fields', () => {
  const out = deserializeState({ people: 'nope' });
  assert.deepEqual(out.people, []);
  assert.deepEqual(out.places, []);
  assert.equal(out.apiKey, '');
  assert.equal(out.consumption, '');
});

test('serialize -> deserialize is stable', () => {
  const state = {
    apiKey: 'key', consumption: '7', fuelPrice: '1.9',
    people: [{ id: 'a', nom: 'Alice', codePostal: '75001', ville: 'Paris' }],
    places: [{ id: 'p', quantite: 3, codePostal: '56480', ville: 'Mélionnec' }],
  };
  const round = deserializeState(serializeState(state));
  assert.deepEqual(round, {
    apiKey: 'key', consumption: '7', fuelPrice: '1.9',
    people: [{ id: 'a', nom: 'Alice', codePostal: '75001', ville: 'Paris' }],
    places: [{ id: 'p', quantite: 3, codePostal: '56480', ville: 'Mélionnec' }],
    matrix: null,
  });
});

test('serialize/deserialize preserves the cached distance matrix (session reload)', () => {
  const matrix = {
    a: { p: { distanceM: 100000, durationS: 3600 } },
    b: { p: { error: 'ZERO_RESULTS' } },
  };
  const out = serializeState({
    apiKey: '', consumption: '6', fuelPrice: '2',
    people: [{ id: 'a', nom: 'A' }, { id: 'b', nom: 'B' }],
    places: [{ id: 'p', quantite: 1, ville: 'X' }],
    matrix,
  });
  assert.deepEqual(out.matrix, matrix);
  const round = deserializeState(out);
  assert.deepEqual(round.matrix, matrix);
});

test('serializeSessionForExport: excludes the ORS key by default', () => {
  const out = serializeSessionForExport({
    apiKey: 'secret-key',
    consumption: '6',
    fuelPrice: '2',
    people: [{ id: 'a', nom: 'A' }],
    places: [{ id: 'p', ville: 'Mélionnec' }],
  });
  assert.equal(out.apiKey, '');
});

test('serializeSessionForExport: includes the ORS key when requested', () => {
  const out = serializeSessionForExport({
    apiKey: 'secret-key',
    people: [],
    places: [],
  }, { includeApiKey: true });
  assert.equal(out.apiKey, 'secret-key');
});

test('session payload encoding is stable and unicode-safe', () => {
  const session = {
    apiKey: '',
    people: [{ id: 'a', nom: 'Élodie', codePostal: '75001', ville: 'Paris' }],
    places: [{ id: 'p', quantite: 1, codePostal: '56480', ville: 'Mélionnec' }],
    matrix: { a: { p: { distanceM: 12345, durationS: 678 } } },
  };
  const encoded = encodeSessionPayload(session);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeSessionPayload(encoded), session);
});

test('buildSessionRedirectHtml: contains the target URL and encoded session', () => {
  const session = serializeSessionForExport({ people: [], places: [] });
  const encoded = encodeSessionPayload(session);
  const redirectUrl = buildSessionRedirectUrl(encoded, SESSION_EXPORT_TARGET_URL, 12345);
  const html = buildSessionRedirectHtml(session, SESSION_EXPORT_TARGET_URL, 12345);
  assert.equal(redirectUrl, `${SESSION_EXPORT_TARGET_URL}?lod_v=12345#session=${encoded}`);
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, new RegExp(SESSION_EXPORT_TARGET_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /\?lod_v=12345#session=/);
  assert.match(html, new RegExp(encoded));
  assert.match(html, /#session=/);
});

test('HTML session export limit: 1000 trips accepted, 1001 refused', () => {
  const people = Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, nom: `P${i}` }));
  const tenPlaces = Array.from({ length: 10 }, (_, i) => ({ id: `l${i}`, ville: `L${i}` }));
  const elevenPlaces = Array.from({ length: 11 }, (_, i) => ({ id: `l${i}`, ville: `L${i}` }));

  assert.equal(countSessionTrips({ people, places: tenPlaces }), 1000);
  assert.equal(countSessionTrips({ people, places: elevenPlaces }), 1100);
  assert.equal(canExportSessionHtml({ people, places: tenPlaces }), true);
  assert.equal(canExportSessionHtml({ people, places: elevenPlaces }), false);
});

test('deserializeState: matrix defaults to null when absent or invalid', () => {
  assert.equal(deserializeState({}).matrix, null);
  assert.equal(deserializeState({ matrix: 'nope' }).matrix, null);
});

test('loadFromLocalStorage: returns null when storage unavailable (node)', () => {
  // window is undefined in node -> guarded, must not throw
  assert.equal(loadFromLocalStorage(), null);
});

test('cryptoId: returns a non-empty unique string', () => {
  const a = cryptoId();
  const b = cryptoId();
  assert.ok(a && b && a !== b);
});

test('legKey: stable and direction-sensitive', () => {
  assert.equal(legKey('A', 'B'), 'A >> B');
  assert.notEqual(legKey('A', 'B'), legKey('B', 'A'));
});

test('createOrsCache: stores/reads geocodes (incl. cached null) and legs', () => {
  const store = { geo: {}, legs: {} };
  const cache = createOrsCache(store);

  assert.equal(cache.hasGeo('75001 Paris'), false);
  cache.setGeo('75001 Paris', [2.35, 48.85]);
  assert.equal(cache.hasGeo('75001 Paris'), true);
  assert.deepEqual(cache.getGeo('75001 Paris'), [2.35, 48.85]);

  // "geocoded, not found" must be remembered (don't retry forever)
  cache.setGeo('Nowhere', null);
  assert.equal(cache.hasGeo('Nowhere'), true);
  assert.equal(cache.getGeo('Nowhere'), null);

  assert.equal(cache.hasLeg('A', 'B'), false);
  cache.setLeg('A', 'B', { distanceM: 1000, durationS: 60 });
  assert.equal(cache.hasLeg('A', 'B'), true);
  assert.deepEqual(cache.getLeg('A', 'B'), { distanceM: 1000, durationS: 60 });

  // mutations are reflected into the backing store (persisted as-is)
  assert.deepEqual(store.geo['75001 Paris'], [2.35, 48.85]);
  assert.deepEqual(store.legs['A >> B'], { distanceM: 1000, durationS: 60 });
});

test('createOrsCache: tolerates an empty/invalid store', () => {
  const cache = createOrsCache(undefined);
  assert.equal(cache.hasGeo('x'), false);
  assert.deepEqual(cache.data, { geo: {}, legs: {} });
});
