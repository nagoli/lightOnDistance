import { formatDurationForDisplay, metricStats } from './compute.js';

const WIDTH = 1200;
const PAD = 40;
const COLORS = {
  bg: '#ffffff',
  card: '#f8fafc',
  border: '#d9e2ec',
  text: '#172033',
  muted: '#64748b',
  accent: '#2563eb',
  accentSoft: '#dbeafe',
  danger: '#b91c1c',
};

const METRICS = {
  km: {
    label: 'kilomètres',
    shortLabel: 'Km',
    unit: 'km',
    get: (r) => Number(r.km) || 0,
    mult: (r) => Number(r.multKm) || 0,
    fmt: (v) => Math.round(v).toLocaleString('fr-FR'),
    fmtWithUnit: (v) => `${Math.round(v).toLocaleString('fr-FR')} km`,
  },
  time: {
    label: 'temps',
    shortLabel: 'Temps',
    unit: '',
    get: (r) => Number(r.timeSeconds) || 0,
    mult: (r) => Number(r.multTime) || 0,
    fmt: (v) => formatDurationForDisplay(v),
    fmtWithUnit: (v) => formatDurationForDisplay(v),
  },
  cost: {
    label: 'coût',
    shortLabel: 'Coût',
    unit: '€',
    get: (r) => Number(r.cost) || 0,
    mult: (r) => Number(r.multCost) || 0,
    fmt: (v) => Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    fmtWithUnit: (v) => `${Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`,
  },
};

/**
 * Build a standalone SVG image for sharing/downloading the rendered results.
 * It deliberately avoids <foreignObject> so browsers can rasterize it reliably.
 */
export function buildResultsSvg({ rows = [], places = [], metric = 'km', errors = [], generatedAt = new Date() } = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safePlaces = Array.isArray(places) ? places : [];
  const safeErrors = Array.isArray(errors) ? errors : [];
  const m = METRICS[metric] || METRICS.km;
  const stats = metricStats(safeRows, metric);
  const parts = [];
  let y = PAD;

  parts.push(text(PAD, y + 6, 'Palmarès des trajets', 'font-size="30" font-weight="800"'));
  const generatedLabel = formatGeneratedAt(generatedAt);
  if (generatedLabel) {
    parts.push(text(PAD, y + 36, `Export généré le ${generatedLabel}`, `font-size="14" fill="${COLORS.muted}"`));
  }
  parts.push(text(WIDTH - PAD, y + 36, `Classement par ${m.label}`, `font-size="14" fill="${COLORS.muted}" text-anchor="end"`));
  y += 76;

  y = renderPlaces(parts, safePlaces, y);
  y += 20;

  if (stats) {
    y = renderStats(parts, stats, m, y);
    y += 22;
    y = renderRanking(parts, safeRows, m, y);
    y += 24;
    y = renderTable(parts, safeRows, y);
  } else {
    parts.push(text(PAD, y + 20, 'Aucun résultat à exporter.', `font-size="18" fill="${COLORS.muted}"`));
    y += 58;
  }

  if (safeErrors.length) {
    y += 18;
    parts.push(text(PAD, y, `Personnes exclues (${safeErrors.length})`, `font-size="18" font-weight="700" fill="${COLORS.danger}"`));
    y += 26;
    for (const err of safeErrors.slice(0, 8)) {
      parts.push(text(PAD + 16, y, `${err.nom || '(sans nom)'} - ${err.message || 'trajet introuvable'}`, `font-size="14" fill="${COLORS.danger}"`));
      y += 22;
    }
    if (safeErrors.length > 8) {
      parts.push(text(PAD + 16, y, `+ ${safeErrors.length - 8} autre(s) erreur(s)`, `font-size="14" fill="${COLORS.danger}"`));
      y += 22;
    }
  }

  const height = Math.ceil(y + PAD);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="Palmarès des trajets">
  <rect width="${WIDTH}" height="${height}" fill="${COLORS.bg}" />
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
  </style>
  ${parts.join('\n  ')}
</svg>`;
  return { svg, width: WIDTH, height };
}

function renderPlaces(parts, places, y) {
  const validPlaces = places.filter((pl) => (Number(pl.quantite) > 0) && (pl.codePostal || pl.ville));
  parts.push(text(PAD, y, 'Lieux', 'font-size="16" font-weight="700"'));
  y += 18;
  if (!validPlaces.length) {
    parts.push(text(PAD, y + 20, 'Aucun lieu renseigné', `font-size="14" fill="${COLORS.muted}"`));
    return y + 44;
  }

  let x = PAD;
  const right = WIDTH - PAD;
  const chipH = 30;
  for (const pl of validPlaces) {
    const label = placeLabel(pl);
    const chipW = Math.min(360, Math.max(84, estimatedTextWidth(label, 14) + 28));
    if (x > PAD && x + chipW > right) {
      x = PAD;
      y += chipH + 8;
    }
    parts.push(`<rect x="${x}" y="${y}" width="${chipW}" height="${chipH}" rx="15" fill="${COLORS.accentSoft}" />`);
    parts.push(text(x + 14, y + 20, truncate(label, 44), `font-size="14" font-weight="600" fill="${COLORS.accent}"`));
    x += chipW + 10;
  }
  return y + chipH;
}

function renderStats(parts, stats, metric, y) {
  const cards = [
    ['Total', metric.fmtWithUnit(stats.sum)],
    ['Médiane', metric.fmtWithUnit(stats.median)],
    ['Min / max', `${metric.fmtWithUnit(stats.min)} → ${metric.fmtWithUnit(stats.max)}`],
    ['Coef. min->max', `x${ratio(stats.max, stats.min).toFixed(2)}`],
    ['Gini', stats.gini.toFixed(3)],
  ];
  const gap = 12;
  const cardW = (WIDTH - PAD * 2 - gap * (cards.length - 1)) / cards.length;
  const cardH = 76;
  cards.forEach(([label, value], i) => {
    const x = PAD + i * (cardW + gap);
    parts.push(`<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="10" fill="${COLORS.card}" stroke="${COLORS.border}" />`);
    parts.push(text(x + 14, y + 26, label, `font-size="13" fill="${COLORS.muted}"`));
    parts.push(text(x + 14, y + 56, value, 'font-size="22" font-weight="800"'));
  });
  return y + cardH;
}

function renderRanking(parts, rows, metric, y) {
  parts.push(text(PAD, y, 'Classement', 'font-size="20" font-weight="800"'));
  y += 28;

  const chartX = PAD;
  const nameW = 250;
  const barX = chartX + nameW;
  const barW = 600;
  const valueX = barX + barW + 18;
  const max = niceMax(Math.max(...rows.map(metric.get), 1));
  const rowH = 42;

  rows.forEach((r, i) => {
    const rowY = y + i * rowH;
    const v = metric.get(r);
    const width = Math.max(2, (v / max) * barW);
    parts.push(text(chartX, rowY + 24, `${i + 1}. ${truncate(r.person?.nom || '(sans nom)', 28)}`, 'font-size="15" font-weight="700"'));
    parts.push(`<rect x="${barX}" y="${rowY + 7}" width="${barW}" height="20" rx="10" fill="#edf2f7" />`);
    parts.push(`<rect x="${barX}" y="${rowY + 7}" width="${width.toFixed(1)}" height="20" rx="10" fill="${COLORS.accent}" />`);
    const line1 = `${METRICS.km.fmt(r.km)}km – ${formatDurationForDisplay(r.timeSeconds, true)} – ${Math.round(Number(r.cost) || 0).toLocaleString('fr-FR')}€`;
    const line2 = `x${METRICS.km.mult(r).toFixed(2)}`;
    parts.push(text(valueX, rowY + 15, line1, `font-size="14" font-weight="700"`));
    parts.push(text(valueX, rowY + 34, line2, `font-size="13" fill="${COLORS.muted}"`));
  });

  return y + rows.length * rowH;
}

function renderTable(parts, rows, y) {
  parts.push(text(PAD, y, 'Tableau détaillé', 'font-size="20" font-weight="800"'));
  y += 18;

  const tableX = PAD;
  const tableW = WIDTH - PAD * 2;
  const headerH = 34;
  const rowH = 34;
  const cols = [
    ['Rang', tableX + 18],
    ['Nom', tableX + 92],
    ['Km', tableX + 470],
    ['x', tableX + 590],
    ['Temps', tableX + 670],
    ['Coût', tableX + 890],
  ];

  parts.push(`<rect x="${tableX}" y="${y}" width="${tableW}" height="${headerH}" rx="8" fill="${COLORS.text}" />`);
  for (const [label, x] of cols) {
    parts.push(text(x, y + 22, label, 'font-size="13" font-weight="800" fill="#ffffff"'));
  }
  y += headerH;

  rows.forEach((r, i) => {
    const fill = i % 2 ? '#ffffff' : '#f8fafc';
    parts.push(`<rect x="${tableX}" y="${y}" width="${tableW}" height="${rowH}" fill="${fill}" stroke="${COLORS.border}" stroke-width="0.7" />`);
    const values = [
      r.rank ?? i + 1,
      truncate(r.person?.nom || '(sans nom)', 42),
      Math.round(r.km).toLocaleString('fr-FR'),
      `x${(Number(r.multKm) || 0).toFixed(2)}`,
      formatDurationForDisplay(r.timeSeconds),
      Number(r.cost).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    ];
    values.forEach((value, idx) => {
      parts.push(text(cols[idx][1], y + 22, String(value), `font-size="14" fill="${idx === 1 ? COLORS.text : COLORS.muted}"`));
    });
    y += rowH;
  });

  return y;
}

function placeLabel(place) {
  const name = place.ville || 'Lieu sans ville';
  return `×${Number(place.quantite) || 0} ${name || 'Lieu'}`;
}

function ratio(max, min) {
  return min > 0 ? max / min : 0;
}

function niceMax(v) {
  if (!isFinite(v) || v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  const f = v / base;
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  return (steps.find((s) => f <= s + 1e-9) ?? 10) * base;
}

function estimatedTextWidth(textValue, size) {
  return String(textValue).length * size * 0.56;
}

function truncate(value, maxLength) {
  const s = String(value ?? '');
  return s.length > maxLength ? s.slice(0, Math.max(0, maxLength - 1)) + '…' : s;
}

function text(x, y, value, attrs = '') {
  const fill = /\bfill=/.test(attrs) ? '' : ` fill="${COLORS.text}"`;
  return `<text x="${x}" y="${y}"${fill}${attrs ? ` ${attrs}` : ''}>${escapeXml(value)}</text>`;
}

function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatGeneratedAt(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(value);
  } catch (err) {
    return '';
  }
}
