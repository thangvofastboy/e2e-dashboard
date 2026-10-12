import { getJson, isExport } from '../api.js';
import { openAiPanel } from './ai-panel.js';
import { runCountPicker, analysisCount, pageHead, emptyBox } from '../analysis.js';
import { escapeHtml, fmtRelative } from '../format.js';
import { runHref } from '../router.js';
import { icon } from '../icons.js';

export function errorGroupHtml(g, { compact = false } = {}) {
  const tests = g.tests
    .slice(0, compact ? 6 : 30)
    .map((t) => `<li><a href="${runHref(t.runId, t.resultId)}">${escapeHtml(t.title)}</a> <span class="muted small">${escapeHtml(t.target)}</span></li>`)
    .join('');
  return `<details class="err-group panel"${compact ? '' : ' open'}>
    <summary><span class="chip tone-bad">${icon('layers', { size: 12 })}${escapeHtml(g.code)}</span>
      <span class="eg-msg">${escapeHtml(g.message)}</span>
      <span class="eg-count muted">${escapeHtml(g.tests.length)} test · ${escapeHtml(g.count)} lần${compact ? '' : ` · ${escapeHtml(g.runs)} run`}</span></summary>
    <div class="eg-body">
      ${isExport() || !g.latest ? '' : `<p><button type="button" class="btn-ai" data-explain-group="${escapeHtml(g.id)}" data-run="${escapeHtml(g.latest.runId)}" data-title="${escapeHtml(g.message.slice(0, 60))}">${icon('sparkles', { size: 14 })}AI giải thích nhóm này</button> <span class="muted small">Nguyên nhân chung, do app hay do test, cách sửa</span></p>`}
      ${g.locator ? `<div><span class="muted">Locator:</span> <code>${escapeHtml(g.locator)}</code></div>` : ''}
      <div class="muted small">Mẫu: <code>${escapeHtml(g.pattern)}</code>${compact ? '' : ` · lần đầu ${escapeHtml(fmtRelative(g.firstSeen))} · gần nhất ${escapeHtml(fmtRelative(g.lastSeen))}`}</div>
      <ul class="eg-tests">${tests}</ul>${g.tests.length > (compact ? 6 : 30) ? `<p class="muted small">…và ${g.tests.length - (compact ? 6 : 30)} test khác</p>` : ''}
    </div></details>`;
}

export async function renderErrors(main) {
  const picker = runCountPicker(() => renderErrors(main));
  const { groups } = await getJson(`/api/errors?n=${analysisCount()}`);
  const head = pageHead('Nhóm lỗi', 'layers', 'Lỗi cùng mã và cùng dạng thông báo (bỏ qua số, chuỗi trong ngoặc, id, URL) được gom lại: sửa một chỗ, hết nhiều test.', picker.html);
  main.innerHTML = groups.length ? `${head}<div class="err-groups">${groups.map((g) => errorGroupHtml(g)).join('')}</div>` : `${head}${emptyBox('Không có lỗi nào', 'Các run đã chọn không có test fail.')}`;
  picker.bind(main);
}

// một listener cho mọi nơi hiện nhóm lỗi (trang Nhóm lỗi, trang Run)
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-explain-group]');
    if (!b) return;
    openAiPanel({ action: 'explain-group', runId: b.dataset.run, title: `Giải thích nhóm lỗi · ${b.dataset.title}`, extra: { groupId: b.dataset.explainGroup } });
  });
}
