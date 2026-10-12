// Test lifecycle (M7): suite size over time, tests added / removed / renamed, oldest and always-failing
// tests, and the last commit that touched each test file.
import { getJson } from '../api.js';
import { pageHead, emptyBox, daysPicker } from '../analysis.js';
import { lineChart } from '../charts.js';
import { escapeHtml, statusBadge, fmtDuration } from '../format.js';
import { testHref } from '../router.js';
import { icon } from '../icons.js';

let lifeDays = 30;

export function lifeListHtml(rows, extra = () => '') {
  return rows.length ? `<ul class="life-list">${rows.slice(0, 30).map((t) => `<li><a href="${escapeHtml(testHref(t.key))}">${escapeHtml(t.title)}</a> <span class="muted small">[${escapeHtml(t.target)}]</span> ${extra(t)}</li>`).join('')}</ul>${rows.length > 30 ? `<p class="muted small">+${rows.length - 30} test</p>` : ''}` : '<p class="muted">Không có.</p>';
}

export async function renderLifecycle(main) {
  const picker = daysPicker(lifeDays, [7, 30, 90, 180], (d) => {
    lifeDays = d;
    renderLifecycle(main);
  });
  const d = await getJson(`/api/lifecycle?days=${lifeDays}`);
  const head = pageHead('Vòng đời test', 'recycle', `Test được thêm, bỏ (không chạy ${d.staleDays} ngày trong khi suite vẫn chạy), đổi tên (cùng file:dòng, tên mới), test lâu đời và test luôn fail.`, picker.html);
  if (!d.total) {
    main.innerHTML = `${head}${emptyBox('Chưa có số liệu', 'Chạy test vài lần trước.')}`;
    picker.bind(main);
    return;
  }
  const day = (iso) => new Date(iso).toLocaleDateString('vi-VN');
  const commitOf = (t) => {
    const c = d.commits?.[t.file];
    return c ? `<span class="muted small">${icon('commit', { size: 11 })}<code>${escapeHtml(c.commit)}</code> ${escapeHtml(day(c.at))} · ${escapeHtml(c.author)}</span>` : '';
  };
  const card = (label, value, tone, sub = '') => `<div class="kpi tone-${tone}"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${escapeHtml(value)}</div><div class="kpi-sub">${sub}</div></div>`;
  const sizes = d.sizes.filter((s) => s.tests != null).map((s) => ({ label: s.date, value: s.tests }));
  const rows = d.tests.sort((a, b) => b.ageDays - a.ageDays).slice(0, 200).map((t) => `<tr><td><a href="${escapeHtml(testHref(t.key))}">${escapeHtml(t.title)}</a> <span class="muted small">[${escapeHtml(t.target)}]</span><div>${commitOf(t)}</div></td><td>${escapeHtml(day(t.firstSeen))}</td><td class="num">${escapeHtml(t.ageDays)} ngày</td><td class="num">${escapeHtml(t.runs)}</td><td class="num">${t.fails ? `<span class="tone-bad">${escapeHtml(t.fails)}</span>` : '0'}</td><td class="num">${escapeHtml(fmtDuration(t.avgDurationMs))}</td><td>${statusBadge(t.lastStatus)}</td></tr>`).join('');
  main.innerHTML = `${head}<section class="kpis">
      ${card('Test đang chạy', d.active, 'info', `${d.total} test từng thấy`)}
      ${card(`Mới (${d.days} ngày)`, `+${d.added.length}`, d.added.length ? 'good' : 'muted')}
      ${card(`Bỏ (${d.days} ngày)`, `−${d.removed.length}`, d.removed.length ? 'warn' : 'muted')}
      ${card('Đổi tên', d.renamed.length, 'muted')}
      ${card('Luôn fail', d.alwaysFailing.length, d.alwaysFailing.length ? 'bad' : 'good', '≥ 3 run, chưa pass lần nào')}</section>
    <div class="two-col">
      <section class="panel"><h2>Số test theo ngày (180 ngày)</h2>${lineChart({ points: sizes, ariaLabel: 'Số test theo ngày', yFormat: (v) => String(Math.round(v)), area: true })}</section>
      <section class="panel"><h2>${icon('up', { size: 15 })} Test mới</h2>${lifeListHtml(d.added, (t) => `<span class="muted small">từ ${escapeHtml(day(t.firstSeen))}</span>`)}</section>
      <section class="panel"><h2>${icon('down', { size: 15 })} Test bị bỏ</h2>${lifeListHtml(d.removed, (t) => `<span class="muted small">Lần cuối ${escapeHtml(day(t.lastSeen))}</span>`)}</section>
      <section class="panel"><h2>${icon('arrow', { size: 15 })} Đổi tên</h2>${lifeListHtml(d.renamed, (t) => `<span class="muted small">trước là “${escapeHtml(t.from)}”</span>`)}</section>
      <section class="panel"><h2>${icon('alert', { size: 15 })} Luôn fail</h2>${lifeListHtml(d.alwaysFailing, (t) => `<span class="muted small">${escapeHtml(t.runs)} run</span>`)}</section>
    </div>
    <section class="panel"><h2>Tất cả test (lâu đời nhất trước)</h2><div class="table-wrap"><table class="table compact"><thead><tr><th>Test</th><th>Có từ</th><th>Tuổi</th><th>Run</th><th>Fail</th><th>TB</th><th>Gần nhất</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  picker.bind(main);
}
