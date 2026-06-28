import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePeopleCsv, peopleToCsv, serializeState, deserializeState,
  loadFromLocalStorage, cryptoId,
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
