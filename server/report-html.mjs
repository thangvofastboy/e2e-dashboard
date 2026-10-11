// Self-contained HTML for the scheduled reports and the static report site (M7): inline CSS and SVG,
// no script, so it opens anywhere (mail client, GitHub Pages, a shared folder). All report text is escaped.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const pct = (v) => (v == null || Number.isNaN(v) ? '—' : `${Math.round(v * 100)}%`);
export function dur(ms) {
  if (ms == null) return '—';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} phút`;
  const h = Math.round(m / 6) / 10;
  return h < 48 ? `${h} giờ` : `${Math.round(h / 24 * 10) / 10} ngày`;
}
const delta = (cur, prev, { invert = false, points = true } = {}) => {
  if (cur == null || prev == null) return '';
  const d = cur - prev;
  if (Math.abs(d) < 1e-9) return '<span class="d">= kỳ trước</span>';
  const good = invert ? d < 0 : d > 0;
  const txt = points ? `${d > 0 ? '+' : ''}${Math.round(d * 100)} điểm` : `${d > 0 ? '+' : ''}${d}`;
  return `<span class="d ${good ? 'up' : 'down'}">${esc(txt)} so với kỳ trước</span>`;
};
const MARK = { deploy: '#2563eb', release: '#7c3aed', incident: '#dc2626', env: '#d97706', note: '#64748b' };

// Daily pass rate with event markers; points: [{date, passRate}], events: [{at, kind, label}].
export function trendSvg(points, events = []) {
  const W = 720;
  const H = 200;
  const P = { l: 40, r: 12, t: 12, b: 26 };
  if (!points.some((p) => p.passRate != null)) return '<p class="muted">Chưa có dữ liệu trong kỳ.</p>';
  const iw = W - P.l - P.r;
  const ih = H - P.t - P.b;
  const x = (i) => P.l + (points.length > 1 ? (i * iw) / (points.length - 1) : iw / 2);
  const y = (v) => P.t + ih * (1 - v);
  const segs = [];
  let cur = [];
  points.forEach((p, i) => {
    if (p.passRate == null) {
      if (cur.length) segs.push(cur);
      cur = [];
    } else cur.push(`${x(i).toFixed(1)},${y(p.passRate).toFixed(1)}`);
  });
  if (cur.length) segs.push(cur);
  const marks = events.map((e) => {
    const i = points.findIndex((p) => p.date >= e.date);
    if (i < 0 || (i === 0 && points[0].date !== e.date)) return '';
    return `<g><line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${P.t}" y2="${H - P.b}" stroke="${MARK[e.kind] ?? '#64748b'}" stroke-dasharray="3 3"/><title>${esc(`${e.date} · ${e.kind}: ${e.label}`)}</title></g>`;
  }).join('');
  const grid = [0, 0.5, 1].map((f) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(f)}" y2="${y(f)}" class="g"/><text x="${P.l - 6}" y="${y(f) + 4}" text-anchor="end" class="ax">${f * 100}%</text>`).join('');
  const labels = [0, Math.floor((points.length - 1) / 2), points.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="ax">${esc(points[i].date.slice(5))}</text>`).join('');
  const dots = points.map((p, i) => (p.passRate == null ? '' : `<circle cx="${x(i).toFixed(1)}" cy="${y(p.passRate).toFixed(1)}" r="2.5" class="pt"><title>${esc(`${p.date}: ${pct(p.passRate)} · ${p.runs} run`)}</title></circle>`)).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Pass rate theo ngày">${grid}${marks}${segs.map((s) => `<polyline points="${s.join(' ')}" class="ln"/>`).join('')}${dots}${labels}</svg>`;
}

const tone = (v) => (v == null ? 'c0' : v >= 0.98 ? 'c4' : v >= 0.95 ? 'c3' : v >= 0.85 ? 'c2' : 'c1');

// GitHub-style calendar: one square per day, coloured by pass rate; days: [{date, passRate, runs}].
export function calendarSvg(days) {
  if (!days.length) return '';
  const S = 12;
  const G = 3;
  const first = new Date(`${days[0].date}T12:00:00`);
  const offset = (first.getDay() + 6) % 7; // weeks start on Monday
  const cols = Math.ceil((days.length + offset) / 7);
  const cells = days.map((d, i) => {
    const k = i + offset;
    return `<rect x="${28 + Math.floor(k / 7) * (S + G)}" y="${14 + (k % 7) * (S + G)}" width="${S}" height="${S}" rx="2" class="${d.runs ? tone(d.passRate) : 'c0'}"><title>${esc(`${d.date}: ${d.runs ? `${pct(d.passRate)} · ${d.runs} run` : 'không chạy'}`)}</title></rect>`;
  }).join('');
  const months = [];
  days.forEach((d, i) => {
    if (d.date.endsWith('-01') || i === 0) months.push(`<text x="${28 + Math.floor((i + offset) / 7) * (S + G)}" y="10" class="ax">${esc(d.date.slice(0, 7))}</text>`);
  });
  const wd = ['T2', '', 'T4', '', 'T6', '', 'CN'].map((t, i) => (t ? `<text x="0" y="${14 + i * (S + G) + 10}" class="ax">${t}</text>` : '')).join('');
  return `<svg viewBox="0 0 ${28 + cols * (S + G)} ${14 + 7 * (S + G)}" class="cal" role="img" aria-label="Lịch pass rate theo ngày">${months.join('')}${wd}${cells}</svg>
    <p class="legend"><span class="sw c1"></span>&lt;85% <span class="sw c2"></span>85–95% <span class="sw c3"></span>95–98% <span class="sw c4"></span>≥98% <span class="sw c0"></span>không chạy</p>`;
}

const CSS = `:root{--bg:#f8fafc;--card:#fff;--fg:#0f172a;--mut:#64748b;--line:#e2e8f0;--good:#16a34a;--bad:#dc2626;--warn:#d97706;--acc:#2563eb}
@media (prefers-color-scheme:dark){:root{--bg:#0b1120;--card:#111827;--fg:#e5e7eb;--mut:#94a3b8;--line:#1f2937}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:980px;margin:0 auto;padding:24px 16px 48px}h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:0 0 10px}
.muted{color:var(--mut)}.small{font-size:12px}section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:14px 0}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:16px 0}.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
.kpi b{display:block;font-size:24px}.kpi span{color:var(--mut);font-size:12px}.d{display:block;font-size:12px;color:var(--mut)}.d.up{color:var(--good)}.d.down{color:var(--bad)}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mut);font-weight:600;font-size:12px}td.n{text-align:right;white-space:nowrap}
.chart{width:100%;height:auto}.chart .g{stroke:var(--line)}.chart .ax,.cal .ax{fill:var(--mut);font-size:10px}.chart .ln{fill:none;stroke:var(--acc);stroke-width:2}.chart .pt{fill:var(--acc)}
.cal{width:100%;height:auto;max-height:150px}.c0{fill:var(--line)}.c1{fill:#dc2626}.c2{fill:#f59e0b}.c3{fill:#86efac}.c4{fill:#16a34a}
.legend{font-size:12px;color:var(--mut)}.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 10px;vertical-align:middle}.sw.c0{background:var(--line)}.sw.c1{background:#dc2626}.sw.c2{background:#f59e0b}.sw.c3{background:#86efac}.sw.c4{background:#16a34a}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;border:1px solid var(--line)}.bad{color:var(--bad)}.good{color:var(--good)}.warn{color:var(--warn)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media (max-width:720px){.grid2{grid-template-columns:1fr}}a{color:var(--acc)}code{font-size:12px}
@media print{body{background:#fff}section,.kpi{break-inside:avoid}}`;

const table = (head, rows, empty = 'Không có.') => (rows.length ? `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>` : `<p class="muted">${esc(empty)}</p>`);

// data: what reports.buildReport returns; extra: { runs: [{href, label, status}] } for the site.
export function reportHtml(data, extra = {}) {
  const c = data.current;
  const p = data.previous;
  const r = data.reliability;
  const title = data.kind === 'site' ? `Báo cáo e2e · ${data.project}` : `Báo cáo e2e ${data.kind === 'month' ? 'tháng' : 'tuần'} · ${data.project}`;
  const kpi = (label, value, d = '') => `<div class="kpi"><span>${esc(label)}</span><b>${esc(value)}</b>${d}</div>`;
  const open = (r.open ?? []).slice(0, 15).map((o) => `<tr><td>${esc(o.title)} <span class="muted small">[${esc(o.target)}]</span></td><td class="n">${esc(o.since?.slice(0, 10))}</td><td class="n">${esc(o.runs)} run</td><td class="n bad">${esc(dur(o.ms))}</td></tr>`);
  const fixed = (r.fixed ?? []).slice(0, 10).map((o) => `<tr><td>${esc(o.title)}</td><td class="n">${esc(o.end?.slice(0, 10))}</td><td class="n">${esc(dur(o.ms))}</td></tr>`);
  const flaky = (data.flaky ?? []).slice(0, 10).map((f) => `<tr><td>${esc(f.title)} <span class="muted small">[${esc(f.target)}]</span></td><td class="n">${esc(Math.round(f.score * 100))}</td><td class="n">${esc(f.flaky)} flaky · ${esc(f.flips)} lần đổi</td></tr>`);
  const groups = (data.groups ?? []).slice(0, 10).map((g) => `<tr><td><b>${esc(g.grade)}</b> ${esc(g.group)}</td><td class="n">${esc(g.tests)}</td><td class="n">${esc(pct(g.passRate))}</td><td class="n ${g.failingNow.length ? 'bad' : ''}">${esc(g.failingNow.length)}</td><td class="n">${esc(g.flaky)}</td></tr>`);
  const tri = data.triage?.counts ?? {};
  const life = data.lifecycle;
  const events = (data.events ?? []).map((e) => `<tr><td class="n">${esc(e.at.slice(0, 16).replace('T', ' '))}</td><td><span class="pill">${esc(e.kind)}</span></td><td>${esc(e.label)}</td></tr>`);
  const runs = (extra.runs ?? []).map((x) => `<tr><td><a href="${esc(x.href)}">${esc(x.label)}</a></td><td>${esc(x.status)}</td><td class="n">${esc(x.at?.slice(0, 16).replace('T', ' '))}</td></tr>`);
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>${esc(title)}</title><style>${CSS}</style></head><body><main>
<h1>${esc(title)}</h1><p class="muted">${esc(data.from.slice(0, 10))} → ${esc(data.to.slice(0, 10))} · tạo lúc ${esc(data.generatedAt.slice(0, 16).replace('T', ' '))}</p>
<div class="kpis">
${kpi('Pass rate', pct(c.passRate), delta(c.passRate, p.passRate))}
${kpi('Số run', String(c.runs), p.runs != null ? `<span class="d">kỳ trước ${esc(p.runs)}</span>` : '')}
${kpi('MTTR (TB sửa lỗi)', dur(r.mttr.avgMs), `<span class="d">${esc(r.mttr.count)} lỗi đã sửa · trung vị ${esc(dur(r.mttr.medianMs))}</span>`)}
${kpi(`Thời gian ${r.branch ?? 'branch chính'} đỏ`, r.red ? dur(r.red.ms) : '—', r.red ? `<span class="d ${r.red.now ? 'down' : ''}">${esc(pct(r.red.share))} thời gian${r.red.now ? ' · đang đỏ' : ''}</span>` : '')}
${kpi('Đang fail', String((r.open ?? []).length), `<span class="d">${esc(tri.new ?? 0)} chưa xử lý · ${esc(tri.investigating ?? 0)} đang xem</span>`)}
${kpi('Kết quả flaky', String(c.flaky), delta(c.flaky, p.flaky, { invert: true, points: false }))}
</div>
<section><h2>Pass rate theo ngày</h2>${trendSvg(data.series.filter((d) => d.runs), data.events ?? [])}</section>
${data.calendar ? `<section><h2>Lịch 12 tháng</h2>${calendarSvg(data.calendar)}</section>` : ''}
<section><h2>Đang fail (lâu nhất trước)</h2>${table(['Test', 'Từ', 'Số run', 'Đã đỏ'], open, 'Không có test nào đang fail.')}</section>
<div class="grid2"><section><h2>Đã sửa trong kỳ</h2>${table(['Test', 'Ngày sửa', 'Thời gian'], fixed)}</section>
<section><h2>Flaky nhiều nhất</h2>${table(['Test', 'Điểm', ''], flaky)}</section></div>
<section><h2>Theo module</h2>${table(['Module', 'Test', 'Pass rate', 'Đang fail', 'Flaky'], groups)}</section>
${life ? `<section><h2>Bộ test</h2><p>${esc(life.active)} test đang chạy · <span class="good">+${esc(life.added.length)} mới</span> · <span class="bad">−${esc(life.removed.length)} bỏ</span> · ${esc(life.renamed.length)} đổi tên</p></section>` : ''}
${events.length ? `<section><h2>Sự kiện</h2>${table(['Lúc', 'Loại', 'Mô tả'], events)}</section>` : ''}
${runs.length ? `<section><h2>Run gần nhất</h2>${table(['Run', 'Trạng thái', 'Lúc'], runs)}</section>` : ''}
<p class="muted small">Tạo bởi e2e-dashboard · số liệu dài hạn từ .e2e-dashboard/longterm</p>
</main></body></html>`;
}

export function reportMarkdown(data) {
  const c = data.current;
  const p = data.previous;
  const r = data.reliability;
  const pts = c.passRate != null && p.passRate != null ? ` (${c.passRate >= p.passRate ? '+' : ''}${Math.round((c.passRate - p.passRate) * 100)} điểm)` : '';
  const lines = [
    `*Báo cáo e2e ${data.kind === 'month' ? 'tháng' : 'tuần'} · ${data.project}* (${data.from.slice(0, 10)} → ${data.to.slice(0, 10)})`,
    `• Pass rate: ${pct(c.passRate)}${pts} · ${c.runs} run · ${c.flaky} kết quả flaky`,
    `• MTTR: ${dur(r.mttr.avgMs)} (${r.mttr.count} lỗi đã sửa)${r.red ? ` · ${r.branch} đỏ ${dur(r.red.ms)} (${pct(r.red.share)})${r.red.now ? ', đang đỏ' : ''}` : ''}`,
    `• Đang fail: ${(r.open ?? []).length} test · Triage: ${data.triage?.counts?.new ?? 0} chưa xử lý, ${data.triage?.counts?.investigating ?? 0} đang xem`,
  ];
  if ((r.open ?? []).length) lines.push('', '*Fail lâu nhất:*', ...r.open.slice(0, 5).map((o) => `• ${o.title} [${o.target}] — ${dur(o.ms)}, ${o.runs} run`));
  const worst = (data.groups ?? []).filter((g) => g.failingNow.length).slice(0, 3);
  if (worst.length) lines.push('', '*Module cần chú ý:*', ...worst.map((g) => `• ${g.group}: ${pct(g.passRate)}, ${g.failingNow.length} test đang fail`));
  if (data.lifecycle) lines.push('', `Bộ test: ${data.lifecycle.active} test (+${data.lifecycle.added.length} / −${data.lifecycle.removed.length})`);
  return lines.join('\n');
}

