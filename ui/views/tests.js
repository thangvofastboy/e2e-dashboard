import { getJson, isExport } from '../api.js';
import { selectionToRun } from '../model.js';
import { openRunDialog } from './run-dialog.js';
import { icon } from '../icons.js';
import { fmtDuration, escapeHtml, STATUS } from '../format.js';
import { runHref, testHref, replaceParams } from '../router.js';
import { toast } from '../toast.js';

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
  return `<tr><td>${isExport() ? '' : `<input type="checkbox" class="sel" data-pick="${escapeHtml(t.key)}" ${picked.has(t.key) ? 'checked' : ''} aria-label="Chọn ${escapeHtml(t.title)}"> `}${isExport() ? escapeHtml(t.title) : `<a href="${testHref(t.key)}">${escapeHtml(t.title)}</a>`} <span class="muted">:${escapeHtml(t.line ?? '?')}</span>${lockedKeys.has(t.key) ? ` <span class="lock-badge">${icon('lock', { size: 11 })}cách ly</span>` : ''}${t.tags.map((g) => ` <span class="tag">${escapeHtml(g)}</span>`).join('')}</td>
    <td>${escapeHtml(t.target)}${t.agent !== 'default' ? ` · ${escapeHtml(t.agent)}` : ''}</td>
    <td>${historyCells(t.history)}</td><td class="num">${fmtDuration(t.avgDurationMs)}</td></tr>`;
}

let lockedKeys = new Set();

let impact = null; // { base, files, tests } once asked

function impactPanel() {
  if (!impact) return '';
  if (impact.error) return `<section class="panel"><p class="muted">${escapeHtml(impact.error)}</p></section>`;
  return `<section class="panel impact"><div class="section-head"><h2>${icon('crosshair', { size: 15 })} ${impact.tests.length} test bị ảnh hưởng bởi ${impact.files.length} file đã đổi (so với <code>${escapeHtml(impact.base)}</code>)</h2>
      ${impact.tests.length ? `<button type="button" class="primary" data-run-impact>${icon('play', { size: 14 })}Chạy ${impact.tests.length} test</button>` : ''}</div>
    ${impact.tests.length ? `<ul class="eg-tests">${impact.tests.map((t) => `<li><a href="${testHref(t.key)}">${escapeHtml(t.title)}</a> <span class="muted small">${escapeHtml(t.reasons.join(' · '))}</span></li>`).join('')}</ul>` : '<p class="muted">Không test nào khớp các file đã đổi (theo file test, route đã đi qua và tên test).</p>'}
    <details><summary class="muted small">File đã đổi</summary><ul class="mono-list">${impact.files.slice(0, 200).map((f) => `<li><code>${escapeHtml(f)}</code></li>`).join('')}</ul></details></section>`;
}

export async function renderTests(main, route = {}) {
  filter = { file: route.params?.file ?? filter.file, tag: route.params?.tag ?? filter.tag, target: route.params?.target ?? filter.target };
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
    main.innerHTML = `<h1>Tests</h1>${impactPanel()}
      <div class="filters">${isExport() ? '' : `<button type="button" class="primary" data-run-picked ${picked.size ? '' : 'disabled'}>${icon('play', { size: 14 })}Chạy ${picked.size} test</button>
        <a class="button" href="/api/export/tests.csv" download>${icon('download', { size: 14 })}CSV</a><span class="impact-form"><label>Test bị ảnh hưởng so với <input type="text" data-base value="${escapeHtml(impact?.base ?? 'main')}" size="10" aria-label="Nhánh gốc"></label><button type="button" data-impact>${icon('crosshair', { size: 14 })}Tìm</button></span>`}${sel('file', distinct(all.map((r) => r.file)), 'File')}${sel('tag', distinct(all.flatMap((r) => r.tags)), 'Tag')}${sel('target', distinct(all.map((r) => r.target)), 'Target')}</div>
      ${rows.length
        ? `<table class="table"><thead><tr><th>Test</th><th>Target</th><th>10 run gần nhất (cũ → mới)</th><th class="num">TB</th></tr></thead><tbody>${body}</tbody></table>`
        : '<div class="empty-state"><p>Chưa có test nào trong lịch sử.</p></div>'}`;
    main.querySelectorAll('[data-pick]').forEach((el) =>
      el.addEventListener('change', () => {
        if (el.checked) picked.add(el.dataset.pick);
        else picked.delete(el.dataset.pick);
        draw();
      }));
    main.querySelector('[data-impact]')?.addEventListener('click', async () => {
      const base = main.querySelector('[data-base]').value.trim() || 'main';
      try {
        impact = await getJson(`/api/impact?base=${encodeURIComponent(base)}`);
      } catch (e) {
        toast(e.message, 'bad');
        return;
      }
      draw();
    });
    main.querySelector('[data-run-impact]')?.addEventListener('click', () => {
      const rows = impact.tests.map((t) => ({ ...t, id: t.key }));
      openRunDialog({ ...selectionToRun(rows, new Set(rows.map((r) => r.id))), allTargets: distinct(all.map((r) => r.target)), allAgents: distinct(all.map((r) => r.agent)), title: `Chạy ${rows.length} test bị ảnh hưởng` });
    });
    main.querySelector('[data-run-picked]')?.addEventListener('click', () => {
      const rows = all.map((t) => ({ ...t, id: t.key }));
      openRunDialog({ ...selectionToRun(rows, picked), allTargets: distinct(all.map((r) => r.target)), allAgents: distinct(all.map((r) => r.agent)), title: `Chạy ${picked.size} test` });
    });
    main.querySelectorAll('[data-f]').forEach((el) =>
      el.addEventListener('change', () => {
        filter = { ...filter, [el.dataset.f]: el.value };
        replaceParams(filter);
        draw();
      }));
  };
  draw();
}
