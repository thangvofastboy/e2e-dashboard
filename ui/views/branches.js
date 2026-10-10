import { getJson } from '../api.js';
import { pageHead, emptyBox, meter, fmtPoints, toneFor } from '../analysis.js';
import { escapeHtml, fmtDuration, fmtTokens, fmtRelative, statusBadge } from '../format.js';
import { runHref, branchesHref, compareHref } from '../router.js';
import { icon } from '../icons.js';

export function branchRowHtml(b) {
  return `<tr><td>${icon('branch', { size: 13 })} <strong>${escapeHtml(b.branch)}</strong></td>
    <td class="num">${escapeHtml(b.runs)}</td>
    <td>${meter(b.passRate, toneFor(b.passRate))}</td>
    <td class="num">${fmtDuration(b.avgDurationMs)}</td>
    <td class="num">${fmtTokens(b.avgTokens)}</td>
    <td class="num">${escapeHtml(b.flaky)}</td>
    <td><a href="${runHref(b.latest.runId)}">${statusBadge(b.latest.status)}</a> <span class="muted small">${escapeHtml(fmtRelative(b.latest.startedAt))}</span></td></tr>`;
}

export async function renderBranches(main, route) {
  const { branches } = await getJson('/api/branches');
  const head = pageHead('So sánh branch', 'branch', 'Chỉ số 10 run gần nhất của mỗi branch; chọn hai branch để xem test nào chỉ hỏng ở một bên.');
  if (!branches.length) {
    main.innerHTML = `${head}${emptyBox('Chưa có run nào')}`;
    return;
  }
  const a = route.a ?? branches[1]?.branch ?? branches[0].branch;
  const b = route.b ?? branches[0].branch;
  const opt = (sel) => branches.map((x) => `<option ${x.branch === sel ? 'selected' : ''}>${escapeHtml(x.branch)}</option>`).join('');
  main.innerHTML = `${head}
    <table class="table"><thead><tr><th>Branch</th><th class="num">Run</th><th>Pass rate</th><th class="num">Thời gian TB</th><th class="num">Token TB</th><th class="num">Flaky</th><th>Run gần nhất</th></tr></thead><tbody>${branches.map(branchRowHtml).join('')}</tbody></table>
    <section class="panel"><div class="filters"><label>A <select data-br="a">${opt(a)}</select></label><label>B <select data-br="b">${opt(b)}</select></label></div><div data-br-out><p class="muted">Đang so…</p></div></section>`;
  main.querySelectorAll('[data-br]').forEach((s) =>
    s.addEventListener('change', () => (location.hash = branchesHref(main.querySelector('[data-br="a"]').value, main.querySelector('[data-br="b"]').value))));
  const out = main.querySelector('[data-br-out]');
  if (a === b) {
    out.innerHTML = '<p class="muted">Chọn hai branch khác nhau.</p>';
    return;
  }
  const cmp = await getJson(`/api/branches/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
  const diff = cmp.rows.filter((r) => r.delta !== 0);
  const only = (side) => cmp.rows.filter((r) => !r[side === 'a' ? 'b' : 'a']).length;
  out.innerHTML = `<p>${cmp.latest ? `Run mới nhất: <a href="${compareHref(cmp.latest.base, cmp.latest.head)}">so sánh chi tiết ${icon('arrow', { size: 13 })}</a> · pass rate ${escapeHtml(fmtPoints(cmp.latest.deltas.passRate))}` : ''}
      ${only('a') ? ` · ${only('a')} test chỉ có ở ${escapeHtml(a)}` : ''}${only('b') ? ` · ${only('b')} test chỉ có ở ${escapeHtml(b)}` : ''}</p>
    ${diff.length ? `<table class="table"><thead><tr><th>Test</th><th>${escapeHtml(a)}</th><th>${escapeHtml(b)}</th><th class="num">Chênh</th></tr></thead><tbody>${diff
      .map((r) => `<tr><td>${escapeHtml(r.title)} <span class="muted small">${escapeHtml(r.target)}</span></td>
        <td>${r.a ? `${meter(r.a.passRate, toneFor(r.a.passRate))} <span class="muted small">${escapeHtml(r.a.runs)} run</span>` : '<span class="muted">—</span>'}</td>
        <td>${r.b ? `${meter(r.b.passRate, toneFor(r.b.passRate))} <span class="muted small">${escapeHtml(r.b.runs)} run</span>` : '<span class="muted">—</span>'}</td>
        <td class="num">${r.delta == null ? '—' : `<span class="tone-${r.delta < 0 ? 'bad' : 'good'} delta">${escapeHtml(fmtPoints(r.delta))}</span>`}</td></tr>`)
      .join('')}</tbody></table>` : '<p class="muted">Mọi test chung có cùng pass rate trên hai branch.</p>'}`;
}
