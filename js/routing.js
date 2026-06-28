// OpenRouteService client (browser-side, no backend): geocoding + distance matrix.
// Free API docs: https://openrouteservice.org/dev/#/api-docs

const ORS_BASE = 'https://api.openrouteservice.org';
const PROFILE = 'driving-car';

/** Error carrying a user-facing message and a kind to distinguish connection issues. */
export class RoutingError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.name = 'RoutingError';
    this.kind = kind; // 'network' | 'auth' | 'quota' | 'request' | 'service' | 'unknown'
    this.status = status;
  }
}

/** Map an HTTP status to a clear, user-facing French message. */
export function messageForStatus(status, detail) {
  const extra = detail ? ` (${detail})` : '';
  if (status === 401 || status === 403) {
    return { kind: 'auth', message: 'Clé API OpenRouteService invalide ou non autorisée.' + extra };
  }
  if (status === 429) {
    return { kind: 'quota', message: 'Limite de requêtes OpenRouteService atteinte (quota). Réessayez plus tard.' + extra };
  }
  if (status === 400 || status === 404 || status === 422) {
    return { kind: 'request', message: 'Requête refusée par OpenRouteService (adresse ou paramètre invalide).' + extra };
  }
  if (status >= 500) {
    return { kind: 'service', message: 'Service OpenRouteService temporairement indisponible. Réessayez plus tard.' + extra };
  }
  return { kind: 'unknown', message: `Erreur OpenRouteService (HTTP ${status}).` + extra };
}

/** fetch wrapper that turns connection/HTTP problems into a RoutingError. */
async function fetchJson(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (_) {
    // Thrown for offline / DNS / CORS / aborted connections.
    throw new RoutingError('network', 'Impossible de contacter OpenRouteService. Vérifiez votre connexion internet.');
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || (typeof body?.error === 'string' ? body.error : '') || '';
    } catch (_) { /* no JSON body */ }
    const { kind, message } = messageForStatus(res.status, detail);
    throw new RoutingError(kind, message, res.status);
  }
  try {
    return await res.json();
  } catch (_) {
    throw new RoutingError('service', 'Réponse invalide reçue d\'OpenRouteService.');
  }
}

/** Build a geocoding query string for a person/place. */
export function toAddress(item) {
  return [item.codePostal, item.ville].filter(Boolean).join(' ').trim();
}

/** Geocode an address -> [lon, lat], or null if not found. */
export async function geocode(apiKey, address) {
  const url = `${ORS_BASE}/geocode/search?api_key=${encodeURIComponent(apiKey)}`
    + `&text=${encodeURIComponent(address)}&boundary.country=FR&size=1`;
  const data = await fetchJson(url);
  const feature = data.features && data.features[0];
  if (!feature?.geometry?.coordinates) return null;
  return feature.geometry.coordinates; // [lon, lat]
}

/** Request a distance/duration matrix between source and destination coordinates. */
export async function requestMatrix(apiKey, sourceCoords, destCoords) {
  const locations = [...sourceCoords, ...destCoords];
  const sources = sourceCoords.map((_, i) => i);
  const destinations = destCoords.map((_, i) => sourceCoords.length + i);
  const data = await fetchJson(`${ORS_BASE}/v2/matrix/${PROFILE}`, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations, sources, destinations, metrics: ['distance', 'duration'], units: 'm' }),
  });
  return data; // { distances: [[m]], durations: [[s]] }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Geocode everyone + every place, then build the one-way matrix
 * matrix[personId][placeId] = {distanceM, durationS} | {error}.
 *
 * @param {function} onProgress (done, total, label)
 */
export async function buildDistanceMatrix(apiKey, people, places, onProgress) {
  const matrix = {};
  people.forEach((p) => { matrix[p.id] = {}; });

  // 1) Geocode unique addresses (deduplicated cache).
  const cache = new Map();
  const targets = [...people, ...places];
  const totalGeo = targets.length;
  let geoDone = 0;
  for (const t of targets) {
    const addr = toAddress(t);
    if (!cache.has(addr)) cache.set(addr, await geocode(apiKey, addr));
    t._coords = cache.get(addr);
    geoDone += 1;
    if (onProgress) onProgress(geoDone, totalGeo, 'Géocodage des adresses');
  }

  // Mark places that could not be geocoded as errors for everyone.
  const goodPlaces = places.filter((pl) => pl._coords);
  for (const person of people) {
    for (const pl of places) {
      if (!pl._coords) matrix[person.id][pl.id] = { error: 'GEOCODE_PLACE' };
    }
    if (!person._coords) {
      for (const pl of places) matrix[person.id][pl.id] = { error: 'GEOCODE_PERSON' };
    }
  }
  const goodPeople = people.filter((p) => p._coords);

  // 2) Matrix requests, chunked to respect ORS limits (<=50 locations / request).
  const placeChunks = chunk(goodPlaces, 20);
  let matDone = 0;
  const matTotal = placeChunks.reduce((acc, pc) =>
    acc + chunk(goodPeople, Math.max(1, 50 - pc.length)).length, 0) || 1;

  for (const placeChunk of placeChunks) {
    const peopleChunks = chunk(goodPeople, Math.max(1, 50 - placeChunk.length));
    for (const peopleChunk of peopleChunks) {
      const result = await requestMatrix(
        apiKey,
        peopleChunk.map((p) => p._coords),
        placeChunk.map((pl) => pl._coords),
      );
      peopleChunk.forEach((person, i) => {
        placeChunk.forEach((place, j) => {
          const distanceM = result.distances?.[i]?.[j];
          const durationS = result.durations?.[i]?.[j];
          if (distanceM == null || durationS == null) {
            matrix[person.id][place.id] = { error: 'NO_ROUTE' };
          } else {
            matrix[person.id][place.id] = { distanceM, durationS };
          }
        });
      });
      matDone += 1;
      if (onProgress) onProgress(matDone, matTotal, 'Calcul des distances');
    }
  }

  // cleanup temp field
  targets.forEach((t) => { delete t._coords; });
  return matrix;
}
