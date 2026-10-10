import { getJson } from '../api.js';
import { fmtDuration, escapeHtml, STATUS } from '../format.js';
import { runHref } from '../router.js';

let filter = { file: '', tag: '', target: '' };

export function historyCells(history, n = 10) {
  const cells = history.slice(0, n).reverse();
  while (cells.length < n) cells.unshift(null);
  return `<span class="history">${cells
    .map((h) => (h
      ? `<a class="cell s-${escapeHtml(h.status)}" href="${runHref(h.runId)}" data-tip="${escapeHtml(`${STATUS[h.status]?.label ?? h.status}`)}" aria-label="${escapeHtml(h.status)}"></a>`
      : '<span class="cell empty-cell"></span>'))
    .join('')}</span>`;
}

const distinct = (xs) => [...new Set(xs)].sort();

export function testRowHtml(t) {
  return `<tr><td>${escapeHtml(t.title)} <span class="muted">:${escapeHtml(t.line ?? '?')}</span>${t.tags.map((g) => ` <span class="tag">${escapeHtml(g)}</span>`).join('')}</td>
    <td>${escapeHtml(t.target)}${t.agent !== 'default' ? ` · ${escapeHtml(t.agent)}` : ''}</td>
    <td>${historyCells(t.history)}</td><td class="num">${fmtDuration(t.avgDurationMs)}</td></tr>`;
}

export async function renderTests(main) {
  const all = await getJson('/api/tests');
  const draw = () => {
    const rows = all.filter((r) => (!filter.file || r.file === filter.file) && (!filter.tag || r.tags.includes(filter.tag)) && (!filter.target || r.target === filter.target));
    const sel = (k, values, label) => `<label>${label} <select name="${k}" data-f="${k}"><option value="">Tất cả</option>${values
      .map((v) => `<option ${filter[k] === v ? 'selected' : ''}>${escapeHtml(v)}</option>`)
      .join('')}</select></label>`;
    const byFile = new Map();
    for (const r of rows) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
    const body = [...byFile]
      .map(([file, tests]) => `<tr class="group"><td colspan="4"><code>${escapeHtml(file)}</code></td></tr>${tests.map(testRowHtml).join('')}`)
      .join('');
    main.innerHTML = `<h1>Tests</h1>
      <div class="filters">${sel('file', distinct(all.map((r) => r.file)), 'File')}${sel('tag', distinct(all.flatMap((r) => r.tags)), 'Tag')}${sel('target', distinct(all.map((r) => r.target)), 'Target')}</div>
      ${rows.length
        ? `<table class="table"><thead><tr><th>Test</th><th>Target</th><th>10 run gần nhất (cũ → mới)</th><th class="num">TB</th></tr></thead><tbody>${body}</tbody></table>`
        : '<div class="empty-state"><p>Chưa có test nào trong lịch sử.</p></div>'}`;
    main.querySelectorAll('[data-f]').forEach((el) =>
      el.addEventListener('change', () => {
        filter = { ...filter, [el.dataset.f]: el.value };
        draw();
      }));
  };
  draw();
}
