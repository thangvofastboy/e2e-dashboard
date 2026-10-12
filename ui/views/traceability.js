// Requirement traceability (M7): story → tests → latest status.
import { getJson } from '../api.js';
import { runCountPicker, analysisCount, pageHead, emptyBox } from '../analysis.js';
import { escapeHtml, statusBadge } from '../format.js';
import { testHref } from '../router.js';
import { icon } from '../icons.js';

const STORY_STATUS = { passing: ['Đang pass', 'good'], failing: ['Đang fail', 'bad'], flaky: ['Flaky', 'warn'], 'not-run': ['Chưa chạy', 'muted'], 'no-tests': ['Chưa có test', 'warn'] };

export function storyRowHtml(s) {
  const [label, tone] = STORY_STATUS[s.status];
  return `<tr><td>${s.url ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener"><code>${escapeHtml(s.id)}</code></a>` : `<code>${escapeHtml(s.id)}</code>`}${s.title ? `<div class="small muted">${escapeHtml(s.title)}</div>` : ''}${s.unlisted ? '<div class="small muted">(không có trong danh sách)</div>' : ''}</td>
    <td><span class="chip tone-${tone}">${escapeHtml(label)}</span></td>
    <td class="wrap">${s.tests.length ? s.tests.map((t) => `<div>${statusBadge(t.status)} <a href="${escapeHtml(testHref(t.key))}">${escapeHtml(t.title)}</a> <span class="muted small">[${escapeHtml(t.target)}]</span></div>`).join('') : '<span class="muted">—</span>'}</td></tr>`;
}

export async function renderTraceability(main) {
  const picker = runCountPicker(() => renderTraceability(main));
  const d = await getJson(`/api/traceability?n=${analysisCount()}`);
  const head = pageHead('Truy vết yêu cầu', 'ticket', 'Gắn test với story/ticket bằng tag <code>@LIN-123</code> (hoặc <code>@story:LIN-123</code>) hoặc <code>[LIN-123]</code> trong tên test. Liệt kê các story cần có test trong config: <code>"traceability": { "stories": ["LIN-1", { "id": "LIN-2", "title": "Checkout", "url": "https://…" }] }</code>.', picker.html);
  if (!d.rows.length) {
    main.innerHTML = `${head}${emptyBox('Chưa có test nào gắn story', `${d.tests} test chưa gắn id nào. Thêm tag như <code>@LIN-123</code> vào test.`)}`;
    picker.bind(main);
    return;
  }
  const s = d.summary;
  const card = (label, value, tone, sub = '') => `<div class="kpi tone-${tone}"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${escapeHtml(value)}</div><div class="kpi-sub">${sub}</div></div>`;
  main.innerHTML = `${head}<section class="kpis">
      ${card('Story', s.stories, 'info', s.listed ? `${s.covered}/${s.listed} story trong danh sách có test` : `${d.unlinkedTests}/${d.tests} test chưa gắn story`)}
      ${card('Đang pass', s.passing, 'good')}${card('Đang fail', s.failing, s.failing ? 'bad' : 'good')}${card('Flaky', s.flaky, s.flaky ? 'warn' : 'good')}
      ${card('Chưa có test', s.noTests, s.noTests ? 'warn' : 'good', s.listed ? '' : 'Cần danh sách story trong config')}</section>
    <table class="table"><thead><tr><th>Story</th><th>Trạng thái</th><th>Test</th></tr></thead><tbody>${d.rows.map(storyRowHtml).join('')}</tbody></table>
    <p class="muted small">${icon('info', { size: 12 })} ${escapeHtml(d.unlinkedTests)} test chưa gắn story nào.</p>`;
  picker.bind(main);
}
