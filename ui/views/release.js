// Release readiness (M7): the runs at a git tag against the previous tag, with a verdict.
import { getJson, isExport } from '../api.js';
import { openAiPanel } from './ai-panel.js';
import { pageHead, emptyBox, fmtPct, fmtPoints } from '../analysis.js';
import { CHANGES } from './compare.js';
import { escapeHtml, statusBadge } from '../format.js';
import { runHref, compareHref, testHref } from '../router.js';
import { icon } from '../icons.js';

const VERDICT = { ready: ['Sẵn sàng phát hành', 'good', 'check'], risk: ['Có rủi ro', 'warn', 'alert'], blocked: ['Chưa nên phát hành', 'bad', 'x'], unknown: ['Chưa đủ dữ liệu', 'muted', 'info'] };
let releaseSel = { from: '', to: '' };

export function verdictHtml(v, reasons) {
  const [label, tone, ic] = VERDICT[v] ?? VERDICT.unknown;
  return `<section class="verdict tone-${tone}"><div class="verdict-title">${icon(ic, { size: 22 })}<strong>${escapeHtml(label)}</strong></div>${reasons.length ? `<ul>${reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : '<p>Không có test fail, không có test mới fail, không flaky.</p>'}</section>`;
}

export async function renderRelease(main) {
  const q = new URLSearchParams(Object.entries(releaseSel).filter(([, v]) => v)).toString();
  const d = await getJson(`/api/release${q ? `?${q}` : ''}`);
  const head = (right = '') => pageHead('Báo cáo phát hành', 'upload', 'So sánh run ở commit của một tag git với tag trước đó, kèm kết luận. Dùng “In / Lưu PDF” để đính kèm vào release note.', right);
  if (d.error === 'no-tags' || !d.tags?.length) {
    main.innerHTML = `${head()}${emptyBox('Repo chưa có tag git nào', 'Tạo tag cho mỗi bản phát hành (vd. <code>git tag v1.4</code>) rồi chạy test ở commit đó. Muốn so 2 run bất kỳ: chọn 2 run ở trang Runs.')}`;
    return;
  }
  const opt = (sel) => d.tags.map((t) => `<option value="${escapeHtml(t.name)}" ${t.name === sel ? 'selected' : ''}>${escapeHtml(t.name)} · ${escapeHtml(t.date.slice(0, 10))}</option>`).join('');
  const tools = `<label>Từ <select data-rel="from"><option value="">(tag trước)</option>${opt(d.from?.name)}</select></label><label>Đến <select data-rel="to">${opt(d.to?.name)}</select></label>
    <button type="button" class="primary no-print" data-print>${icon('download', { size: 14 })}In / Lưu PDF</button>
    ${isExport() || d.error || !d.to ? '' : `<button type="button" class="btn-ai no-print" data-ai-release>${icon('sparkles', { size: 14 })}AI viết ghi chú QA</button>`}`;
  if (d.error === 'unknown-tag') {
    main.innerHTML = `${head(tools)}${emptyBox('Không thấy tag này', '')}`;
  } else {
    const c = d.compare;
    const rows = c ? c.rows.map((r) => `<tr><td><span class="chip tone-${CHANGES[r.change]?.tone ?? 'muted'}">${escapeHtml(CHANGES[r.change]?.label ?? r.change)}</span></td><td><a href="${escapeHtml(testHref(r.key))}">${escapeHtml(r.title)}</a> <span class="muted small">[${escapeHtml(r.target)}]</span></td><td>${r.a ? statusBadge(r.a.status) : '—'}</td><td>${r.b ? statusBadge(r.b.status) : '—'}</td></tr>`).join('') : '';
    main.innerHTML = `${head(tools)}
      <div class="report">${verdictHtml(d.verdict, d.reasons)}
      <section class="kpis">
        <div class="kpi tone-info"><div class="kpi-label">Bản phát hành</div><div class="kpi-value">${escapeHtml(d.to.name)}</div><div class="kpi-sub">${d.from ? `so với ${escapeHtml(d.from.name)}` : 'tag đầu tiên'} · ${escapeHtml(d.commits)} commit</div></div>
        <div class="kpi tone-${d.passRate == null ? 'muted' : d.passRate >= 0.95 ? 'good' : 'bad'}"><div class="kpi-label">Pass rate ở tag</div><div class="kpi-value">${escapeHtml(fmtPct(d.passRate))}</div><div class="kpi-sub">${c?.deltas?.passRate != null ? `${escapeHtml(fmtPoints(c.deltas.passRate))} so với ${escapeHtml(d.from.name)}` : ''}</div></div>
        <div class="kpi tone-${d.failing.length ? 'bad' : 'good'}"><div class="kpi-label">Đang fail</div><div class="kpi-value">${escapeHtml(d.failing.length)}</div><div class="kpi-sub">${c ? `${escapeHtml(c.counts.regressed)} mới fail · ${escapeHtml(c.counts.fixed)} đã sửa` : ''}</div></div>
        <div class="kpi tone-${d.flaky.length ? 'warn' : 'good'}"><div class="kpi-label">Flaky trong bản này</div><div class="kpi-value">${escapeHtml(d.flaky.length)}</div><div class="kpi-sub">${escapeHtml(d.runs)} run trong khoảng</div></div>
      </section>
      <section class="panel"><h2>Run được dùng</h2><p>${d.head ? `Bản này: <a href="${escapeHtml(runHref(d.head.runId))}">${escapeHtml(d.head.runId.slice(-8))}</a> ${statusBadge(d.head.status)} ${d.atTag ? '(đúng commit của tag)' : '(commit gần nhất trong khoảng)'}` : 'Chưa có run nào trong khoảng commit này.'}
        ${d.base ? ` · Bản trước: <a href="${escapeHtml(runHref(d.base.runId))}">${escapeHtml(d.base.runId.slice(-8))}</a> ${statusBadge(d.base.status)}${d.head ? ` · <a href="${escapeHtml(compareHref(d.base.runId, d.head.runId))}">so sánh chi tiết</a>` : ''}` : ''}</p></section>
      ${rows ? `<section class="panel"><h2>Thay đổi so với ${escapeHtml(d.from.name)}</h2><table class="table compact"><thead><tr><th></th><th>Test</th><th>${escapeHtml(d.from.name)}</th><th>${escapeHtml(d.to.name)}</th></tr></thead><tbody>${rows}</tbody></table></section>` : ''}
      ${d.flaky.length ? `<section class="panel"><h2>Test flaky trong bản này</h2><ul>${d.flaky.map((f) => `<li><a href="${escapeHtml(testHref(f.key))}">${escapeHtml(f.title)}</a> <span class="muted small">[${escapeHtml(f.target)}] điểm ${Math.round(f.score * 100)}</span></li>`).join('')}</ul></section>` : ''}
      <p class="muted small">Tạo lúc ${escapeHtml(new Date().toLocaleString('vi-VN'))} · e2e-dashboard</p></div>`;
  }
  main.querySelector('[data-print]')?.addEventListener('click', () => window.print());
  main.querySelector('[data-ai-release]')?.addEventListener('click', () => openAiPanel({ action: 'release-notes', runId: null, title: `Ghi chú QA · ${d.to?.name ?? ''}`, extra: { from: d.from?.name ?? '', to: d.to?.name ?? '' } }));
  main.querySelectorAll('[data-rel]').forEach((s) => s.addEventListener('change', () => {
    releaseSel = { ...releaseSel, [s.dataset.rel]: s.value };
    renderRelease(main);
  }));
}
