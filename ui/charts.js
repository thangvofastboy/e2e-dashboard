import { escapeHtml, STATUS } from './format.js';
import { icon } from './icons.js';

const W = 600;
const H = 180;
const PAD = { top: 12, right: 48, bottom: 24, left: 40 };
const EMPTY = '<p class="empty">Chưa có dữ liệu</p>';
let chartSeq = 0; // unique ids for gradients when several charts share a page
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

export function lineChart({ points = [], yMax, yFormat = String, ariaLabel, area = false } = {}) {
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
  const gid = `ag${++chartSeq}`;
  const base = PAD.top + ih;
  const fill = area
    ? `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="ag-top"/><stop offset="1" class="ag-bot"/></linearGradient></defs>${segments
      .filter((sg) => sg.length > 1)
      .map((sg) => `<path class="area" d="M${sg.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join('L')}L${sg.at(-1)[0].toFixed(1)},${base}L${sg[0][0].toFixed(1)},${base}Z" fill="url(#${gid})"/>`)
      .join('')}`
    : '';
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
  return `${svgOpen(ariaLabel)}${grid(max, yFormat)}${fill}${lines}${dots}${last}${hits}</svg>`;
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

export function donutChart({ segments = [], center = '', ariaLabel } = {}) {
  const parts = segments.filter((sg) => sg.value > 0);
  const total = parts.reduce((a, sg) => a + sg.value, 0);
  if (!total) return EMPTY;
  const C = 2 * Math.PI * 36;
  let offset = 0;
  const arcs = parts
    .map((sg) => {
      const len = (sg.value / total) * C;
      const arc = `<circle class="arc s-${escapeHtml(sg.key)}" cx="50" cy="50" r="36" stroke-dasharray="${Math.max(0.5, len - (parts.length > 1 ? 2 : 0)).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 50 50)" data-tip="${escapeHtml(`${sg.value} ${STATUS[sg.key]?.label ?? sg.key}`)}"/>`;
      offset += len;
      return arc;
    })
    .join('');
  return `<svg viewBox="0 0 100 100" role="img" aria-label="${escapeHtml(ariaLabel ?? '')}" class="donut">${arcs}<text class="donut-center" x="50" y="56" text-anchor="middle">${escapeHtml(center)}</text></svg>`;
}

export function sparkline(values = []) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null && Number.isFinite(v));
  if (pts.length < 2) return '';
  const max = Math.max(...pts.map(([, v]) => v));
  const min = Math.min(...pts.map(([, v]) => v));
  const span = max - min || 1;
  const n = Math.max(1, values.length - 1);
  const points = pts.map(([i, v]) => `${((i / n) * 100).toFixed(1)},${(22 - ((v - min) / span) * 20).toFixed(1)}`).join(' ');
  return `<svg class="sparkline" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><polyline class="spark" points="${points}" vector-effect="non-scaling-stroke"/></svg>`;
}

export function heatmap({ rows = [], cols = 10 } = {}) {
  if (!rows.length) return EMPTY;
  const body = rows
    .map((r) => {
      const cells = r.cells.slice(-cols);
      const pad = Array.from({ length: cols - cells.length }, () => '<span class="hm-cell hm-empty"></span>').join('');
      const html = cells
        .map((c) => `<a class="hm-cell s-${escapeHtml(c.status)}" href="${escapeHtml(c.href ?? '#')}" data-tip="${escapeHtml(c.tip ?? c.status)}" aria-label="${escapeHtml(c.tip ?? c.status)}"></a>`)
        .join('');
      return `<div class="hm-row"><span class="hm-label" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</span><span class="hm-cells">${pad}${html}</span></div>`;
    })
    .join('');
  return `<div class="heatmap" style="--cols:${Number(cols) || 10}">${body}</div>`;
}

export function hbarChart({ items = [], format = String } = {}) {
  if (!items.length) return EMPTY;
  const max = Math.max(...items.map((i) => i.value || 0)) || 1;
  return `<ul class="hbar">${items
    .map((i) => `<li data-tip="${escapeHtml(i.tip ?? `${i.label}: ${format(i.value)}`)}"><span class="hb-label">${escapeHtml(i.label)}</span><span class="hb-track"><span class="hb-fill tone-${escapeHtml(i.tone ?? 'info')}" style="width:${Math.round(((i.value || 0) / max) * 100)}%"></span></span><span class="hb-val">${escapeHtml(format(i.value))}</span></li>`)
    .join('')}</ul>`;
}
