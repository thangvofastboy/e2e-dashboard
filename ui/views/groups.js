// Scorecards by module, tag or owner (M7).
import { getJson } from '../api.js';
import { runCountPicker, analysisCount, pageHead, emptyBox, meter, fmtPct, toneFor } from '../analysis.js';
import { sparkline } from '../charts.js';
import { escapeHtml, fmtDuration } from '../format.js';
import { runHref, replaceParams } from '../router.js';
import { icon } from '../icons.js';

const GROUP_BY = { module: ['Module', 'folder'], tag: ['Tag', 'filter'], owner: ['Team / owner', 'users'] };
const GRADE_TONE = { A: 'good', B: 'good', C: 'warn', D: 'bad', F: 'bad' };
let groupBy = 'module';

export function groupRowHtml(g) {
  return `<tr><td><span class="grade tone-${GRADE_TONE[g.grade] ?? 'muted'}">${escapeHtml(g.grade)}</span></td>
    <td class="wrap"><strong>${escapeHtml(g.group)}</strong>${g.owners.length ? `<div class="muted small">${escapeHtml(g.owners.join(', '))}</div>` : ''}</td>
    <td class="num">${escapeHtml(g.tests)}</td><td>${meter(g.passRate, toneFor(g.passRate), fmtPct(g.passRate))}</td><td class="spark-cell">${sparkline(g.trend)}</td>
    <td class="wrap">${g.failingNow.length ? g.failingNow.slice(0, 4).map((t) => `<a class="tone-bad small" href="${escapeHtml(runHref(t.runId, t.resultId))}">${escapeHtml(t.title)}</a>`).join('<br>') + (g.failingNow.length > 4 ? `<div class="muted small">+${g.failingNow.length - 4} test</div>` : '') : '<span class="muted">—</span>'}</td>
    <td class="num">${g.flaky ? `<span class="tone-warn">${escapeHtml(g.flaky)}</span>` : '0'}</td><td class="num">${escapeHtml(fmtDuration(g.avgDurationMs))}</td></tr>`;
}

export async function renderGroups(main, route = {}) {
  if (GROUP_BY[route.params?.by]) groupBy = route.params.by;
  const picker = runCountPicker(() => renderGroups(main));
  const d = await getJson(`/api/groups?by=${groupBy}&n=${analysisCount()}`);
  const tabs = `<span class="seg-btns" role="group" aria-label="Gom theo">${Object.entries(GROUP_BY).map(([k, [label, ic]]) => `<button type="button" data-by="${k}" aria-pressed="${k === groupBy}">${icon(ic, { size: 14 })}${escapeHtml(label)}</button>`).join('')}</span>`;
  const head = pageHead('Theo module / team', 'layers', 'Bảng điểm cho từng module (thư mục test, hoặc <code>"modules": { "Checkout": ["tests/checkout/**"] }</code> trong config), tag hoặc owner trong CODEOWNERS. Điểm A–F tính từ pass rate trừ phần flaky.', `${tabs}${picker.html}`);
  main.innerHTML = d.rows.length
    ? `${head}<table class="table"><thead><tr><th>Điểm</th><th>${escapeHtml(GROUP_BY[groupBy][0])}</th><th>Test</th><th>Pass rate</th><th>Xu hướng</th><th>Đang fail</th><th>Flaky</th><th>TB / test</th></tr></thead><tbody>${d.rows.map(groupRowHtml).join('')}</tbody></table>`
    : `${head}${emptyBox('Chưa có dữ liệu', groupBy === 'owner' ? 'Thêm file CODEOWNERS để gom theo team.' : 'Chạy test vài lần trước.')}`;
  picker.bind(main);
  main.querySelectorAll('[data-by]').forEach((b) => b.addEventListener('click', () => {
    groupBy = b.dataset.by;
    replaceParams({ by: groupBy });
    renderGroups(main);
  }));
}
