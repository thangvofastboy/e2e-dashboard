import { escapeHtml, STATUS } from './format.js';
import { icon } from './icons.js';

const W = 600;
const H = 180;
const PAD = { top: 12, right: 48, bottom: 24, left: 40 };
const EMPTY = '<p class="empty">Chưa có dữ liệu</p>';
const svgOpen = (label) =>
  `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(label ?? '')}" class="chart">`;

function grid(yMax, yFormat) {
  const ih = H - PAD.top - PAD.bottom;
  return [0, 0.5, 1]
    .map((f) => {
      const y = PAD.top + ih * (1 - f);
      return `<line class="grid" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y}" y2="${y}"/>` +
        `<text class="axis" x="${PAD.left - 6}" y="${y + 4}" text-anchor="end">${escapeHtml(yFormat(yMax * f))}</text>`;
    })
    .join('');
}

export function lineChart({ points = [], yMax, yFormat = String, ariaLabel } = {}) {
  if (!points.length) return EMPTY;
  const values = points.map((p) => p.value).filter((v) => v != null);
  const max = yMax ?? Math.max(1, ...values);
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const step = points.length > 1 ? iw / (points.length - 1) : 0;
  const x = (i) => PAD.left + (points.length > 1 ? i * step : iw / 2);
  const y = (v) => PAD.top + ih * (1 - v / max);
  const segments = [];
  let cur = [];
  points.forEach((p, i) => {
    if (p.value == null) {
      if (cur.length) segments.push(cur);
      cur = [];
    } else cur.push([x(i), y(p.value)]);
  });
  if (cur.length) segments.push(cur);
  const lines = segments
    .map((s) => `<path class="line series-1" d="M${s.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join('L')}"/>`)
    .join('');
  const dots = points
    .map((p, i) => (p.value == null ? '' : `<circle class="dot series-1" cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4"/>`))
    .join('');
  const lastIdx = points.findLastIndex((p) => p.value != null);
  const last = lastIdx >= 0
    ? `<text class="label" x="${(x(lastIdx) + 8).toFixed(1)}" y="${(y(points[lastIdx].value) + 4).toFixed(1)}">${escapeHtml(yFormat(points[lastIdx].value))}</text>`
    : '';
  const band = Math.max(step, 8);
  const hits = points
    .map((p, i) => `<rect class="hit" x="${(x(i) - band / 2).toFixed(1)}" y="0" width="${band.toFixed(1)}" height="${H}" data-tip="${escapeHtml(p.tip ?? `${p.label}: ${p.value == null ? '—' : yFormat(p.value)}`)}"/>`)
    .join('');
  return `${svgOpen(ariaLabel)}${grid(max, yFormat)}${lines}${dots}${last}${hits}</svg>`;
}

// Rect with only the top corners rounded (the data end of a vertical bar).
function topRounded(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function stackedBarChart({ bars = [], keys = [], ariaLabel } = {}) {
  if (!bars.length) return EMPTY;
  const totals = bars.map((b) => keys.reduce((s, k) => s + (b.segments[k] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const slot = iw / bars.length;
  const bw = Math.max(2, Math.min(24, slot - 4));
  const marks = bars
    .map((b, i) => {
      const bx = PAD.left + i * slot + (slot - bw) / 2;
      let base = PAD.top + ih;
      const present = keys.filter((k) => (b.segments[k] ?? 0) > 0);
      const segs = present
        .map((k, j) => {
          const h = Math.max(1, (b.segments[k] / max) * ih - (j ? 2 : 0)); // 2px surface gap between segments
          base -= h + (j ? 2 : 0);
          const top = j === present.length - 1;
          const d = top ? topRounded(bx, base, bw, h, 4) : `M${bx},${base}h${bw}v${h}h${-bw}Z`;
          const hatch = k === 'failed' ? `<path class="hatch" d="${d}" fill="url(#hatch)"/>` : '';
          return `<path class="seg s-${escapeHtml(k)}" d="${d}"/>${hatch}`;
        })
        .join('');
      const tip = b.tip ?? `${b.label}: ${present.map((k) => `${b.segments[k]} ${STATUS[k]?.label ?? k}`).join(', ') || 'không có test'}`;
      return `${segs}<rect class="hit" x="${(PAD.left + i * slot).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${H}" data-tip="${escapeHtml(tip)}"/>`;
    })
    .join('');
  const defs = '<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line class="hatch-line" x1="0" y1="0" x2="0" y2="6"/></pattern></defs>';
  return `${svgOpen(ariaLabel)}${defs}${grid(max, (v) => String(Math.round(v)))}${marks}</svg>`;
}

export function legend(keys) {
  return `<div class="legend">${keys
    .map((k) => `<span class="tone-${STATUS[k]?.tone ?? 'muted'}"><i class="swatch s-${escapeHtml(k)}"></i>${STATUS[k] ? icon(STATUS[k].icon, { size: 12 }) : ''}${escapeHtml(STATUS[k]?.label ?? k)}</span>`)
    .join('')}</div>`;
}

export function attachTooltips(root) {
  let tip = document.getElementById('chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'chart-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.append(tip);
  }
  root.addEventListener('pointermove', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (!el) return void (tip.hidden = true);
    tip.textContent = el.getAttribute('data-tip');
    tip.hidden = false;
    tip.style.left = `${e.clientX + 12}px`;
    tip.style.top = `${e.clientY + 12}px`;
  });
  root.addEventListener('pointerleave', () => (tip.hidden = true));
}
