// CSV / JSON import-export helpers + localStorage persistence.

export const STORAGE_KEY = 'lightOnDistance.state.v1';

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
