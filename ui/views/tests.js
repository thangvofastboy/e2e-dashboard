import { getJson, isExport } from '../api.js';
import { selectionToRun } from '../model.js';
import { openRunDialog } from './run-dialog.js';
import { icon } from '../icons.js';
import { fmtDuration, escapeHtml, STATUS } from '../format.js';
import { runHref } from '../router.js';

let filter = { file: '', tag: '', target: '' };
const picked = new Set(); // TestRow keys chosen to run

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
  return `<tr><td>${isExport() ? '' : `<input type="checkbox" class="sel" data-pick="${escapeHtml(t.key)}" ${picked.has(t.key) ? 'checked' : ''} aria-label="Chọn ${escapeHtml(t.title)}"> `}${escapeHtml(t.title)} <span class="muted">:${escapeHtml(t.line ?? '?')}</span>${lockedKeys.has(t.key) ? ` <span class="lock-badge">${icon('lock', { size: 11 })}cách ly</span>` : ''}${t.tags.map((g) => ` <span class="tag">${escapeHtml(g)}</span>`).join('')}</td>
    <td>${escapeHtml(t.target)}${t.agent !== 'default' ? ` · ${escapeHtml(t.agent)}` : ''}</td>
    <td>${historyCells(t.history)}</td><td class="num">${fmtDuration(t.avgDurationMs)}</td></tr>`;
}

let lockedKeys = new Set();

export async function renderTests(main) {
  const [all, q] = await Promise.all([getJson('/api/tests'), isExport() ? { list: [] } : getJson('/api/quarantine').catch(() => ({ list: [] }))]);
  lockedKeys = new Set(q.list.map((x) => x.key));
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
      <div class="filters">${isExport() ? '' : `<button type="button" class="primary" data-run-picked ${picked.size ? '' : 'disabled'}>${icon('play', { size: 14 })}Chạy ${picked.size} test</button>`}${sel('file', distinct(all.map((r) => r.file)), 'File')}${sel('tag', distinct(all.flatMap((r) => r.tags)), 'Tag')}${sel('target', distinct(all.map((r) => r.target)), 'Target')}</div>
      ${rows.length
        ? `<table class="table"><thead><tr><th>Test</th><th>Target</th><th>10 run gần nhất (cũ → mới)</th><th class="num">TB</th></tr></thead><tbody>${body}</tbody></table>`
        : '<div class="empty-state"><p>Chưa có test nào trong lịch sử.</p></div>'}`;
    main.querySelectorAll('[data-pick]').forEach((el) =>
      el.addEventListener('change', () => {
        if (el.checked) picked.add(el.dataset.pick);
        else picked.delete(el.dataset.pick);
        draw();
      }));
    main.querySelector('[data-run-picked]')?.addEventListener('click', () => {
      const rows = all.map((t) => ({ ...t, id: t.key }));
      openRunDialog({ ...selectionToRun(rows, picked), allTargets: distinct(all.map((r) => r.target)), allAgents: distinct(all.map((r) => r.agent)), title: `Chạy ${picked.size} test` });
    });
    main.querySelectorAll('[data-f]').forEach((el) =>
      el.addEventListener('change', () => {
        filter = { ...filter, [el.dataset.f]: el.value };
        draw();
      }));
  };
  draw();
}
