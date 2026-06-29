import { computeRanking, formatDurationForDisplay, metricStats } from './compute.js';
import { buildDistanceMatrix, RoutingError } from './routing.js';
import { renderCharts } from './charts.js';
import { buildResultsSvg } from './share-image.js';
import {
  parsePeopleCsv, peopleToCsv, downloadFile, readFileAsText, cryptoId,
  deserializeState, saveToLocalStorage, loadFromLocalStorage,
  createOrsCache, loadOrsCacheStore, saveOrsCacheStore,
  serializeSessionForExport, buildSessionRedirectHtml, canExportSessionHtml,
  countSessionTrips, decodeSessionPayload, HTML_SESSION_MAX_TRIPS,
} from './storage.js';

// ---- State ----
const state = {
  people: [],
  places: defaultPlaces(),
  matrix: null, // cached OpenRouteService results (person.id -> place.id -> {distanceM, durationS}|{error})
};

function defaultPlaces() {
  return [
    { id: cryptoId(), quantite: 1, codePostal: '56480', ville: 'Mélionnec' },
    { id: cryptoId(), quantite: 1, codePostal: '71100', ville: 'Chalon-sur-Saône' },
    { id: cryptoId(), quantite: 1, codePostal: '71460', ville: 'Burzy' },
    { id: cryptoId(), quantite: 1, codePostal: '30580', ville: 'Fons-sur-Lussan' },
    { id: cryptoId(), quantite: 1, codePostal: '', ville: '' }, // lieu près d'Albi — à compléter
  ];
}

// ---- DOM refs ----
const $ = (sel) => document.querySelector(sel);
const peopleBody = $('#people-table tbody');
const placesBody = $('#places-table tbody');
const statusEl = $('#status');
const resultsBody = $('#results-table tbody');
const statsPanel = $('#stats-panel');
const errorsPanel = $('#errors-panel');
const apiKeyInput = $('#api-key');
const consumptionInput = $('#consumption');
const fuelPriceInput = $('#fuel-price');
const includeApiKeyInput = $('#include-api-key');
const chartView = $('#chart-view');
const tableView = $('#table-view');
const copyResultsBtn = $('#copy-results');
const placesRecap = $('#places-recap');

let hasResults = false;
let lastRows = [];
let lastErrors = [];
let lastMetric = 'km';

// Persistent cache of OpenRouteService responses (geocoding + legs), survives reloads.
const orsCache = createOrsCache(loadOrsCacheStore());

// ---- Persistence ----
function currentSnapshot() {
  return {
    people: state.people,
    places: state.places,
    matrix: state.matrix,
    apiKey: apiKeyInput.value,
    consumption: consumptionInput.value,
    fuelPrice: fuelPriceInput.value,
  };
}

function persist() {
  saveToLocalStorage(currentSnapshot());
}

/** Invalidate cached routing results (called when people/places change). */
function invalidateMatrix() {
  state.matrix = null;
  hasResults = false;
  lastRows = [];
  lastErrors = [];
  chartView.hidden = true;
  tableView.hidden = true;
  statsPanel.hidden = true;
  errorsPanel.hidden = true;
  placesRecap.hidden = true;
  copyResultsBtn.disabled = true;
  hideStatus();
  persist();
}

/** Recompute the ranking from the cached matrix (no routing call) and render it. */
function recomputeFromCache() {
  if (!state.matrix) return;
  const people = state.people.filter((p) => p.nom && (p.codePostal || p.ville));
  const places = state.places.filter((pl) => (Number(pl.quantite) > 0) && (pl.codePostal || pl.ville));
  const params = {
    consumption: parseFloat(consumptionInput.value) || 0,
    fuelPrice: parseFloat(fuelPriceInput.value) || 0,
  };
  const { rows, errors } = computeRanking(people, places, state.matrix, params, $('#sort-by').value);
  renderResults(rows, errors);
}

// ---- People table ----
function renderPeople() {
  peopleBody.innerHTML = '';
  state.people.forEach((p) => {
    const tr = document.createElement('tr');
    tr.append(
      inputCell(p, 'nom', 'text'),
      inputCell(p, 'codePostal', 'text'),
      inputCell(p, 'ville', 'text'),
      deleteCell(() => { state.people = state.people.filter((x) => x !== p); renderPeople(); invalidateMatrix(); }),
    );
    peopleBody.appendChild(tr);
  });
}

// ---- Places table ----
function renderPlaces() {
  placesBody.innerHTML = '';
  state.places.forEach((pl) => {
    const tr = document.createElement('tr');
    const qtyCell = document.createElement('td');
    const qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.min = '0';
    qtyInput.className = 'qty';
    qtyInput.value = pl.quantite;
    qtyInput.addEventListener('input', () => { pl.quantite = qtyInput.value; invalidateMatrix(); });
    qtyCell.appendChild(qtyInput);

    tr.append(
      qtyCell,
      inputCell(pl, 'ville', 'text'),
      inputCell(pl, 'codePostal', 'text'),
      deleteCell(() => { state.places = state.places.filter((x) => x !== pl); renderPlaces(); invalidateMatrix(); }),
    );
    placesBody.appendChild(tr);
  });
}

function inputCell(obj, key, type) {
  const td = document.createElement('td');
  const input = document.createElement('input');
  input.type = type;
  input.value = obj[key] ?? '';
  input.addEventListener('input', () => { obj[key] = input.value; invalidateMatrix(); });
  td.appendChild(input);
  return td;
}

function deleteCell(onClick) {
  const td = document.createElement('td');
  const btn = document.createElement('button');
  btn.textContent = '✕';
  btn.className = 'danger-link';
  btn.title = 'Supprimer';
  btn.addEventListener('click', onClick);
  td.appendChild(btn);
  return td;
}

// ---- Status helpers ----
function showStatus(msg, isError = false) {
  statusEl.hidden = false;
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
}
function hideStatus() { statusEl.hidden = true; }

// ---- Compute ----
async function onCompute() {
  const apiKey = $('#api-key').value.trim();
  const consumption = parseFloat($('#consumption').value) || 0;
  const fuelPrice = parseFloat($('#fuel-price').value) || 0;
  const sortBy = $('#sort-by').value;

  const people = state.people.filter((p) => p.nom && (p.codePostal || p.ville));
  const places = state.places.filter((pl) => (Number(pl.quantite) > 0) && (pl.codePostal || pl.ville));

  if (!apiKey) return showStatus('Veuillez saisir une clé API OpenRouteService.', true);
  if (!people.length) return showStatus('Aucune personne valide (nom + code postal/ville requis).', true);
  if (!places.length) return showStatus('Aucun lieu valide (quantité > 0 + code postal/ville requis).', true);

  try {
    const matrix = await buildDistanceMatrix(apiKey, people, places, (done, total, label) => {
      showStatus(`${label}… (${done}/${total})`);
    }, orsCache);
    saveOrsCacheStore(orsCache.data); // persist reusable ORS responses

    state.matrix = matrix; // cache so the session can be reloaded without recomputing
    const { rows, errors } = computeRanking(people, places, matrix, { consumption, fuelPrice }, sortBy);
    renderResults(rows, errors);
    persist();
    hideStatus();
  } catch (err) {
    saveOrsCacheStore(orsCache.data); // keep whatever was fetched before the failure
    showStatus(formatComputeError(err), true);
  }
}

/** Build a clear status message, with hints for connection issues. */
function formatComputeError(err) {
  if (err instanceof RoutingError) {
    if (err.kind === 'network') {
      return 'Problème de connexion au service de calcul de distance (OpenRouteService). '
        + 'Vérifiez votre connexion internet, puis relancez le calcul. '
        + 'Vos données et les distances déjà calculées sont conservées.';
    }
    if (err.kind === 'quota') {
      return err.message + ' Le quota du plan gratuit OpenRouteService est limité ; patientez avant de réessayer.';
    }
    if (err.kind === 'auth') {
      return err.message + ' Vérifiez la clé saisie dans la section Configuration.';
    }
    if (err.kind === 'service') {
      return err.message + ' Le service est peut-être momentanément hors ligne.';
    }
    return err.message;
  }
  return 'Erreur inattendue : ' + (err?.message || err);
}

// ---- Results rendering ----
function renderPlacesRecap() {
  const places = state.places.filter((pl) => (Number(pl.quantite) > 0) && (pl.codePostal || pl.ville));
  if (!places.length) { placesRecap.hidden = true; return; }
  placesRecap.hidden = false;
  const chips = places.map((pl) => {
    const name = escapeHtml(pl.ville || 'Lieu sans ville');
    return `<span class="recap-chip"><span class="recap-qty">×${Number(pl.quantite)}</span><span class="recap-name">${name}</span></span>`;
  }).join('');
  placesRecap.innerHTML = `<span class="recap-label">Lieux</span><div class="recap-chips">${chips}</div>`;
}

function renderResults(rows, errors) {
  resultsBody.innerHTML = '';
  hasResults = rows.length > 0;
  copyResultsBtn.disabled = !hasResults;
  lastMetric = $('#sort-by').value;
  lastRows = hasResults ? rows : [];
  lastErrors = errors || [];
  if (!hasResults) {
    statsPanel.hidden = true;
    chartView.hidden = true;
    tableView.hidden = true;
    placesRecap.hidden = true;
  } else {
    renderPlacesRecap();
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.rank}</td>
        <td>${escapeHtml(r.person.nom)}</td>
        <td>${r.km.toFixed(0)}</td>
        <td class="mult">×${r.multKm.toFixed(2)}</td>
        <td>${formatDurationForDisplay(r.timeSeconds)}</td>
        <td>${r.cost.toFixed(2)}</td>`;
      resultsBody.appendChild(tr);
    });
    const metric = $('#sort-by').value;
    const stats = metricStats(rows, metric);
    renderStats(stats, metric);
    renderCharts(chartView, rows, metric);
    chartView.hidden = false;
    tableView.hidden = false;
  }
  renderErrors(errors);
}

// Metric → {label, unit, fmt} for the stat cards.
const STAT_METRIC = {
  km: { label: 'km', unit: 'km', fmt: (v) => v.toFixed(0) },
  time: { label: 'temps', unit: '', fmt: (v) => formatDurationForDisplay(v) },
  cost: { label: 'coût', unit: '€', fmt: (v) => v.toFixed(2) },
};

function renderStats(stats, metric) {
  statsPanel.hidden = false;
  const m = STAT_METRIC[metric] || STAT_METRIC.km;
  const u = m.unit ? ' ' + m.unit : '';
  const f = (v) => m.fmt(v) + u;
  const minMaxRatio = stats.min > 0 ? stats.max / stats.min : 0;
  const cards = [
    ['Total', f(stats.sum)],
    ['Médiane', f(stats.median)],
    ['Min / max', `${f(stats.min)} → ${f(stats.max)}`],
    ['Coef. × min→max', '×' + minMaxRatio.toFixed(2), '×1 = équité parfaite (tout le monde identique)'],
    ['Gini (inégalité)', stats.gini.toFixed(3), '0 = équité parfaite · 1 = max inégal'],
  ];
  statsPanel.innerHTML = cards.map(([label, value, hint]) => `
    <div class="stat-card">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      ${hint ? `<div class="stat-hint">${hint}</div>` : ''}
    </div>
  `).join('');
}

function renderErrors(errors) {
  if (!errors || !errors.length) { errorsPanel.hidden = true; return; }
  errorsPanel.hidden = false;
  errorsPanel.innerHTML = `<strong>Personnes exclues (${errors.length}) :</strong><ul>` +
    errors.map((e) => `<li>${escapeHtml(e.nom || '(sans nom)')} — ${escapeHtml(e.message)}</li>`).join('') +
    '</ul>';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ---- Copy/download results as image ----

/** Trigger a blob download (fallback when clipboard image write is unavailable). */
function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 30_000);
}

/** True if the browser can write an image to the clipboard via ClipboardItem. */
function canWriteImageClipboard(type = 'image/png') {
  return typeof ClipboardItem !== 'undefined'
    && (!ClipboardItem.supports || ClipboardItem.supports(type))
    && navigator.clipboard && typeof navigator.clipboard.write === 'function';
}

/** Convert the standalone SVG export into a PNG blob for clipboard support. */
async function svgToPngBlob(svg, width, height) {
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.decoding = 'sync';
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Le rendu PNG a échoué.'));
      img.src = url;
    });

    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas indisponible.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('Aucune image PNG générée.');
    return png;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function onCopyResults() {
  if (!hasResults || !lastRows.length) return;
  copyResultsBtn.disabled = true;
  let image;
  try {
    image = buildResultsSvg({
      rows: lastRows,
      places: state.places,
      metric: lastMetric,
      errors: lastErrors,
      generatedAt: new Date(),
    });
  } catch (err) {
    showStatus('Impossible de générer l\'image : ' + (err?.message || err), true);
    copyResultsBtn.disabled = !hasResults;
    return;
  }

  let pngBlob = null;
  let pngError = null;
  try {
    pngBlob = await svgToPngBlob(image.svg, image.width, image.height);
  } catch (err) {
    pngError = err;
  }

  if (!pngBlob) {
    downloadBlob('palmares.svg', new Blob([image.svg], { type: 'image/svg+xml;charset=utf-8' }));
    showStatus('Conversion PNG impossible (' + (pngError?.message || pngError)
      + ') — image SVG téléchargée (palmares.svg).', true);
    copyResultsBtn.disabled = !hasResults;
    return;
  }

  // Try clipboard write; on any failure, fall back to PNG download.
  if (canWriteImageClipboard()) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      showStatus('Résultats copiés dans le presse-papier (image).');
      copyResultsBtn.disabled = !hasResults;
      return;
    } catch (err) {
      downloadBlob('palmares.png', pngBlob);
      showStatus('Copie dans le presse-papier impossible (' + (err?.message || err)
        + ') — PNG téléchargé (palmares.png).', true);
      copyResultsBtn.disabled = !hasResults;
      return;
    }
  }
  downloadBlob('palmares.png', pngBlob);
  showStatus('Copie d\'image non supportée par ce navigateur — PNG téléchargé (palmares.png).');
  copyResultsBtn.disabled = !hasResults;
}

// ---- Import / Export ----
async function onImportCsv(file) {
  const text = await readFileAsText(file);
  state.people = parsePeopleCsv(text);
  renderPeople();
  invalidateMatrix();
}

function onExportCsv() {
  downloadFile('personnes.csv', peopleToCsv(state.people), 'text/csv');
}

function onExportJson() {
  const data = serializeSessionForExport(currentSnapshot(), { includeApiKey: includeApiKeyInput.checked });
  downloadFile('lightOnDistance.json', JSON.stringify(data, null, 2), 'application/json');
}

function onExportHtml() {
  const data = serializeSessionForExport(currentSnapshot(), { includeApiKey: includeApiKeyInput.checked });
  const trips = countSessionTrips(data);
  if (!canExportSessionHtml(data)) {
    showStatus(`Export HTML limité à ${HTML_SESSION_MAX_TRIPS} trajets : cette session en contient ${trips}. Utilisez l'export JSON.`, true);
    return;
  }
  downloadFile('lightOnDistance.html', buildSessionRedirectHtml(data), 'text/html');
}

async function onImportJson(file) {
  const data = deserializeState(JSON.parse(await readFileAsText(file)));
  applyState(data);
  persist();
}

/** Apply a deserialized state object to inputs + tables, restoring cached results. */
function applyState(data) {
  apiKeyInput.value = data.apiKey || '';
  if (data.consumption !== '') consumptionInput.value = data.consumption;
  if (data.fuelPrice !== '') fuelPriceInput.value = data.fuelPrice;
  state.people = data.people;
  state.places = data.places;
  state.matrix = data.matrix || null;
  renderPeople();
  renderPlaces();
  if (state.matrix) {
    recomputeFromCache(); // restore the palmarès without calling the routing service
  } else {
    hasResults = false;
    chartView.hidden = true;
    tableView.hidden = true;
    statsPanel.hidden = true;
    errorsPanel.hidden = true;
    placesRecap.hidden = true;
  }
}

function loadSessionFromHash() {
  const hash = window.location.hash || '';
  if (!hash) return null;
  const params = new URLSearchParams(hash.slice(1));
  const payload = params.get('session');
  if (!payload) return null;
  try {
    const data = deserializeState(decodeSessionPayload(payload));
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return data;
  } catch (err) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    showStatus('Session HTML illisible : utilisez le fichier JSON via Importer la session.', true);
    return null;
  }
}

// ---- Wire up events ----
function init() {
  $('#add-person').addEventListener('click', () => {
    state.people.push({ id: cryptoId(), nom: '', codePostal: '', ville: '' });
    renderPeople();
    persist();
  });
  $('#add-place').addEventListener('click', () => {
    state.places.push({ id: cryptoId(), quantite: 1, codePostal: '', ville: '' });
    renderPlaces();
    persist();
  });

  apiKeyInput.addEventListener('input', persist);
  // conso/prix ne nécessitent pas d'appel routing : on recalcule depuis le cache
  [consumptionInput, fuelPriceInput].forEach((el) =>
    el.addEventListener('input', () => { persist(); recomputeFromCache(); }));
  $('#sort-by').addEventListener('change', recomputeFromCache);

  $('#import-csv-btn').addEventListener('click', () => $('#import-csv').click());
  $('#import-csv').addEventListener('change', (e) => e.target.files[0] && onImportCsv(e.target.files[0]));
  $('#export-csv').addEventListener('click', onExportCsv);

  $('#export-json').addEventListener('click', onExportJson);
  $('#export-html').addEventListener('click', onExportHtml);
  $('#import-json-btn').addEventListener('click', () => $('#import-json').click());
  $('#import-json').addEventListener('change', (e) => e.target.files[0] && onImportJson(e.target.files[0]));

  $('#compute').addEventListener('click', onCompute);
  copyResultsBtn.addEventListener('click', onCopyResults);

  const shared = loadSessionFromHash();
  const saved = shared || loadFromLocalStorage();
  if (saved) {
    applyState(saved);
    if (shared) {
      persist();
      showStatus('Session importée depuis le fichier HTML.');
    }
  } else {
    renderPeople();
    renderPlaces();
  }
}

init();
