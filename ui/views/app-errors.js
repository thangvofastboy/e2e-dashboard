import { getJson } from '../api.js';
import { runCountPicker, analysisCount, pageHead, emptyBox } from '../analysis.js';
import { escapeHtml, fmtRelative } from '../format.js';
import { runHref } from '../router.js';
import { icon } from '../icons.js';

export function appErrorHtml(g) {
  const tone = g.level === 'error' ? 'bad' : 'warn';
  return `<details class="err-group panel"><summary><span class="chip tone-${tone}">${icon(g.source === 'network' ? 'route' : 'terminal', { size: 12 })}${escapeHtml(g.source)}${g.httpStatus ? ` ${escapeHtml(g.httpStatus)}` : ''}</span>
      <span class="eg-msg"><code>${escapeHtml(g.signature)}</code></span>
      <span class="eg-count muted">${escapeHtml(g.runs)} run · ${escapeHtml(g.tests.length)} test · ${escapeHtml(g.count)} lần${g.failing ? ` · <span class="tone-bad delta">${escapeHtml(g.failing)} trong test fail</span>` : ''}</span></summary>
    <div class="eg-body"><div class="muted small">Mẫu: ${escapeHtml(g.sample)}</div>
      <div class="muted small">Lần đầu ${escapeHtml(fmtRelative(g.firstSeen))}${g.firstCommit ? ` (commit <code>${escapeHtml(String(g.firstCommit).slice(0, 10))}</code>)` : ''} · gần nhất ${escapeHtml(fmtRelative(g.lastSeen))}</div>
      <ul class="eg-tests">${g.tests.slice(0, 12).map((t) => `<li><a href="${runHref(t.runId, t.resultId)}">${escapeHtml(t.title)}</a></li>`).join('')}</ul></div></details>`;
}

export async function renderAppErrors(main) {
  const picker = runCountPicker(() => renderAppErrors(main));
  const { groups } = await getJson(`/api/app-errors?n=${analysisCount()}`);
  const head = pageHead('Lỗi phía app', 'terminal', 'Lỗi console và request lỗi (4xx/5xx) mà app sinh ra trong lúc test chạy, gom theo dạng (bỏ id, số, query). Lỗi xuất hiện trong test fail thường là lỗi app thật, không phải lỗi test.', picker.html);
  main.innerHTML = groups.length ? `${head}<div class="err-groups">${groups.map(appErrorHtml).join('')}</div>` : `${head}${emptyBox('Không có lỗi app nào', 'appLog trong các run đã chọn không có error/warning.')}`;
  picker.bind(main);
}
