import { getJson } from '../api.js';
import { openRunDialog } from './run-dialog.js';
import { historyCells } from './tests.js';
import { runCountPicker, analysisCount, pageHead, emptyBox, meter, fmtPct } from '../analysis.js';
import { escapeHtml } from '../format.js';
import { runHref } from '../router.js';
import { icon } from '../icons.js';

export function flakyRowHtml(t) {
  const tone = t.score >= 0.5 ? 'bad' : t.score >= 0.2 ? 'warn' : 'info';
  const test = t.line ? `${t.file}:${t.line}` : t.file;
  return `<tr>
    <td><strong>${escapeHtml(t.title)}</strong><div class="muted small"><code>${escapeHtml(test)}</code> · ${escapeHtml(t.target)}${t.agent !== 'default' ? ` · ${escapeHtml(t.agent)}` : ''}</div></td>
    <td>${meter(t.score, tone, `${Math.round(t.score * 100)}`)}</td>
    <td class="num">${escapeHtml(t.flaky)}</td>
    <td class="num">${escapeHtml(t.flips)}${t.sameCommitFlips ? ` <span class="muted small" title="đổi kết quả mà code không đổi">(${escapeHtml(t.sameCommitFlips)} cùng commit)</span>` : ''}</td>
    <td class="num">${fmtPct(t.failRate)}</td>
    <td>${historyCells(t.history, 15)}</td>
    <td><div class="actions-cell">${t.last ? `<a href="${runHref(t.last.runId, t.last.resultId)}">Lần gần nhất</a>` : ''}
      <button type="button" data-repeat="${escapeHtml(test)}" data-target="${escapeHtml(t.target)}" data-agent="${escapeHtml(t.agent)}" title="Chạy lặp để xác nhận">${icon('rerun', { size: 13 })}Chạy ×5</button></div></td>
  </tr>`;
}

export async function renderFlaky(main) {
  const picker = runCountPicker(() => renderFlaky(main));
  const { tests } = await getJson(`/api/flaky?n=${analysisCount()}`);
  const head = pageHead('Flaky', 'shuffle', 'Test có lúc pass lúc fail: pass nhờ retry (flaky) hoặc đổi kết quả giữa các run. Điểm cao hơn khi đổi kết quả trên cùng một commit.', picker.html);
  main.innerHTML = tests.length
    ? `${head}<table class="table"><thead><tr><th>Test</th><th>Điểm flaky</th><th class="num">Flaky</th><th class="num">Đổi kết quả</th><th class="num">Tỉ lệ fail</th><th>Lịch sử (cũ → mới)</th><th></th></tr></thead><tbody>${tests.map(flakyRowHtml).join('')}</tbody></table>`
    : `${head}${emptyBox('Không có test flaky', 'Trong các run đã chọn, không test nào pass nhờ retry hay đổi kết quả.')}`;
  picker.bind(main);
  main.querySelectorAll('[data-repeat]').forEach((b) =>
    b.addEventListener('click', () => openRunDialog({ tests: [b.dataset.repeat], targets: [b.dataset.target], agents: [b.dataset.agent], repeatEach: 5, title: 'Chạy lặp để xác nhận flaky' })));
}
