// CSV / JSON import-export helpers + localStorage persistence.

export const STORAGE_KEY = 'lightOnDistance.state.v1';
export const SESSION_EXPORT_TARGET_URL = 'https://respiration-yoga.fr/light-on-distance/';
export const HTML_SESSION_MAX_TRIPS = 1000;

/** Build a plain serializable object from the app state (pure).
 *  Includes the cached OpenRouteService distance matrix so a session can be
 *  reloaded without re-running the routing calculations. */
export function serializeState(state) {
  return {
    apiKey: state.apiKey ?? '',
    consumption: state.consumption ?? '',
    fuelPrice: state.fuelPrice ?? '',
    people: (state.people || []).map((p) => ({
      id: p.id || cryptoId(), nom: p.nom || '', codePostal: p.codePostal || '', ville: p.ville || '',
    })),
    places: (state.places || []).map((p) => ({
      id: p.id || cryptoId(), quantite: p.quantite ?? 1, codePostal: p.codePostal || '', ville: p.ville || '',
    })),
    matrix: (state.matrix && typeof state.matrix === 'object') ? state.matrix : null,
  };
}

/** Build an exportable session, optionally including the sensitive ORS API key. */
export function serializeSessionForExport(state, { includeApiKey = false } = {}) {
  const session = serializeState(state);
  if (!includeApiKey) session.apiKey = '';
  return session;
}

/** Count the person/place grid size represented by a session. */
export function countSessionTrips(state) {
  const people = Array.isArray(state?.people) ? state.people.length : 0;
  const places = Array.isArray(state?.places) ? state.places.length : 0;
  return people * places;
}

export function canExportSessionHtml(state, maxTrips = HTML_SESSION_MAX_TRIPS) {
  return countSessionTrips(state) <= maxTrips;
}

export function encodeSessionPayload(session) {
  const json = JSON.stringify(session);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeSessionPayload(payload) {
  const normalized = String(payload || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function buildSessionRedirectUrl(encodedSession, targetUrl = SESSION_EXPORT_TARGET_URL, cacheBust = Date.now()) {
  const url = new URL(targetUrl);
  if (cacheBust !== '' && cacheBust != null) {
    url.searchParams.set('lod_v', String(cacheBust));
  }
  return `${url.toString()}#session=${encodedSession}`;
}

export function buildSessionRedirectHtml(session, targetUrl = SESSION_EXPORT_TARGET_URL, cacheBust = Date.now()) {
  const redirectUrl = buildSessionRedirectUrl(encodeSessionPayload(session), targetUrl, cacheBust);
  const redirect = JSON.stringify(redirectUrl);
  const href = escapeHtmlAttribute(redirectUrl);
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>lightOnDistance — Ouverture de session</title>
</head>
<body>
  <p>Ouverture de la session lightOnDistance...</p>
  <p><a href="${href}">Ouvrir la session</a></p>
  <script>
    location.replace(${redirect});
  </script>
</body>
</html>
`;
}

/** Normalize a parsed object back into a usable state (pure, tolerant). */
export function deserializeState(obj) {
  const data = obj || {};
  return {
    apiKey: typeof data.apiKey === 'string' ? data.apiKey : '',
    consumption: data.consumption != null ? data.consumption : '',
    fuelPrice: data.fuelPrice != null ? data.fuelPrice : '',
    people: Array.isArray(data.people)
      ? data.people.map((p) => ({
          id: p.id || cryptoId(), nom: p.nom || '', codePostal: p.codePostal || '', ville: p.ville || '',
        }))
      : [],
    places: Array.isArray(data.places)
      ? data.places.map((p) => ({
          id: p.id || cryptoId(), quantite: p.quantite ?? 1, codePostal: p.codePostal || '', ville: p.ville || '',
        }))
      : [],
    matrix: (data.matrix && typeof data.matrix === 'object') ? data.matrix : null,
  };
}

/** Persist state to localStorage (no-op if unavailable). */
export function saveToLocalStorage(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState(state)));
  } catch (_) { /* storage disabled / quota — ignore */ }
}

/** Load state from localStorage, or null if absent/invalid. */
export function loadFromLocalStorage() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return deserializeState(JSON.parse(raw));
  } catch (_) {
    return null;
  }
}

// ---- OpenRouteService response cache (persistent, keyed per address / per leg) ----

export const ORS_CACHE_KEY = 'lightOnDistance.orsCache.v1';

/** Stable key for a one-way leg between two address strings. */
export function legKey(originAddr, destAddr) {
  return `${originAddr} >> ${destAddr}`;
}

/**
 * Wrap a plain store `{ geo: {}, legs: {} }` with a get/set interface.
 * `geo`  : address -> [lon, lat] | null (null = "geocoded, not found").
 * `legs` : legKey -> { distanceM, durationS }.
 */
export function createOrsCache(store) {
  const s = store && typeof store === 'object' ? store : {};
  if (!s.geo || typeof s.geo !== 'object') s.geo = {};
  if (!s.legs || typeof s.legs !== 'object') s.legs = {};
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  return {
    data: s,
    hasGeo: (addr) => has(s.geo, addr),
    getGeo: (addr) => (has(s.geo, addr) ? s.geo[addr] : null),
    setGeo: (addr, coords) => { s.geo[addr] = coords ?? null; },
    hasLeg: (o, d) => has(s.legs, legKey(o, d)),
    getLeg: (o, d) => s.legs[legKey(o, d)],
    setLeg: (o, d, value) => { s.legs[legKey(o, d)] = value; },
  };
}

/** Load the cache store from localStorage (empty store if absent/unavailable). */
export function loadOrsCacheStore() {
  try {
    const raw = window.localStorage.getItem(ORS_CACHE_KEY);
    return raw ? JSON.parse(raw) : { geo: {}, legs: {} };
  } catch (_) {
    return { geo: {}, legs: {} };
  }
}

/** Persist the cache store to localStorage (no-op if unavailable). */
export function saveOrsCacheStore(store) {
  try {
    window.localStorage.setItem(ORS_CACHE_KEY, JSON.stringify(store));
  } catch (_) { /* storage disabled / quota — ignore */ }
}

/** Parse a people CSV. Handles `,` or `;` separators and an optional header. */
export function parsePeopleCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const sep = lines[0].includes(';') ? ';' : ',';
  const first = lines[0].toLowerCase();
  const hasHeader = first.includes('nom') || first.includes('ville') || first.includes('postal');
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines.map((line) => {
    const cols = splitCsvLine(line, sep);
    return {
      id: cryptoId(),
      nom: cols[0] || '',
      codePostal: cols[1] || '',
      ville: cols[2] || '',
    };
  });
}

/** Split a single CSV line, honoring double-quoted fields and escaped quotes. */
function splitCsvLine(line, sep) {
  const cols = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === sep) {
      cols.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cols.push(cur.trim());
  return cols;
}

/** Serialize people to CSV (with header, comma-separated). */
export function peopleToCsv(people) {
  const header = 'nom,code_postal,ville';
  const rows = people.map((p) => [p.nom, p.codePostal, p.ville].map(csvCell).join(','));
  return [header, ...rows].join('\n');
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function escapeHtmlAttribute(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Trigger a browser download of a text file. */
export function downloadFile(filename, content, type = 'text/plain') {
  const blob = new Blob([content], { type: type + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Read a File object as text. */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function cryptoId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2, 10);
}
