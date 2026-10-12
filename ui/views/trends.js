// Long-term trends (M7): daily pass rate over months with timeline annotations, the 12-month calendar,
// MTTR and time red, tests failing the longest, and the events list (deploys, releases, incidents…).
import { getJson, postJson, isExport } from '../api.js';
import { pageHead, emptyBox, fmtPct, fmtPoints, fmtSpan, toneFor, daysPicker } from '../analysis.js';
import { lineChart, calendarHeatmap } from '../charts.js';
import { escapeHtml, fmtRelative } from '../format.js';
import { testHref, runHref } from '../router.js';
import { toast } from '../toast.js';
import { icon } from '../icons.js';

let trendDays = 90;
const EVENT_LABEL = { deploy: 'Deploy', release: 'Release', incident: 'Sự cố', env: 'Môi trường', note: 'Ghi chú' };

export function trendKpi(label, value, sub, tone = 'info') {
  return `<div class="kpi tone-${escapeHtml(tone)}"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${escapeHtml(value)}</div><div class="kpi-sub">${sub}</div></div>`;
}

// Events → marker indexes on a daily series.
// Events → marker indexes on a daily series: the first plotted day on or after the event.
export function dayMarkers(series, events) {
  return events.map((e) => ({ e, index: series.findIndex((d) => d.date >= e.date) }))
    .filter(({ e, index }) => index >= 0 && (index > 0 || series[0].date === e.date))
    .map(({ e, index }) => ({ index, kind: e.kind, label: `${e.date} · ${EVENT_LABEL[e.kind] ?? e.kind}: ${e.label}` }));
}

export function eventsPanelHtml(events, kinds) {
  const rows = [...events].reverse().map((e) => `<tr><td class="small">${escapeHtml(new Date(e.at).toLocaleString('vi-VN'))}</td><td><span class="chip mk-chip mk-${escapeHtml(e.kind)}">${escapeHtml(EVENT_LABEL[e.kind] ?? e.kind)}</span></td>
    <td>${e.url ? `<a href="${escapeHtml(e.url)}" target="_blank" rel="noopener">${escapeHtml(e.label)}</a>` : escapeHtml(e.label)}${e.auto ? ' <span class="muted small">(git tag)</span>' : ''}</td>
    <td>${!e.auto && !isExport() ? `<button type="button" class="icon-btn" data-ev-del="${escapeHtml(e.id)}" aria-label="Xoá sự kiện">${icon('close', { size: 14 })}</button>` : ''}</td></tr>`).join('');
  const form = isExport() ? '' : `<form class="row ev-form" data-ev-form><select name="kind" aria-label="Loại">${kinds.map((k) => `<option value="${k}">${escapeHtml(EVENT_LABEL[k] ?? k)}</option>`).join('')}</select>
    <input name="label" required maxlength="200" placeholder="vd. v1.5 lên production" aria-label="Mô tả"><input name="at" type="datetime-local" aria-label="Thời điểm"><input name="url" type="url" placeholder="https://… (tuỳ chọn)" aria-label="Link">
    <button type="submit">${icon('pin', { size: 14 })}Đánh dấu</button></form>
    <p class="muted small">Từ CI: <code>/e2e-dashboard mark deploy "v1.5 lên prod"</code>. Tag git tự hiện là release.</p>`;
  return `<section class="panel"><h2>${icon('pin', { size: 15 })} Sự kiện</h2>${form}${rows ? `<table class="table compact"><tbody>${rows}</tbody></table>` : '<p class="muted">Chưa có sự kiện nào.</p>'}</section>`;
}

export async function renderTrends(main) {
  const picker = daysPicker(trendDays, [30, 90, 180, 365], (d) => {
    trendDays = d;
    renderTrends(main);
  });
  const [t, ev] = await Promise.all([getJson(`/api/trends?days=${trendDays}`), getJson('/api/timeline?days=365').catch(() => ({ events: [], kinds: [] }))]);
  const head = pageHead('Xu hướng dài hạn', 'activity', t.since ? `Theo dõi từ <strong>${escapeHtml(new Date(t.since).toLocaleDateString('vi-VN'))}</strong> · ${escapeHtml(t.trackedRuns)} run. Số liệu được giữ mãi, kể cả khi thư mục run cũ đã bị xoá theo retention.` : 'Số liệu dài hạn được gom từ mỗi run và giữ mãi.', picker.html);
  if (!t.trackedRuns) {
    main.innerHTML = `${head}${emptyBox('Chưa có số liệu', 'Chạy test vài lần, dashboard sẽ gom số liệu từng ngày ở đây.')}`;
    picker.bind(main);
    return;
  }
  const c = t.current;
  const p = t.previous;
  const r = t.reliability;
  const d = c.passRate != null && p.passRate != null ? c.passRate - p.passRate : null;
  const kpis = [
    trendKpi('Pass rate', fmtPct(c.passRate), `${d == null ? '' : `${icon(d >= 0 ? 'up' : 'down', { size: 12 })}${escapeHtml(fmtPoints(d))} so với ${t.days} ngày trước`}`, toneFor(c.passRate)),
    trendKpi('Số run', String(c.runs), `${c.activeDays} ngày có chạy · kỳ trước ${p.runs}`),
    trendKpi('MTTR', fmtSpan(r.mttr.avgMs), `Trung vị ${escapeHtml(fmtSpan(r.mttr.medianMs))} · ${r.mttr.count} lỗi đã sửa`, r.mttr.avgMs == null ? 'muted' : r.mttr.avgMs < 86_400_000 ? 'good' : r.mttr.avgMs < 3 * 86_400_000 ? 'warn' : 'bad'),
    trendKpi(`Thời gian đỏ · ${r.branch ?? 'branch chính'}`, r.red ? fmtSpan(r.red.ms) : '—', r.red ? `${escapeHtml(fmtPct(r.red.share))} thời gian · ${r.red.incidents} lần${r.red.now ? ` · <strong>đang đỏ từ ${escapeHtml(fmtRelative(r.red.since))}</strong>` : ''}` : 'Chưa có run trên branch chính', !r.red ? 'muted' : r.red.now ? 'bad' : r.red.share > 0.1 ? 'warn' : 'good'),
    trendKpi('Đang fail', String(r.open.length), r.open[0] ? `Lâu nhất ${escapeHtml(fmtSpan(r.open[0].ms))}` : 'không có', r.open.length ? 'bad' : 'good'),
    trendKpi('Kết quả flaky', String(c.flaky), `Kỳ trước ${p.flaky}`, c.flaky > p.flaky ? 'warn' : 'good'),
  ].join('');
  // only days with runs: a weekend without runs is not a drop to zero
  const ran = t.series.filter((x) => x.runs);
  const points = ran.map((x) => ({ label: x.date, value: x.passRate, tip: `${x.date}: ${fmtPct(x.passRate)} · ${x.runs} run · ${x.failed} fail` }));
  const weekly = r.weekly.slice(-12).reverse().map((w) => `<tr><td>${escapeHtml(new Date(w.from).toLocaleDateString('vi-VN'))}</td><td class="num">${w.redMs ? escapeHtml(fmtSpan(w.redMs)) : '—'}</td><td class="num">${escapeHtml(w.opened)}</td><td class="num">${escapeHtml(w.fixed)}</td><td class="num">${escapeHtml(fmtSpan(w.mttrMs))}</td></tr>`).join('');
  const open = r.open.slice(0, 12).map((o) => `<tr><td><a href="${escapeHtml(testHref(o.key))}">${escapeHtml(o.title)}</a> <span class="muted small">[${escapeHtml(o.target)}]</span></td><td>${escapeHtml(new Date(o.since).toLocaleDateString('vi-VN'))}</td><td class="num">${escapeHtml(o.runs)} run</td><td class="num tone-bad">${escapeHtml(fmtSpan(o.ms))}</td><td>${o.runId ? `<a href="${escapeHtml(runHref(o.runId))}">run đầu tiên</a>` : ''}</td></tr>`).join('');
  main.innerHTML = `${head}<section class="kpis">${kpis}</section>
    <div class="two-col">
    <section class="panel"><h2>Pass rate theo ngày</h2>${lineChart({ points, yMax: 1, yFormat: fmtPct, area: true, ariaLabel: 'Pass rate theo ngày', markers: dayMarkers(ran, t.events) })}
      <p class="legend small"><span class="mk-chip mk-deploy">Deploy</span> <span class="mk-chip mk-release">Release</span> <span class="mk-chip mk-incident">Sự cố</span> <span class="mk-chip mk-env">Môi trường</span> <span class="mk-chip mk-note">Ghi chú</span></p></section>
    <section class="panel"><h2>${icon('grid', { size: 15 })} 12 tháng qua</h2>${calendarHeatmap(t.calendar)}</section></div>
    <div class="two-col fill-me"><section class="panel"><h2>Đang fail lâu nhất</h2>${open ? `<table class="table compact"><thead><tr><th>Test</th><th>Từ</th><th>Số run</th><th>Đã đỏ</th><th></th></tr></thead><tbody>${open}</tbody></table>` : '<p class="muted">Không có test nào đang fail. 🎉</p>'}</section>
      <section class="panel"><h2>Theo tuần</h2><table class="table compact"><thead><tr><th>Tuần từ</th><th>Đỏ (${escapeHtml(r.branch ?? 'branch')})</th><th>Lỗi mới</th><th>Đã sửa</th><th>MTTR</th></tr></thead><tbody>${weekly}</tbody></table></section>
      ${eventsPanelHtml(ev.events, ev.kinds)}</div>
`;
  picker.bind(main);
  main.querySelector('[data-ev-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const at = f.get('at') ? new Date(String(f.get('at'))).toISOString() : undefined;
    const res = await postJson('/api/timeline', { kind: f.get('kind'), label: f.get('label'), at, url: f.get('url') || undefined }).catch((x) => ({ error: x.message }));
    if (res.error) return toast(res.error, 'bad');
    toast('Đã đánh dấu sự kiện');
    renderTrends(main);
  });
  main.querySelectorAll('[data-ev-del]').forEach((b) => b.addEventListener('click', async () => {
    await postJson('/api/timeline/remove', { id: b.dataset.evDel }).catch(() => null);
    renderTrends(main);
  }));
}
