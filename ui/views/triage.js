// Triage (M7): every failing test with a state, an assignee and a note. The state follows the failure
// (test + error signature), so tomorrow's run of the same failure keeps it.
import { getJson, postJson, isExport } from '../api.js';
import { pageHead, emptyBox, fmtSpan } from '../analysis.js';
import { openLinearDialog } from './linear.js';
import { escapeHtml, fmtRelative } from '../format.js';
import { testHref, runHref, replaceParams } from '../router.js';
import { toast } from '../toast.js';
import { icon } from '../icons.js';

export const TRIAGE_LABEL = {
  new: ['Mới', 'bad', 'alert'], investigating: ['Đang xem', 'warn', 'search'], known: ['Đã biết', 'info', 'ticket'], fixed: ['Đã sửa', 'good', 'check'], ignored: ['Bỏ qua', 'muted', 'ban'],
};

export function triageRowHtml(r, statuses) {
  const ro = isExport();
  const sel = ro
    ? `<span class="chip tone-${TRIAGE_LABEL[r.status][1]}">${escapeHtml(TRIAGE_LABEL[r.status][0])}</span>`
    : `<select class="tri-status tone-${TRIAGE_LABEL[r.status][1]}" data-tri="status" aria-label="Trạng thái">${statuses.map((s) => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${escapeHtml(TRIAGE_LABEL[s][0])}</option>`).join('')}</select>`;
  const issue = r.issue ? (/^https:\/\//.test(r.issue.url ?? '') ? `<a href="${escapeHtml(r.issue.url)}" target="_blank" rel="noopener">${escapeHtml(r.issue.identifier || 'Linear')}</a>` : escapeHtml(r.issue.identifier || 'Linear')) : r.runId && r.resultId && !ro ? `<button type="button" class="small-btn" data-tri-linear>${icon('ticket', { size: 13 })}Linear</button>` : '';
  return `<tr data-fp="${escapeHtml(r.fp)}">
    <td>${sel}${r.reopened ? `<div class="small tone-bad">mở lại ×${escapeHtml(r.reopened)}</div>` : ''}</td>
    <td class="wrap"><a href="${escapeHtml(testHref(r.key))}"><strong>${escapeHtml(r.title)}</strong></a> <span class="muted small">[${escapeHtml(r.target ?? '?')}]</span>
      ${r.error ? `<div class="small muted"><code>${escapeHtml(r.error.code)}</code> ${escapeHtml(r.error.message)}</div>` : ''}</td>
    <td class="small">${r.failingNow ? `<span class="tone-bad">fail ${escapeHtml(r.streak)} run</span><div class="muted">từ ${escapeHtml(fmtRelative(r.since))} · ${escapeHtml(fmtSpan(Date.now() - Date.parse(r.since)))}</div>` : '<span class="tone-good">không còn fail</span>'}</td>
    <td>${ro ? escapeHtml(r.assignee ?? '') : `<input class="tri-input" data-tri="assignee" value="${escapeHtml(r.assignee ?? '')}" placeholder="@ai đó" maxlength="80" aria-label="Người phụ trách">`}${r.owners?.length ? `<div class="muted small">owner: ${escapeHtml(r.owners.join(', '))}</div>` : ''}</td>
    <td>${ro ? escapeHtml(r.note) : `<input class="tri-input wide" data-tri="note" value="${escapeHtml(r.note)}" placeholder="Ghi chú…" maxlength="2000" aria-label="Ghi chú">`}</td>
    <td class="small">${issue}${r.runId && r.resultId ? ` <a href="${escapeHtml(runHref(r.runId, r.resultId))}">run</a>` : ''}</td></tr>`;
}

let triageFilter = null;

export async function renderTriage(main, route = {}) {
  if (route.params?.status !== undefined) triageFilter = route.params.status || null;
  const b = await getJson('/api/triage');
  const head = pageHead('Triage lỗi', 'ticket', 'Mỗi test fail có trạng thái <em>Mới → Đang xem → Đã biết → Đã sửa / Bỏ qua</em>, người phụ trách và ghi chú. Trạng thái gắn với đúng lỗi đó (test + dạng lỗi): run sau vẫn fail như cũ thì giữ nguyên, “Đã sửa” mà fail lại thì tự mở lại, đang mở mà test pass thì tự chuyển “Đã sửa”.');
  if (!b.rows.length) {
    main.innerHTML = `${head}${emptyBox('Không có lỗi nào cần xử lý', 'Mọi test đều đang pass. 🎉')}`;
    return;
  }
  const chips = `<div class="filters tri-chips"><button type="button" class="pill ${!triageFilter ? 'on' : ''}" data-tri-filter="">Tất cả <strong>${b.rows.length}</strong></button>${b.statuses.map((s) => `<button type="button" class="pill ${triageFilter === s ? 'on' : ''}" data-tri-filter="${s}"><span class="chip tone-${TRIAGE_LABEL[s][1]}">${icon(TRIAGE_LABEL[s][2], { size: 12 })}${escapeHtml(TRIAGE_LABEL[s][0])}</span> <strong>${escapeHtml(b.counts[s])}</strong></button>`).join('')}</div>`;
  const rows = b.rows.filter((r) => !triageFilter || r.status === triageFilter);
  main.innerHTML = `${head}${b.untriaged ? `<div class="banner tone-warn">${icon('alert', { size: 15 })}${escapeHtml(b.untriaged)} lỗi chưa ai nhận: chọn trạng thái hoặc người phụ trách.</div>` : ''}${chips}
    <div class="table-wrap"><table class="table tri-table"><thead><tr><th>Trạng thái</th><th>Test</th><th>Đang fail</th><th>Phụ trách</th><th>Ghi chú</th><th></th></tr></thead><tbody>${rows.map((r) => triageRowHtml(r, b.statuses)).join('')}</tbody></table></div>`;
  main.querySelectorAll('[data-tri-filter]').forEach((x) => x.addEventListener('click', () => {
    triageFilter = x.dataset.triFilter || null;
    replaceParams({ status: triageFilter });
    renderTriage(main);
  }));
  const byFp = new Map(b.rows.map((r) => [r.fp, r]));
  main.querySelectorAll('tr[data-fp]').forEach((tr) => {
    const row = byFp.get(tr.dataset.fp);
    const save = async (field, value) => {
      const res = await postJson('/api/triage', { fp: row.fp, [field]: value, row: { key: row.key, title: row.title, file: row.file, target: row.target, error: row.error, runId: row.runId, resultId: row.resultId } }).catch((e) => ({ error: e.message }));
      if (res.error) return toast(res.error, 'bad');
      toast(field === 'status' ? `Đã chuyển sang “${TRIAGE_LABEL[value][0]}”` : 'Đã lưu');
      if (field === 'status') renderTriage(main);
    };
    tr.querySelector('[data-tri="status"]')?.addEventListener('change', (e) => save('status', e.target.value));
    for (const f of ['assignee', 'note']) tr.querySelector(`[data-tri="${f}"]`)?.addEventListener('change', (e) => save(f, e.target.value));
    tr.querySelector('[data-tri-linear]')?.addEventListener('click', () => openLinearDialog({ runId: row.runId, resultId: row.resultId }));
  });
}
