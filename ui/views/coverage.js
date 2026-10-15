import { getJson, postJson, isExport } from '../api.js';
import { openAiPanel } from './ai-panel.js';
import { runCountPicker, analysisCount, pageHead, emptyBox, meter, fmtPct, toneFor } from '../analysis.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';
import { toast } from '../toast.js';
import { replaceParams } from '../router.js';

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

const COV_TABS = ['route', 'domain'];
const urlCovTab = () => new URLSearchParams(location.hash.split('?')[1] ?? '').get('tab');

// danh sách "Đã bỏ qua" của một loại (route hoặc domain)
function covIgnoredHtml(kind, values) {
  return `<details class="panel"><summary>Đã bỏ qua (${values.length})</summary>
    ${values.length ? `<ul class="mono-list">${values.map((v) =>
      `<li><code>${escapeHtml(v)}</code> <span class="muted small">${kind}</span>${isExport() ? '' : ` <button type="button" class="small-btn" data-unignore="${kind}" data-value="${escapeHtml(v)}">${icon('close', { size: 13 })}Xoá khỏi danh sách</button>`}</li>`).join('')}</ul>` : `<p class="muted small">Chưa bỏ qua ${kind} nào. Bấm "Bỏ qua" ở bảng để ẩn một ${kind}.</p>`}
    </details>`;
}

// Thân trang coverage: thanh tab Route / Domain trong source + hai pane (pane không chọn thì hidden).
// Đổi tab chỉ bật/tắt hidden, không vẽ lại, nên các nút đã gắn sự kiện vẫn chạy.
export function coverageBodyHtml(c, tab = 'route') {
  if (!COV_TABS.includes(tab)) tab = 'route';
  const domains = c.domains ?? [];
  const ignored = c.ignored ?? { routes: [], domains: [] };
  const tabBtn = (k, label, n) => `<button type="button" role="tab" id="cov-tab-${k}" data-cov-tab="${k}" aria-controls="cov-pane-${k}" aria-selected="${k === tab}" tabindex="${k === tab ? 0 : -1}">${label} <span class="cnt">${escapeHtml(n)}</span></button>`;
  const pane = (k, html) => `<div id="cov-pane-${k}" role="tabpanel" aria-labelledby="cov-tab-${k}"${k === tab ? '' : ' hidden'}>${html}</div>`;
  const route = `<section class="kpis"><div class="kpi tone-${toneFor(c.share, 0.8, 0.5)}"><div class="kpi-label">Route có test</div><div class="kpi-value">${fmtPct(c.share)}</div><div class="kpi-sub">${meter(c.share, toneFor(c.share, 0.8, 0.5), `${c.covered}/${c.total}`)}</div></div>
      <div class="kpi tone-${c.untested.length ? 'warn' : 'good'}"><div class="kpi-label">Chưa có test</div><div class="kpi-value">${escapeHtml(c.untested.length)}</div><div class="kpi-sub">Trang không test nào mở tới</div></div></section>
    ${c.rows.length ? `<table class="table"><thead><tr><th>Route</th><th>Nguồn</th><th>Test</th><th></th></tr></thead><tbody>${c.rows.map(coverageRowHtml).join('')}</tbody></table>` : '<p class="muted">Không tìm thấy route nào của app.</p>'}
    ${c.extraTested.length ? `<details class="panel"><summary>Route test đi qua nhưng không thấy trong app (${c.extraTested.length})</summary><ul class="mono-list">${c.extraTested.map((r) => `<li><code>${escapeHtml(r)}</code></li>`).join('')}</ul></details>` : ''}
    ${covIgnoredHtml('route', ignored.routes)}`;
  const domain = `<p class="muted small">${c.source ? `Quét ${escapeHtml(c.sourceFiles)} file · <code>${escapeHtml(c.source)}</code>` : 'Chưa đặt "coverage.source"'}</p>
    ${domains.length ? `<table class="table"><thead><tr><th>Host</th><th class="num">Số lần</th><th>File mẫu</th><th></th></tr></thead><tbody>${domains.map(domainRowHtml).join('')}</tbody></table>` : '<p class="muted">Không thấy domain nào trong source.</p>'}
    ${covIgnoredHtml('domain', ignored.domains)}`;
  return `<div class="seg-btns tabbar" role="tablist" aria-label="Loại coverage">${tabBtn('route', 'Route', c.total ?? 0)}${tabBtn('domain', 'Domain trong source', domains.length)}</div>
    ${pane('route', route)}${pane('domain', domain)}`;
}

export async function renderCoverage(main) {
  const picker = runCountPicker(() => renderCoverage(main));
  const c = await getJson(`/api/coverage?n=${analysisCount()}`);
  const head = pageHead('Khoảng trống coverage', 'crosshair', 'So các trang của app (thư mục <code>app/</code>, <code>pages/</code>, <code>src/routes</code>, <code>sitemap.xml</code>, path trong router hoặc trong source) với các route test đã đi qua. Thêm/bỏ route: <code>"coverage": { "routes": [], "ignore": [], "source": "../crm-frontend", "domainIgnore": [] }</code> trong config.', picker.html);
  const ignored = c.ignored ?? { routes: [], domains: [] };
  if (!c.total && !c.domains?.length) {
    main.innerHTML = `${head}${emptyBox('Không tìm thấy route nào của app', 'Dashboard không đọc được route từ app/, pages/, src/routes, sitemap.xml hay router. Khai báo trong "coverage.routes", hoặc đặt "coverage.source" trỏ tới repo app.')}${covIgnoredHtml('route', ignored.routes)}${covIgnoredHtml('domain', ignored.domains)}`;
  } else main.innerHTML = `${head}${coverageBodyHtml(c, urlCovTab() ?? 'route')}`;
  picker.bind(main);
  const showTab = (k, focus = false) => {
    main.querySelectorAll('[data-cov-tab]').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.covTab === k));
      b.tabIndex = b.dataset.covTab === k ? 0 : -1;
      if (focus && b.dataset.covTab === k) b.focus();
    });
    for (const t of COV_TABS) {
      const p = main.querySelector(`#cov-pane-${t}`);
      if (p) p.hidden = t !== k;
    }
    replaceParams({ tab: k === 'route' ? '' : k });
  };
  main.querySelectorAll('[data-cov-tab]').forEach((b) => {
    b.addEventListener('click', () => showTab(b.dataset.covTab));
    b.addEventListener('keydown', (e) => { // mũi tên trái/phải chuyển tab (2 tab nên cùng là "tab kia")
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      showTab(COV_TABS[(COV_TABS.indexOf(b.dataset.covTab) + 1) % COV_TABS.length], true);
    });
  });
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
