import { getJson, postJson, isExport } from '../api.js';
import { openAiPanel } from './ai-panel.js';
import { runCountPicker, analysisCount, pageHead, emptyBox, meter, fmtPct, toneFor } from '../analysis.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';
import { toast } from '../toast.js';

// nút "Bỏ qua": route/domain sẽ không hiện ở các lần sau, xoá lại ở mục "Đã bỏ qua"
const ignoreBtn = (kind, value) => (isExport() ? '' : `<button type="button" class="small-btn" data-ignore="${kind}" data-value="${escapeHtml(value)}">${icon('close', { size: 13 })}Bỏ qua</button>`);

export function coverageRowHtml(r) {
  return `<tr><td><code>${escapeHtml(r.route)}</code></td><td class="muted small wrap" style="overflow-wrap:anywhere">${escapeHtml(r.source)}</td>
    <td>${r.tested ? `<span class="chip tone-good">${icon('check', { size: 12 })}${escapeHtml(r.tests)} test · ${escapeHtml(r.visits)} lượt</span>${r.failures ? ` <span class="tone-bad delta">${escapeHtml(r.failures)} fail</span>` : ''}` : `<span class="chip tone-warn">${icon('alert', { size: 12 })}Chưa có test</span>`}</td>
    <td class="row-actions">${!r.tested && !isExport() ? `<button type="button" class="btn-ai small-btn" data-route="${escapeHtml(r.route)}">${icon('sparkles', { size: 13 })}Viết test</button>` : ''}${ignoreBtn('route', r.route)}</td></tr>`;
}

export function domainRowHtml(d) {
  return `<tr><td style="overflow-wrap:anywhere"><code>${escapeHtml(d.host)}</code></td><td class="num">${escapeHtml(d.count)}</td><td class="muted small wrap" style="overflow-wrap:anywhere">${escapeHtml(d.sample)}</td><td>${ignoreBtn('domain', d.host)}</td></tr>`;
}

export async function renderCoverage(main) {
  const picker = runCountPicker(() => renderCoverage(main));
  const c = await getJson(`/api/coverage?n=${analysisCount()}`);
  const head = pageHead('Khoảng trống coverage', 'crosshair', 'So các trang của app (thư mục <code>app/</code>, <code>pages/</code>, <code>src/routes</code>, <code>sitemap.xml</code>, path trong router hoặc trong source) với các route test đã đi qua. Thêm/bỏ route: <code>"coverage": { "routes": [], "ignore": [], "source": "../crm-frontend", "domainIgnore": [] }</code> trong config.', picker.html);
  const ignored = c.ignored ?? { routes: [], domains: [] };
  const ignoredHtml = `<details class="panel"><summary>Đã bỏ qua (${ignored.routes.length + ignored.domains.length})</summary>
    ${ignored.routes.length || ignored.domains.length ? `<ul class="mono-list">${[...ignored.routes.map((v) => ['route', v]), ...ignored.domains.map((v) => ['domain', v])].map(([k, v]) =>
      `<li><code>${escapeHtml(v)}</code> <span class="muted small">${k === 'route' ? 'route' : 'domain'}</span>${isExport() ? '' : ` <button type="button" class="small-btn" data-unignore="${k}" data-value="${escapeHtml(v)}">${icon('close', { size: 13 })}Xoá khỏi danh sách</button>`}</li>`).join('')}</ul>` : '<p class="muted small">Chưa bỏ qua mục nào. Bấm "Bỏ qua" ở bảng để ẩn một route hay domain.</p>'}
    </details>`;
  if (!c.total && !c.domains?.length) {
    main.innerHTML = `${head}${emptyBox('Không tìm thấy route nào của app', 'Dashboard không đọc được route từ app/, pages/, src/routes, sitemap.xml hay router. Khai báo trong "coverage.routes", hoặc đặt "coverage.source" trỏ tới repo app.')}${ignoredHtml}`;
    picker.bind(main);
    return;
  }
  const domains = c.domains ?? [];
  main.innerHTML = `${head}
    <section class="kpis"><div class="kpi tone-${toneFor(c.share, 0.8, 0.5)}"><div class="kpi-label">Route có test</div><div class="kpi-value">${fmtPct(c.share)}</div><div class="kpi-sub">${meter(c.share, toneFor(c.share, 0.8, 0.5), `${c.covered}/${c.total}`)}</div></div>
      <div class="kpi tone-${c.untested.length ? 'warn' : 'good'}"><div class="kpi-label">Chưa có test</div><div class="kpi-value">${escapeHtml(c.untested.length)}</div><div class="kpi-sub">Trang không test nào mở tới</div></div>
      <div class="kpi"><div class="kpi-label">Domain trong source</div><div class="kpi-value">${escapeHtml(domains.length)}</div><div class="kpi-sub">${c.source ? `quét ${escapeHtml(c.sourceFiles)} file · ${escapeHtml(c.source)}` : 'Chưa đặt "coverage.source"'}</div></div></section>
    <table class="table"><thead><tr><th>Route</th><th>Nguồn</th><th>Test</th><th></th></tr></thead><tbody>${c.rows.map(coverageRowHtml).join('')}</tbody></table>
    ${domains.length ? `<section><h2>${icon('route', { size: 15 })} Domain trong source</h2><table class="table"><thead><tr><th>Host</th><th class="num">Số lần</th><th>File mẫu</th><th></th></tr></thead><tbody>${domains.map(domainRowHtml).join('')}</tbody></table></section>` : ''}
    ${c.extraTested.length ? `<details class="panel"><summary>Route test đi qua nhưng không thấy trong app (${c.extraTested.length})</summary><ul class="mono-list">${c.extraTested.map((r) => `<li><code>${escapeHtml(r)}</code></li>`).join('')}</ul></details>` : ''}
    ${ignoredHtml}`;
  picker.bind(main);
  main.querySelectorAll('[data-route]').forEach((b) => b.addEventListener('click', () => openAiPanel({ action: 'route-test', runId: null, extra: { route: b.dataset.route }, title: `Viết test cho ${b.dataset.route}` })));
  main.querySelectorAll('[data-ignore]').forEach((b) => b.addEventListener('click', () => changeIgnore(main, b.dataset.ignore, b.dataset.value, false)));
  main.querySelectorAll('[data-unignore]').forEach((b) => b.addEventListener('click', () => changeIgnore(main, b.dataset.unignore, b.dataset.value, true)));
}

async function changeIgnore(main, kind, value, remove) {
  const r = await postJson('/api/coverage/ignore', { kind, value, remove }).catch((x) => ({ error: x.message }));
  if (r.error) toast(r.error, 'bad');
  else {
    toast(remove ? `Đã xoá "${value}" khỏi danh sách bỏ qua` : `Đã bỏ qua "${value}"`);
    renderCoverage(main);
  }
}
