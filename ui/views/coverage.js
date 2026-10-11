import { getJson, isExport } from '../api.js';
import { openAiPanel } from './ai-panel.js';
import { runCountPicker, analysisCount, pageHead, emptyBox, meter, fmtPct, toneFor } from '../analysis.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';

export function coverageRowHtml(r) {
  return `<tr><td><code>${escapeHtml(r.route)}</code></td><td class="muted small">${escapeHtml(r.source)}</td>
    <td>${r.tested ? `<span class="chip tone-good">${icon('check', { size: 12 })}${escapeHtml(r.tests)} test · ${escapeHtml(r.visits)} lượt</span>${r.failures ? ` <span class="tone-bad delta">${escapeHtml(r.failures)} fail</span>` : ''}` : `<span class="chip tone-warn">${icon('alert', { size: 12 })}chưa có test</span>`}</td>
    <td>${!r.tested && !isExport() ? `<button type="button" class="btn-ai small-btn" data-route="${escapeHtml(r.route)}">${icon('sparkles', { size: 13 })}Viết test</button>` : ''}</td></tr>`;
}

export async function renderCoverage(main) {
  const picker = runCountPicker(() => renderCoverage(main));
  const c = await getJson(`/api/coverage?n=${analysisCount()}`);
  const head = pageHead('Khoảng trống coverage', 'crosshair', 'So các trang của app (thư mục <code>app/</code>, <code>pages/</code>, <code>src/routes</code>, <code>sitemap.xml</code> hoặc path trong router) với các route test đã đi qua. Thêm/bỏ route: <code>"coverage": { "routes": [], "ignore": [] }</code> trong config.', picker.html);
  if (!c.total) {
    main.innerHTML = `${head}${emptyBox('Không tìm thấy route nào của app', 'Dashboard không đọc được route từ app/, pages/, src/routes, sitemap.xml hay router. Khai báo trong "coverage.routes".')}`;
    picker.bind(main);
    return;
  }
  main.innerHTML = `${head}
    <section class="kpis"><div class="kpi tone-${toneFor(c.share, 0.8, 0.5)}"><div class="kpi-label">Route có test</div><div class="kpi-value">${fmtPct(c.share)}</div><div class="kpi-sub">${meter(c.share, toneFor(c.share, 0.8, 0.5), `${c.covered}/${c.total}`)}</div></div>
      <div class="kpi tone-${c.untested.length ? 'warn' : 'good'}"><div class="kpi-label">Chưa có test</div><div class="kpi-value">${escapeHtml(c.untested.length)}</div><div class="kpi-sub">trang không test nào mở tới</div></div></section>
    <table class="table"><thead><tr><th>Route</th><th>Nguồn</th><th>Test</th><th></th></tr></thead><tbody>${c.rows.map(coverageRowHtml).join('')}</tbody></table>
    ${c.extraTested.length ? `<details class="panel"><summary>Route test đi qua nhưng không thấy trong app (${c.extraTested.length})</summary><ul class="mono-list">${c.extraTested.map((r) => `<li><code>${escapeHtml(r)}</code></li>`).join('')}</ul></details>` : ''}`;
  picker.bind(main);
  main.querySelectorAll('[data-route]').forEach((b) => b.addEventListener('click', () => openAiPanel({ action: 'route-test', runId: null, extra: { route: b.dataset.route }, title: `Viết test cho ${b.dataset.route}` })));
}
