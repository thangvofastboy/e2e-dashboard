import { getJson } from '../api.js';
import { runCountPicker, analysisCount, pageHead, emptyBox } from '../analysis.js';
import { escapeHtml } from '../format.js';
import { runHref } from '../router.js';

const RULE_TONE = { 'no-verification': 'bad', 'multi-goal': 'warn', 'too-long': 'warn', vague: 'warn', 'check-in-act': 'warn', 'cache-gap': 'info', 'budget-heavy': 'warn' };

export function lintRowHtml(f, rules) {
  return `<article class="panel loc"><header><div><strong>${escapeHtml(f.title)}</strong> <span class="muted small">${escapeHtml(f.target)}</span>
      <div><code>${escapeHtml(f.api)}</code> “${escapeHtml(f.label)}” <span class="muted small">${f.source ? `${escapeHtml(f.source.file)}:${escapeHtml(f.source.line)}` : ''}</span></div></div>
      <a href="${runHref(f.latest.runId, f.latest.resultId)}">Xem run</a></header>
    <ul class="eg-tests">${f.rules.map((r) => `<li><span class="chip tone-${RULE_TONE[r] ?? 'info'}">${escapeHtml(r)}</span> ${escapeHtml(rules[r] ?? '')}</li>`).join('')}</ul></article>`;
}

export async function renderLint(main) {
  const picker = runCountPicker(() => renderLint(main));
  const { findings, rules } = await getJson(`/api/lint?n=${analysisCount()}`);
  const head = pageHead('Lint câu lệnh agent', 'lint', 'Kiểm tra các bước <code>agent.*</code>: thiếu bước kiểm tra (cache không được ghi), gộp nhiều mục tiêu, quá dài, mơ hồ, đọc giá trị trên màn hình, tốn nhiều model call.', picker.html);
  main.innerHTML = findings.length ? `${head}<section class="locs">${findings.map((f) => lintRowHtml(f, rules)).join('')}</section>` : `${head}${emptyBox('Không có cảnh báo', 'Các câu lệnh agent trong các run đã chọn đều ổn.')}`;
  picker.bind(main);
}
