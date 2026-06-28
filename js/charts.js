// SVG charts (no dependency, responsive). Renders a ranking bar chart and a
// distribution (box + dot strip) chart, with statistics annotations baked in.

import { formatDuration, mean, median, metricStats } from './compute.js';

// ---- Pure helpers (tested) ----

/** Round a value up to a "nice" axis maximum, with fairly fine steps to limit empty space. */
export function niceMax(v) {
  if (!isFinite(v) || v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  const f = v / base;
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const nice = steps.find((s) => f <= s + 1e-9) ?? 10;
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

/** Round axis ticks from 0 to max using a "nice" step (~max/5). */
export function niceTicks(max, targetCount = 5) {
  if (!isFinite(max) || max <= 0) return [0];
  const raw = max / targetCount;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const f = raw / base;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * base;
  const out = [];
  for (let t = 0; t <= max + 1e-6; t += step) out.push(Math.round(t * 1e6) / 1e6);
  return out;
}

// ---- Metric configuration ----

const METRICS = {
  km: {
    label: 'kilomètres', unit: 'km', caption: 'des kilomètres', axisTitle: 'kilomètres parcourus',
    get: (r) => r.km, mult: (r) => r.multKm, fmt: fmtNum,
  },
  time: {
    label: 'temps', unit: '', caption: 'du temps', axisTitle: 'temps de trajet',
    get: (r) => r.timeSeconds, mult: (r) => r.multTime, fmt: formatDuration,
  },
  cost: {
    label: 'coût', unit: '€', caption: 'du coût', axisTitle: 'coût (€)',
    get: (r) => r.cost, mult: (r) => r.multCost, fmt: fmtNum,
  },
};

function fmtNum(v) { return Math.round(v).toLocaleString('fr-FR'); }
/** Format a stat value for the metric, appending its unit (km/€; time has none). */
function fmtStat(m, v) { return m.fmt(v) + (m.unit ? ' ' + m.unit : ''); }

/** End-of-bar label, two lines: "1234 km ×1.50" then "12 h 30 · 250.00 €" (×N only on km). */
function barLabel(r) {
  const km = METRICS.km;
  const line1 = `${km.fmt(km.get(r))} km ×${km.mult(r).toFixed(2)}`;
  const line2 = ['time', 'cost']
    .map((k) => {
      const mm = METRICS[k];
      const u = mm.unit ? ' ' + mm.unit : '';
      return `${mm.fmt(mm.get(r))}${u}`;
    })
    .join(' · ');
  return { line1, line2 };
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ---- Public API ----

/** Render both charts into `container`. */
export function renderCharts(container, rows, metric = 'km') {
  const m = METRICS[metric] || METRICS.km;
  container.innerHTML =
    `<figure class="chart">
      <figcaption>Classement par ${m.label}</figcaption>
      ${rankingChart(rows, metric)}
    </figure>
    <figure class="chart">
      <figcaption>Répartition ${m.caption} &mdash; qui sort du lot&nbsp;?</figcaption>
      ${distributionChart(rows, metric)}
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
  const rowH = 40;
  const top = 70;
  const bottom = 26;
  const leftPad = 142;
  const rightPad = 300;
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
    const { line1, line2 } = barLabel(r);
    const lx = (x(v) + 8).toFixed(1);
    return `<g>
      <text x="${leftPad - 10}" y="${y + 13}" class="bar-name" text-anchor="end">${i + 1}. ${esc(r.person.nom)}</text>
      <rect x="${leftPad}" y="${y}" width="${w.toFixed(1)}" height="18" rx="4" class="${cls}" />
      <text x="${lx}" y="${y + 9}" class="bar-value">
        <tspan x="${lx}" dy="0">${line1}</tspan>
        <tspan x="${lx}" dy="14" class="bar-value-sub">${line2}</tspan>
      </text>
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

// ---- Distribution chart (box plot + dot strip) on the selected metric ----

function distributionChart(rows, metric) {
  const m = METRICS[metric] || METRICS.km;
  const values = rows.map(m.get).sort((a, b) => a - b);
  const n = values.length;
  const maxV = niceMax(values[n - 1] || 1);

  const s = metricStats(rows, metric);
  const q1 = s.q1;
  const q3 = s.q3;
  const med = s.median;
  const mn = s.mean;
  const iqr = s.iqr;
  const sd = s.std;
  const lowFence = q1 - 1.5 * iqr;
  const highFence = s.outlierThreshold;
  const inFence = values.filter((v) => v >= lowFence && v <= highFence);
  const whiskLow = inFence.length ? inFence[0] : values[0];
  const whiskHigh = inFence.length ? inFence[inFence.length - 1] : values[n - 1];

  const W = 760;
  const H = 268;
  const left = 28;
  const right = 28;
  const plotW = W - left - right;
  const x = linearScale(0, maxV, left, left + plotW);

  // vertical layout
  const dotTop = 74;
  const dotBot = 128;
  const boxTop = 150;
  const boxBot = 198;
  const boxMid = (boxTop + boxBot) / 2;
  const axisY = 218;

  // axis with nice round ticks + centered axis title
  const axis = `<line x1="${left}" y1="${axisY}" x2="${left + plotW}" y2="${axisY}" class="ax-line" />` +
    niceTicks(maxV).map((t) => {
      const gx = x(t).toFixed(1);
      return `<line x1="${gx}" y1="${axisY}" x2="${gx}" y2="${axisY + 5}" class="ax-line" />
              <text x="${gx}" y="${axisY + 18}" class="ax-tick" text-anchor="middle">${m.fmt(t)}</text>`;
    }).join('') +
    `<text x="${(left + plotW / 2).toFixed(1)}" y="${axisY + 38}" class="ax-title" text-anchor="middle">${m.axisTitle}</text>`;

  // mean ± std band (behind dots + box)
  const stdBand = sd > 0
    ? `<rect x="${x(Math.max(0, mn - sd)).toFixed(1)}" y="${dotTop - 6}"
            width="${(x(mn + sd) - x(Math.max(0, mn - sd))).toFixed(1)}" height="${(boxBot - dotTop + 12).toFixed(1)}"
            rx="4" class="std-band" />`
    : '';

  // box plot
  const box = `
    <line x1="${x(whiskLow).toFixed(1)}" y1="${boxMid}" x2="${x(q1).toFixed(1)}" y2="${boxMid}" class="whisker" />
    <line x1="${x(whiskHigh).toFixed(1)}" y1="${boxMid}" x2="${x(q3).toFixed(1)}" y2="${boxMid}" class="whisker" />
    <line x1="${x(whiskLow).toFixed(1)}" y1="${boxTop + 8}" x2="${x(whiskLow).toFixed(1)}" y2="${boxBot - 8}" class="whisker-cap" />
    <line x1="${x(whiskHigh).toFixed(1)}" y1="${boxTop + 8}" x2="${x(whiskHigh).toFixed(1)}" y2="${boxBot - 8}" class="whisker-cap" />
    <rect x="${x(q1).toFixed(1)}" y="${boxTop}" width="${Math.max(1, x(q3) - x(q1)).toFixed(1)}" height="${boxBot - boxTop}" rx="4" class="iqr-box" />
    <line x1="${x(med).toFixed(1)}" y1="${boxTop}" x2="${x(med).toFixed(1)}" y2="${boxBot}" class="median-line" />
    <line x1="${x(mn).toFixed(1)}" y1="${boxTop - 6}" x2="${x(mn).toFixed(1)}" y2="${boxBot + 6}" class="mean-line" />`;

  // one marker per person: bubble + initials, full name shown on hover (<title>)
  const bandH = Math.max(1, dotBot - dotTop);
  const marks = rows.map((r, i) => {
    const v = m.get(r);
    const out = v > highFence || v < lowFence;
    const cx = x(v).toFixed(1);
    const cy = (dotTop + ((i * 37) % bandH)).toFixed(1);
    const name = r.person.nom || '(?)';
    const tip = `${name} · ${fmtStat(m, v)}`;
    return `<g class="dot-mark">
      <title>${esc(tip)}</title>
      <circle cx="${cx}" cy="${cy}" r="${out ? 11 : 10}" class="${out ? 'dot dot-outlier' : 'dot'}" />
      <text x="${cx}" y="${cy}" class="dot-initials${out ? ' dot-initials-out' : ''}" text-anchor="middle">${esc(initials(name))}</text>
    </g>`;
  }).join('');

  const legend = statChips([
    ['Médiane', fmtStat(m, med)],
    ['Moyenne', fmtStat(m, mn)],
    ['Écart-type', fmtStat(m, sd)],
    ['IQR', fmtStat(m, iqr)],
    ['Seuil outlier', fmtStat(m, highFence)],
  ], left, plotW, 22);

  return svg(W, H, legend + stdBand + axis + box + marks);
}

/** First two letters of a name, uppercased (e.g. "Marie-José" -> "MA"). */
function initials(name) {
  return String(name || '').trim().slice(0, 2).toUpperCase() || '?';
}

// chips of "label : value", centered text, evenly spread across the available width
function statChips(pairs, startX, totalW, y) {
  const widths = pairs.map(([label, value]) => Math.round(`${label} : ${value}`.length * 6.4) + 24);
  const sum = widths.reduce((a, b) => a + b, 0);
  const gap = pairs.length > 1 ? Math.max(8, (totalW - sum) / (pairs.length - 1)) : 0;
  let cx = startX;
  return pairs.map(([label, value], i) => {
    const text = `${label} : ${value}`;
    const w = widths[i];
    const chip = `<g>
      <rect x="${cx.toFixed(1)}" y="${y - 12}" width="${w}" height="24" rx="12" class="chip-bg" />
      <text x="${(cx + w / 2).toFixed(1)}" y="${y}" class="chip-text" text-anchor="middle">${text}</text>
    </g>`;
    cx += w + gap;
    return chip;
  }).join('');
}

function svg(w, h, inner) {
  return `<svg viewBox="0 0 ${w} ${h}" class="chart-svg" preserveAspectRatio="xMidYMid meet" role="img">${inner}</svg>`;
}
