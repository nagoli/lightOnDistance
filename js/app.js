import { computeRanking, formatDuration, metricStats } from './compute.js';
import { buildDistanceMatrix, RoutingError } from './routing.js';
import { renderCharts } from './charts.js';
import {
  parsePeopleCsv, peopleToCsv, downloadFile, readFileAsText, cryptoId,
  serializeState, deserializeState, saveToLocalStorage, loadFromLocalStorage,
  createOrsCache, loadOrsCacheStore, saveOrsCacheStore,
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
const chartView = $('#chart-view');
const tableView = $('#table-view');
const copyResultsBtn = $('#copy-results');
const resultsSection = $('#results-section');
const placesRecap = $('#places-recap');

let hasResults = false;

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
      inputCell(pl, 'codePostal', 'text'),
      inputCell(pl, 'ville', 'text'),
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
    const name = escapeHtml(pl.ville || pl.codePostal);
    const cp = pl.ville && pl.codePostal ? `<span class="recap-cp">${escapeHtml(pl.codePostal)}</span>` : '';
    return `<span class="recap-chip">${cp}<span class="recap-name">${name}</span><span class="recap-qty">×${Number(pl.quantite)}</span></span>`;
  }).join('');
  placesRecap.innerHTML = `<span class="recap-label">Lieux</span><div class="recap-chips">${chips}</div>`;
}

function renderResults(rows, errors) {
  resultsBody.innerHTML = '';
  hasResults = rows.length > 0;
  if (!hasResults) {
    statsPanel.hidden = true;
    chartView.hidden = true;
    tableView.hidden = true;
    placesRecap.hidden = true;
  } else {
    renderPlacesRecap();
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      if (r.isOutlier) tr.classList.add('outlier');
      tr.innerHTML = `
        <td>${r.rank}</td>
        <td>${escapeHtml(r.person.nom)}</td>
        <td>${r.km.toFixed(0)}</td>
        <td class="mult">×${r.multKm.toFixed(2)}</td>
        <td>${formatDuration(r.timeSeconds)}</td>
        <td class="mult">×${r.multTime.toFixed(2)}</td>
        <td>${r.cost.toFixed(2)}</td>
        <td class="mult">×${r.multCost.toFixed(2)}</td>`;
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
  time: { label: 'temps', unit: '', fmt: (v) => formatDuration(v) },
  cost: { label: 'coût', unit: '€', fmt: (v) => v.toFixed(2) },
};

function renderStats(stats, metric) {
  statsPanel.hidden = false;
  const m = STAT_METRIC[metric] || STAT_METRIC.km;
  const u = m.unit ? ' ' + m.unit : '';
  const f = (v) => m.fmt(v) + u;
  const minMaxRatio = stats.min > 0 ? stats.max / stats.min : 0;
  const cards = [
    [`Total (${m.label})`, f(stats.sum)],
    [`Médiane (${m.label})`, f(stats.median)],
    [`Min (${m.label})`, f(stats.min)],
    [`Max (${m.label})`, f(stats.max)],
    ['Coef. × min→max', '×' + minMaxRatio.toFixed(2), '×1 = équité parfaite (tout le monde identique)'],
    ['IQR / médiane', '×' + stats.iqrOverMedian.toFixed(2)],
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
  const data = serializeState(currentSnapshot());
  downloadFile('lightOnDistance.json', JSON.stringify(data, null, 2), 'application/json');
}

async function onImportJson(file) {
  const data = deserializeState(JSON.parse(await readFileAsText(file)));
  applyState(data);
  persist();
}

/** Apply a deserialized state object to inputs + tables, restoring cached results. */
function applyState(data) {
  if (data.apiKey) apiKeyInput.value = data.apiKey;
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
  $('#import-json-btn').addEventListener('click', () => $('#import-json').click());
  $('#import-json').addEventListener('change', (e) => e.target.files[0] && onImportJson(e.target.files[0]));

  $('#compute').addEventListener('click', onCompute);

  const saved = loadFromLocalStorage();
  if (saved) {
    applyState(saved);
  } else {
    renderPeople();
    renderPlaces();
  }
}

init();
