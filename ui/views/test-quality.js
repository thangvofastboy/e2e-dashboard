import { getJson } from '../api.js';
import { pageHead, emptyBox } from '../analysis.js';
import { toast } from '../toast.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';

// Chất lượng test: điểm từng test, test trùng, test nên tách / gộp. Mỗi việc có một prompt để Claude Code làm,
// dashboard không tự sửa mã test.
const QUALITY_KIND = { 'same-title': 'Trùng tên', 'same-steps': 'Gộp: bước giống hệt', split: 'Nên tách' };
const QUALITY_TONE = { A: 'good', B: 'good', C: 'warn', D: 'bad' };

function groupHtml(g, i) {
  return `<article class="panel tq-group"><header><span class="chip tone-${g.kind === 'split' ? 'warn' : 'info'}">${escapeHtml(QUALITY_KIND[g.kind])}</span> <span class="muted small">${escapeHtml(g.why)}</span>
      <button type="button" class="small-btn" data-copy-prompt="${i}">${icon('copy', { size: 13 })}Copy prompt cho Claude Code</button></header>
    <ul class="tq-members">${g.members.map((m) => `<li><strong>${escapeHtml(m.title)}</strong> <code>${escapeHtml(m.file)}${m.line ? `:${escapeHtml(m.line)}` : ''}</code> <span class="muted small">${escapeHtml(m.target)}</span></li>`).join('')}</ul>
    ${g.cuts ? `<p class="small">Điểm cắt gợi ý: ${g.cuts.map((c) => `sau bước ${c.step} (${escapeHtml(c.label)})`).join(' · ')}</p>` : ''}</article>`;
}

export async function renderTestQuality(main) {
  const [q, d] = await Promise.all([getJson('/api/qc/quality?n=10'), getJson('/api/qc/dupes')]);
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  for (const r of q.rows) counts[r.grade] += 1;
  const avg = q.rows.length ? Math.round(q.rows.reduce((s, r) => s + r.score, 0) / q.rows.length) : null;
  main.innerHTML = `${pageHead('Chất lượng test', 'check', 'Chấm điểm từng test theo cấu trúc, độ ổn định và chi phí; tìm test trùng và test nên tách hoặc gộp. Dashboard chỉ đề xuất, Claude Code làm việc sửa.')}
    ${q.rows.length ? `<div class="sys-stats">
      <div class="sys-stat"><span class="sys-stat-v">${avg ?? '—'}</span><span class="sys-stat-l">Điểm trung bình</span></div>
      <div class="sys-stat tone-good"><span class="sys-stat-v">${counts.A + counts.B}</span><span class="sys-stat-l">Tốt (A–B)</span></div>
      <div class="sys-stat tone-warn"><span class="sys-stat-v">${counts.C}</span><span class="sys-stat-l">Cần xem (C)</span></div>
      <div class="sys-stat tone-bad"><span class="sys-stat-v">${counts.D}</span><span class="sys-stat-l">Yếu (D)</span></div>
      <div class="sys-stat"><span class="sys-stat-v">${d.groups.length}</span><span class="sys-stat-l">Việc trùng / tách / gộp</span></div></div>` : ''}
    <h2>Việc cần làm</h2>
    ${d.groups.length ? `<div class="tq-groups">${d.groups.map(groupHtml).join('')}</div>` : emptyBox('Không có test trùng hay cần tách', 'Theo dữ liệu của run mới nhất.')}
    <h2>Điểm từng test <span class="muted small">(run ${escapeHtml(q.runId ? q.runId.slice(-8) : '—')}, thấp nhất trước)</span></h2>
    ${q.rows.length ? `<section class="panel"><div class="table-wrap"><table class="table tq-table"><thead><tr><th>Điểm</th><th>Test</th><th>Target</th><th>Vấn đề phát hiện</th></tr></thead><tbody>${q.rows.map((r) => `<tr>
        <td><span class="chip tone-${QUALITY_TONE[r.grade]}">${r.score} · ${r.grade}</span></td>
        <td><strong>${escapeHtml(r.title)}</strong><div class="muted small">${escapeHtml(r.file)}</div></td>
        <td>${escapeHtml(r.target)}</td>
        <td>${r.checks.length ? `<ul class="tq-checks">${r.checks.map((c) => `<li>${escapeHtml(c.text)} <span class="muted small">(−${c.penalty})</span></li>`).join('')}</ul>` : '<span class="muted small">Không có vấn đề nào được phát hiện</span>'}</td></tr>`).join('')}</tbody></table></div></section>` : emptyBox('Chưa có run nào để chấm điểm')}
    <p class="muted small">Cách chấm: bắt đầu từ 100; trừ điểm khi thiếu kiểm tra (assert), bước không có mô tả, nhiều lần gọi model, chạy lâu, flaky, trùng, quá dài. Đây là heuristic để ưu tiên việc xem lại, không thay được việc đọc test.</p>`;
  main.querySelectorAll('[data-copy-prompt]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(d.groups[Number(b.dataset.copyPrompt)].prompt);
      toast('Đã chép prompt');
    } catch (x) {
      toast(`Không chép được: ${x.message}`, 'bad');
    }
  }));
}
