import { getJson } from '../api.js';
import { pageHead, emptyBox } from '../analysis.js';
import { toast } from '../toast.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';
import { openAiPanel } from './ai-panel.js';

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

// ponytail: chép từ datalist ai-models ở ui/views/system.js (không export); đổi một chỗ thì đổi cả hai
const AI_MODELS = ['fable', 'opus', 'sonnet', 'haiku', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
const AI_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

// hộp nhỏ chọn model / effort cho "AI đánh giá lại"; mặc định theo Cài đặt hệ thống › AI
export function reviewFormHtml(ai = {}) {
  const opt = (v, label, cur) => `<option value="${escapeHtml(v)}"${v === cur ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  return `<form class="form-row" data-review-form><label>Model <select name="model">${opt('', 'mặc định', ai.model ?? '')}${AI_MODELS.map((m) => opt(m, m, ai.model)).join('')}</select></label>
    <label>Effort <select name="effort">${opt('', 'mặc định', ai.effort ?? '')}${AI_EFFORTS.map((e) => opt(e, e, ai.effort)).join('')}</select></label>
    <button type="submit" class="btn-ai">${icon('sparkles', { size: 14 })}Đánh giá</button><button type="button" data-review-cancel>${icon('close', { size: 14 })}Huỷ</button></form>`;
}

export async function renderTestQuality(main) {
  const [q, d] = await Promise.all([getJson('/api/qc/quality?n=10'), getJson('/api/qc/dupes')]);
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  for (const r of q.rows) counts[r.grade] += 1;
  const avg = q.rows.length ? Math.round(q.rows.reduce((s, r) => s + r.score, 0) / q.rows.length) : null;
  main.innerHTML = `${pageHead('Chất lượng test', 'check', 'Chấm điểm từng test theo cấu trúc, độ ổn định và chi phí; tìm test trùng và test nên tách hoặc gộp. Dashboard chỉ đề xuất, Claude Code làm việc sửa.')}
    <div class="form-row"><button type="button" data-recalc>${icon('recycle', { size: 14 })}Tính lại</button>
      <button type="button" class="btn-ai" data-review>${icon('sparkles', { size: 14 })}AI đánh giá lại</button></div>
    <div data-review-box hidden></div>
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
  main.querySelector('[data-recalc]').addEventListener('click', async (e) => {
    e.currentTarget.setAttribute('aria-busy', 'true');
    await renderTestQuality(main).catch((x) => toast(x.message, 'bad'));
  });
  main.querySelector('[data-review]').addEventListener('click', async () => {
    const box = main.querySelector('[data-review-box]');
    if (!box.hidden) return (box.hidden = true);
    const sys = await getJson('/api/system').catch(() => null);
    box.innerHTML = reviewFormHtml(sys?.user?.ai);
    box.hidden = false;
    box.querySelector('[data-review-cancel]').addEventListener('click', () => (box.hidden = true));
    box.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      // ai-panel gửi nguyên extra vào body POST /api/ai/quality-review; trống = theo Settings
      const extra = Object.fromEntries(['model', 'effort'].filter((k) => f.get(k)).map((k) => [k, f.get(k)]));
      openAiPanel({ action: 'quality-review', runId: null, extra, title: 'Chất lượng test · AI đánh giá lại' });
      box.hidden = true;
    });
  });
  main.querySelectorAll('[data-copy-prompt]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(d.groups[Number(b.dataset.copyPrompt)].prompt);
      toast('Đã chép prompt');
    } catch (x) {
      toast(`Không chép được: ${x.message}`, 'bad');
    }
  }));
}
