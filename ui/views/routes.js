import { getJson } from '../api.js';
import { runCountPicker, analysisCount, pageHead, emptyBox, meter } from '../analysis.js';
import { escapeHtml } from '../format.js';

const NODE_W = 160;
const NODE_H = 34;
const COL_GAP = 70;
const ROW_GAP = 18;

// Columns by distance from where tests enter the app; edges that go back draw as arcs.
export function layoutRoutes(nodes, edges, { maxNodes = 30 } = {}) {
  const kept = nodes.slice(0, maxNodes);
  const names = new Set(kept.map((n) => n.route));
  const es = edges.filter((e) => names.has(e.from) && names.has(e.to) && e.from !== e.to);
  const incoming = new Set(es.map((e) => e.to));
  const depth = new Map();
  const queue = kept.filter((n) => n.entries > 0 || !incoming.has(n.route)).map((n) => n.route);
  for (const r of queue) depth.set(r, 0);
  while (queue.length) {
    const r = queue.shift();
    for (const e of es) if (e.from === r && !depth.has(e.to)) {
      depth.set(e.to, depth.get(r) + 1);
      queue.push(e.to);
    }
  }
  for (const n of kept) if (!depth.has(n.route)) depth.set(n.route, 0);
  const cols = new Map();
  for (const n of kept) {
    const d = depth.get(n.route);
    if (!cols.has(d)) cols.set(d, []);
    cols.get(d).push(n);
  }
  const pos = new Map();
  let height = 0;
  for (const [d, list] of cols) list.forEach((n, i) => {
    const p = { x: 12 + d * (NODE_W + COL_GAP), y: 12 + i * (NODE_H + ROW_GAP), depth: d };
    pos.set(n.route, p);
    height = Math.max(height, p.y + NODE_H + 12);
  });
  const width = 12 + Math.max(0, ...[...cols.keys()]) * (NODE_W + COL_GAP) + NODE_W + 12;
  return { nodes: kept.map((n) => ({ ...n, ...pos.get(n.route) })), edges: es, pos, width, height: Math.max(height, 60) };
}

export function routeGraphSvg(map) {
  const L = layoutRoutes(map.nodes, map.edges);
  const maxCount = Math.max(1, ...L.edges.map((e) => e.count));
  const edges = L.edges.map((e) => {
    const a = L.pos.get(e.from);
    const b = L.pos.get(e.to);
    const w = (1 + (e.count / maxCount) * 4).toFixed(1);
    const tip = escapeHtml(`${e.from} → ${e.to}: ${e.count} lần`);
    if (b.depth > a.depth) {
      const x1 = a.x + NODE_W;
      const y1 = a.y + NODE_H / 2;
      const x2 = b.x;
      const y2 = b.y + NODE_H / 2;
      const mx = (x1 + x2) / 2;
      return `<path class="rm-edge" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 4},${y2}" stroke-width="${w}" marker-end="url(#rm-arrow)" data-tip="${tip}"/>`;
    }
    // back or sideways: an arc under the boxes
    const x1 = a.x + NODE_W / 2;
    const x2 = b.x + NODE_W / 2;
    const y1 = a.y + NODE_H;
    const y2 = b.y + NODE_H;
    const dip = Math.max(y1, y2) + 26;
    return `<path class="rm-edge back" d="M${x1},${y1} C${x1},${dip} ${x2},${dip} ${x2},${y2 + 4}" stroke-width="${w}" marker-end="url(#rm-arrow)" data-tip="${tip}"/>`;
  }).join('');
  const boxes = L.nodes.map((n) => {
    const tone = n.failures ? (n.failures / Math.max(1, n.visits) >= 0.3 ? 'bad' : 'warn') : 'good';
    const label = n.route.length > 22 ? `${n.route.slice(0, 21)}…` : n.route;
    return `<g class="rm-node tone-${tone}" data-tip="${escapeHtml(`${n.route}: ${n.visits} lượt, ${n.tests} test${n.failures ? `, ${n.failures} lần fail tại đây` : ''}`)}">
      <rect x="${n.x}" y="${n.y}" width="${NODE_W}" height="${NODE_H}" rx="8"/>
      <text x="${n.x + 10}" y="${n.y + 21}">${escapeHtml(label)}</text>${n.failures ? `<text class="rm-fail" x="${n.x + NODE_W - 8}" y="${n.y + 21}" text-anchor="end">✕${n.failures}</text>` : ''}</g>`;
  }).join('');
  return `<div class="rm-scroll"><svg class="route-map" viewBox="0 0 ${L.width} ${L.height + 30}" width="${L.width}" height="${L.height + 30}" role="img" aria-label="Bản đồ route">
    <defs><marker id="rm-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" class="rm-arrow"/></marker></defs>${edges}${boxes}</svg></div>`;
}

export async function renderRoutes(main) {
  const picker = runCountPicker(() => renderRoutes(main));
  const map = await getJson(`/api/routes?n=${analysisCount()}`);
  const head = pageHead('Bản đồ route', 'route', 'Các trang test đã đi qua (từ sự kiện chuyển trang và URL lúc fail), id trong đường dẫn được gộp thành <code>:id</code>. Đỏ: nơi test hay fail.', picker.html);
  if (!map.nodes.length) {
    main.innerHTML = `${head}${emptyBox('Chưa có dữ liệu route', 'Report chưa có sự kiện navigation hay URL lúc fail.')}`;
    picker.bind(main);
    return;
  }
  const maxVisits = Math.max(...map.nodes.map((n) => n.visits));
  main.innerHTML = `${head}<section class="panel">${routeGraphSvg(map)}${map.nodes.length > 30 ? '<p class="muted small">Chỉ vẽ 30 route nhiều lượt nhất; bảng dưới có đủ.</p>' : ''}</section>
    <table class="table"><thead><tr><th>Route</th><th>Lượt</th><th class="num">Test</th><th class="num">Fail tại đây</th></tr></thead><tbody>${map.nodes
      .map((n) => `<tr><td><code>${escapeHtml(n.route)}</code></td><td>${meter(n.visits / maxVisits, 'info', String(n.visits))}</td><td class="num">${escapeHtml(n.tests)}</td><td class="num">${n.failures ? `<span class="tone-bad delta">${escapeHtml(n.failures)}</span>` : '0'}</td></tr>`)
      .join('')}</tbody></table>
    ${map.edges.length ? `<details class="panel"><summary>Các bước chuyển (${map.edges.length})</summary><ul class="mono-list">${map.edges.slice(0, 100).map((e) => `<li><code>${escapeHtml(e.from)}</code> → <code>${escapeHtml(e.to)}</code> <span class="muted">${escapeHtml(e.count)}×</span></li>`).join('')}</ul></details>` : ''}`;
  picker.bind(main);
}
