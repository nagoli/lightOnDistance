// SVG charts (no dependency, responsive). Renders a ranking bar chart and a
// distribution (box + dot strip) chart, with statistics annotations baked in.

import { formatDuration, mean, median, quantile } from './compute.js';

// ---- Pure helpers (tested) ----

/** Round a value up to a "nice" axis maximum (1, 2, 2.5, 5, 10 × 10^k). */
export function niceMax(v) {
  if (!isFinite(v) || v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  const f = v / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * base;
}

/** Linear scale: maps [d0,d1] onto [r0,r1] (guards a zero-width domain). */
export function linearScale(d0, d1, r0, r1) {
  const span = (d1 - d0) || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** Evenly spaced ticks from 0 to max (inclusive), count+1 values. */
export function ticks(max, count = 4) {
  return Array.from({ length: count + 1 }, (_, i) => (max / count) * i);
}

// ---- Metric configuration ----

const METRICS = {
  km: { label: 'kilomètres', unit: 'km', get: (r) => r.km, mult: (r) => r.multKm, fmt: fmtNum },
  time: { label: 'temps', unit: '', get: (r) => r.timeSeconds, mult: (r) => r.multTime, fmt: formatDuration },
  cost: { label: 'coût', unit: '€', get: (r) => r.cost, mult: (r) => r.multCost, fmt: fmtNum },
};

function fmtNum(v) { return Math.round(v).toLocaleString('fr-FR'); }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ---- Public API ----

/** Render both charts into `container`. */
export function renderCharts(container, rows, stats, metric = 'km') {
  container.innerHTML =
    `<figure class="chart">
      <figcaption>Classement par ${METRICS[metric]?.label || 'kilomètres'}</figcaption>
      ${rankingChart(rows, metric)}
    </figure>
    <figure class="chart">
      <figcaption>Répartition des kilomètres &mdash; qui sort du lot&nbsp;?</figcaption>
      ${distributionChart(rows, stats)}
    </figure>`;
}

// ---- Ranking bar chart (follows the selected metric) ----

function rankingChart(rows, metric) {
  const m = METRICS[metric] || METRICS.km;
  const values = rows.map(m.get);
  const maxV = niceMax(Math.max(...values, 0));
  const med = median(values);
  const mn = mean(values);

  const W = 760;
  const rowH = 34;
  const top = 70;
  const bottom = 26;
  const leftPad = 142;
  const rightPad = 104;
  const n = rows.length;
  const plotW = W - leftPad - rightPad;
  const H = top + n * rowH + bottom;
  const x = linearScale(0, maxV, leftPad, leftPad + plotW);
  const lineTop = top - 10;
  const lineBottom = top + n * rowH + 4;

  // light gridlines + bottom tick labels
  const grid = ticks(maxV, 4).map((t) => {
    const gx = x(t).toFixed(1);
    return `<line x1="${gx}" y1="${lineTop}" x2="${gx}" y2="${lineBottom}" class="ax-grid" />
            <text x="${gx}" y="${H - 8}" class="ax-tick" text-anchor="middle">${m.fmt(t)}</text>`;
  }).join('');

  const bars = rows.map((r, i) => {
    const v = m.get(r);
    const y = top + i * rowH + (rowH - 18) / 2;
    const w = Math.max(1, x(v) - leftPad);
    const cls = r.isOutlier ? 'bar bar-outlier' : 'bar';
    const label = `${m.fmt(v)}${m.unit ? ' ' + m.unit : ''} · ×${m.mult(r).toFixed(2)}`;
    return `<g>
      <text x="${leftPad - 10}" y="${y + 13}" class="bar-name" text-anchor="end">${i + 1}. ${esc(r.person.nom)}</text>
      <rect x="${leftPad}" y="${y}" width="${w.toFixed(1)}" height="18" rx="4" class="${cls}" />
      <text x="${(x(v) + 8).toFixed(1)}" y="${y + 13}" class="bar-value">${label}</text>
    </g>`;
  }).join('');

  const refLines = `
    <line x1="${x(med).toFixed(1)}" y1="${lineTop}" x2="${x(med).toFixed(1)}" y2="${lineBottom}" class="ref-median" />
    <line x1="${x(mn).toFixed(1)}" y1="${lineTop}" x2="${x(mn).toFixed(1)}" y2="${lineBottom}" class="ref-mean" />
    <text x="${x(med).toFixed(1)}" y="${top - 40}" class="ref-label" text-anchor="middle">médiane ${m.fmt(med)}</text>
    <text x="${x(mn).toFixed(1)}" y="${top - 24}" class="ref-label ref-label-mean" text-anchor="middle">moyenne ${m.fmt(mn)}</text>`;

  return svg(W, H,
    grid +
    bars +
    refLines +
    `<text x="${leftPad}" y="28" class="ch-title">${n} personne${n > 1 ? 's' : ''}</text>
     <text x="${leftPad}" y="46" class="ch-sub">barres ambrées = personnes qui sortent du lot</text>`);
}

// ---- Distribution chart (box plot + dot strip) on km ----

function distributionChart(rows) {
  const values = rows.map((r) => r.km).sort((a, b) => a - b);
  const n = values.length;
  const maxV = niceMax(values[n - 1] || 1);

  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const med = median(values);
  const mn = mean(values);
  const iqr = q3 - q1;
  const sd = stdLocal(values, mn);
  const lowFence = q1 - 1.5 * iqr;
  const highFence = q3 + 1.5 * iqr;
  const inFence = values.filter((v) => v >= lowFence && v <= highFence);
  const whiskLow = inFence.length ? inFence[0] : values[0];
  const whiskHigh = inFence.length ? inFence[inFence.length - 1] : values[n - 1];

  const W = 760;
  const H = 250;
  const left = 16;
  const right = 18;
  const top = 86;
  const plotW = W - left - right;
  const x = linearScale(0, maxV, left, left + plotW);

  const axisY = 196;
  const boxTop = 132;
  const boxBot = 176;
  const boxMid = (boxTop + boxBot) / 2;
  const dotBandTop = 96;
  const dotBandBot = 126;

  // axis
  const axis = `<line x1="${left}" y1="${axisY}" x2="${left + plotW}" y2="${axisY}" class="ax-line" />` +
    ticks(maxV, 5).map((t) => {
      const gx = x(t).toFixed(1);
      return `<line x1="${gx}" y1="${axisY}" x2="${gx}" y2="${axisY + 5}" class="ax-line" />
              <text x="${gx}" y="${axisY + 18}" class="ax-tick" text-anchor="middle">${fmtNum(t)}</text>`;
    }).join('') +
    `<text x="${left + plotW}" y="${axisY + 18}" class="ax-tick" text-anchor="end" dy="0">km →</text>`;

  // mean ± std band
  const stdBand = sd > 0
    ? `<rect x="${x(Math.max(0, mn - sd)).toFixed(1)}" y="${dotBandTop - 4}"
            width="${(x(mn + sd) - x(Math.max(0, mn - sd))).toFixed(1)}" height="${(boxBot - dotBandTop + 8).toFixed(1)}"
            class="std-band" />`
    : '';

  // whiskers + box
  const box = `
    <line x1="${x(whiskLow).toFixed(1)}" y1="${boxMid}" x2="${x(q1).toFixed(1)}" y2="${boxMid}" class="whisker" />
    <line x1="${x(whiskHigh).toFixed(1)}" y1="${boxMid}" x2="${x(q3).toFixed(1)}" y2="${boxMid}" class="whisker" />
    <line x1="${x(whiskLow).toFixed(1)}" y1="${boxTop + 8}" x2="${x(whiskLow).toFixed(1)}" y2="${boxBot - 8}" class="whisker-cap" />
    <line x1="${x(whiskHigh).toFixed(1)}" y1="${boxTop + 8}" x2="${x(whiskHigh).toFixed(1)}" y2="${boxBot - 8}" class="whisker-cap" />
    <rect x="${x(q1).toFixed(1)}" y="${boxTop}" width="${Math.max(1, x(q3) - x(q1)).toFixed(1)}" height="${boxBot - boxTop}" rx="4" class="iqr-box" />
    <line x1="${x(med).toFixed(1)}" y1="${boxTop}" x2="${x(med).toFixed(1)}" y2="${boxBot}" class="median-line" />
    <line x1="${x(mn).toFixed(1)}" y1="${boxTop - 6}" x2="${x(mn).toFixed(1)}" y2="${boxBot + 6}" class="mean-line" />`;

  // dots (one per person), with outlier labels
  const dots = rows.map((r, i) => {
    const v = r.km;
    const cx = x(v).toFixed(1);
    const cy = (dotBandTop + ((i * 37) % Math.max(1, dotBandBot - dotBandTop))).toFixed(1);
    const out = v > highFence || v < lowFence;
    const label = out
      ? `<text x="${cx}" y="${(+cy - 9).toFixed(1)}" class="dot-label" text-anchor="middle">${esc(r.person.nom)}</text>`
      : '';
    return `<circle cx="${cx}" cy="${cy}" r="${out ? 6 : 4.5}" class="${out ? 'dot dot-outlier' : 'dot'}" />${label}`;
  }).join('');

  const legend = statChips([
    ['Médiane', fmtNum(med) + ' km'],
    ['Moyenne', fmtNum(mn) + ' km'],
    ['Écart-type', fmtNum(sd) + ' km'],
    ['IQR', fmtNum(iqr) + ' km'],
    ['Seuil outlier', fmtNum(highFence) + ' km'],
  ], left, 22);

  return svg(W, H, legend + stdBand + axis + box + dots);
}

function stdLocal(values, m) {
  if (values.length < 2) return 0;
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / values.length);
}

// chips of "label: value" laid out horizontally
function statChips(pairs, startX, y) {
  let cx = startX;
  return pairs.map(([label, value]) => {
    const text = `${label} : ${value}`;
    const w = 16 + text.length * 6.4;
    const chip = `<g class="chip">
      <rect x="${cx.toFixed(1)}" y="${y - 13}" width="${w.toFixed(1)}" height="20" rx="10" class="chip-bg" />
      <text x="${(cx + 9).toFixed(1)}" y="${y + 1}" class="chip-text">${text}</text>
    </g>`;
    cx += w + 8;
    return chip;
  }).join('');
}

function svg(w, h, inner) {
  return `<svg viewBox="0 0 ${w} ${h}" class="chart-svg" preserveAspectRatio="xMidYMid meet" role="img">${inner}</svg>`;
}
