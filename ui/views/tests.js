import { getJson, isExport } from '../api.js';
import { selectionToRun, isFailed } from '../model.js';
import { openRunDialog } from './run-dialog.js';
import { icon } from '../icons.js';
import { fmtDuration, escapeHtml, STATUS, statusBadge } from '../format.js';
import { buildTree, treeTests, findNode } from '../test-tree.js';
import { runHref, testHref, replaceParams } from '../router.js';
import { toast } from '../toast.js';
import { postJson } from '../api.js';
import { openAiPanel } from './ai-panel.js';

let filter = { file: '', tag: '', target: '', failed: false };
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
  return `<tr><td class="wrap">${isExport() ? '' : `<input type="checkbox" class="sel" data-pick="${escapeHtml(t.key)}" ${picked.has(t.key) ? 'checked' : ''} aria-label="Chọn ${escapeHtml(t.title)}"> `}${isExport() ? escapeHtml(t.title) : `<a href="${testHref(t.key)}">${escapeHtml(t.title)}</a>`} <span class="muted">:${escapeHtml(t.line ?? '?')}</span>${lockedKeys.has(t.key) ? ` <span class="lock-badge">${icon('lock', { size: 11 })}cách ly</span>` : ''}${t.tags.map((g) => ` <span class="tag">${escapeHtml(g)}</span>`).join('')}</td>
    <td>${escapeHtml(t.target)}${t.agent !== 'default' ? ` · ${escapeHtml(t.agent)}` : ''}</td>
    <td>${historyCells(t.history)}</td><td class="num">${fmtDuration(t.avgDurationMs)}</td></tr>`;
}

let lockedKeys = new Set();

// trạng thái mở/đóng của thư mục và file trong cây, giữ qua các lần vẽ lại / tải lại (mặc định: thư mục mở, file đóng)
const openState = new Map();

// tóm tắt một file: pass rate trên lịch sử, thời gian TB, trạng thái run gần nhất (fail nếu có test fail)
export function fileSummary(tests) {
  const hist = tests.flatMap((t) => t.history ?? []).filter((h) => h.status !== 'skipped');
  const ok = hist.filter((h) => h.status === 'passed' || h.status === 'flaky').length;
  const durs = tests.map((t) => t.avgDurationMs).filter((x) => Number.isFinite(x));
  const latest = tests.map((t) => t.history?.[0]?.status).filter(Boolean);
  return {
    passRate: hist.length ? Math.round((ok / hist.length) * 100) : null,
    avgMs: durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : null,
    status: latest.find(isFailed) ?? latest.find((s) => s === 'flaky') ?? latest[0] ?? null,
  };
}

function nodeHtml(node) {
  const pick = (n) => (isExport() || n.path.endsWith('#') ? '' : `<input type="checkbox" class="sel" data-pick-dir="${escapeHtml(n.path)}" aria-label="Chọn mọi test trong ${escapeHtml(n.name)}"> `);
  const counts = (n) => `<span class="muted small">${n.count} test</span>${n.failCount ? ` <span class="chip tone-bad">${n.failCount} fail</span>` : ''}`;
  const dirs = node.children.filter((c) => c.children.length).map((c) => `<details class="tt-dir" data-path="${escapeHtml(c.path)}"${openState.get(c.path) ?? true ? ' open' : ''}>
      <summary>${pick(c)}${icon('folder', { size: 14 })}<strong>${escapeHtml(c.name)}</strong> ${counts(c)}</summary>${nodeHtml(c)}</details>`);
  // node lá có test là file; test không có file nằm ngay ở node gốc
  const files = [...node.children.filter((c) => !c.children.length), ...(node.tests.length ? [{ ...node, name: node.name || '(không rõ file)', path: `${node.path}#` }] : [])].map((c) => {
    const s = fileSummary(c.tests);
    return `<details class="tt-file" data-path="${escapeHtml(c.path)}"${openState.get(c.path) ? ' open' : ''}>
      <summary>${pick(c)}${icon('file', { size: 14 })}<code>${escapeHtml(c.name)}</code> ${counts(c)}
        <span class="muted small">· pass ${s.passRate ?? '—'}% · TB ${fmtDuration(s.avgMs)}</span>${s.status ? ` ${statusBadge(s.status)}` : ''}</summary>
      <table class="table"><thead><tr><th>Test</th><th>Target</th><th>10 run gần nhất (cũ → mới)</th><th class="num">TB</th></tr></thead><tbody>${c.tests.map(testRowHtml).join('')}</tbody></table></details>`;
  });
  return dirs.join('') + files.join('');
}

let impact = null; // { base, files, tests } once asked

function impactPanel() {
  if (!impact) return '';
  if (impact.error) return `<section class="panel"><p class="muted">${escapeHtml(impact.error)}</p></section>`;
  return `<section class="panel impact"><div class="section-head"><h2>${icon('crosshair', { size: 15 })} ${impact.tests.length} test bị ảnh hưởng bởi ${impact.files.length} file đã đổi (so với <code>${escapeHtml(impact.base)}</code>)</h2>
      <span class="row-actions">${impact.tests.length ? `<button type="button" class="primary" data-run-impact>${icon('play', { size: 14 })}Chạy ${impact.tests.length} test</button>` : ''}
      <button type="button" class="btn-ai" data-ai-select title="AI đọc thay đổi và chọn test cần chạy (ít mà đủ)">${icon('sparkles', { size: 14 })}AI chọn test</button></span></div>
    ${impact.tests.length ? `<ul class="eg-tests">${impact.tests.map((t) => `<li><a href="${testHref(t.key)}">${escapeHtml(t.title)}</a> <span class="muted small">${escapeHtml(t.reasons.join(' · '))}</span></li>`).join('')}</ul>` : '<p class="muted">Không test nào khớp các file đã đổi (theo file test, route đã đi qua và tên test).</p>'}
    <details><summary class="muted small">File đã đổi</summary><ul class="mono-list">${impact.files.slice(0, 200).map((f) => `<li><code>${escapeHtml(f)}</code></li>`).join('')}</ul></details></section>`;
}

export async function renderTests(main, route = {}) {
  filter = { file: route.params?.file ?? filter.file, tag: route.params?.tag ?? filter.tag, target: route.params?.target ?? filter.target, failed: route.params ? route.params.failed === '1' : filter.failed };
  const load = () => Promise.all([getJson('/api/tests'), isExport() ? { list: [] } : getJson('/api/quarantine').catch(() => ({ list: [] }))]);
  let [all, q] = await load();
  lockedKeys = new Set(q.list.map((x) => x.key));
  const draw = () => {
    // "Chỉ test fail": test fail ở run gần nhất có nó
    const failing = (r) => isFailed(r.history?.[0]?.status);
    const nFail = all.filter(failing).length;
    const rows = all.filter((r) => (!filter.file || r.file === filter.file) && (!filter.tag || r.tags.includes(filter.tag)) && (!filter.target || r.target === filter.target) && (!filter.failed || failing(r)));
    const sel = (k, values, label) => `<label>${label} <select name="${k}" data-f="${k}"><option value="">Tất cả</option>${values
      .map((v) => `<option ${filter[k] === v ? 'selected' : ''}>${escapeHtml(v)}</option>`)
      .join('')}</select></label>`;
    const tree = buildTree(rows);
    main.innerHTML = `<h1>Tests</h1>${impactPanel()}
      <div class="filters">${isExport() ? '' : `<button type="button" class="primary" data-run-picked ${picked.size ? '' : 'disabled'}>${icon('play', { size: 14 })}Chạy ${picked.size} test</button>
        <button type="button" data-reload title="Tải lại danh sách test, giữ lựa chọn">${icon('rerun', { size: 14 })}Tải lại</button>
        <button type="button" class="btn-ai" data-ai-ticket title="Dán ticket (Jira / Linear…), AI viết nháp file .e2e.ts theo quy ước của project">${icon('sparkles', { size: 14 })}Viết test từ ticket</button>
        <button type="button" class="btn-ai" data-ai-dupes title="Tìm test đi cùng luồng / kiểm tra cùng điều, đề xuất gộp">${icon('sparkles', { size: 14 })}AI tìm test trùng</button>
        <a class="button" href="/api/export/tests.csv" download>${icon('download', { size: 14 })}CSV</a><span class="impact-form"><label>Test bị ảnh hưởng so với <input type="text" data-base value="${escapeHtml(impact?.base ?? 'main')}" size="10" aria-label="Nhánh gốc"></label><button type="button" data-impact>${icon('crosshair', { size: 14 })}Tìm</button></span>`}<button type="button" class="only-failed" data-only-failed aria-pressed="${filter.failed}"${nFail || filter.failed ? '' : ' disabled'}>${icon('x', { size: 14 })}Chỉ test fail <strong>${nFail}</strong></button>${sel('file', distinct(all.map((r) => r.file)), 'File')}${sel('tag', distinct(all.flatMap((r) => r.tags)), 'Tag')}${sel('target', distinct(all.map((r) => r.target)), 'Target')}</div>
      ${rows.length
        ? `<div class="tt">${nodeHtml(tree)}</div>`
        : '<div class="empty-state"><p>Chưa có test nào trong lịch sử.</p></div>'}`;
    main.querySelectorAll('details[data-path]').forEach((el) => el.addEventListener('toggle', () => openState.set(el.dataset.path, el.open)));
    main.querySelectorAll('[data-pick-dir]').forEach((el) => {
      const keys = treeTests(findNode(tree, el.dataset.pickDir)).map((t) => t.key);
      const n = keys.filter((k) => picked.has(k)).length;
      el.checked = n > 0 && n === keys.length;
      el.indeterminate = n > 0 && n < keys.length;
      el.addEventListener('change', () => {
        for (const k of keys) el.checked ? picked.add(k) : picked.delete(k);
        draw();
      });
    });
    main.querySelector('[data-reload]')?.addEventListener('click', async (e) => {
      e.currentTarget.setAttribute('aria-busy', 'true');
      try {
        [all, q] = await load();
        lockedKeys = new Set(q.list.map((x) => x.key));
      } catch (x) {
        toast(x.message, 'bad');
      }
      draw();
    });
    main.querySelector('[data-only-failed]')?.addEventListener('click', () => {
      filter.failed = !filter.failed;
      replaceParams({ file: filter.file || undefined, tag: filter.tag || undefined, target: filter.target || undefined, failed: filter.failed ? '1' : undefined });
      draw();
    });
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
    const runKeys = (keys, title) => {
      const rows = all.map((t) => ({ ...t, id: t.key }));
      openRunDialog({ ...selectionToRun(rows, new Set(keys)), allTargets: distinct(all.map((r) => r.target)), allAgents: distinct(all.map((r) => r.agent)), title });
    };
    main.querySelector('[data-ai-dupes]')?.addEventListener('click', () => openAiPanel({ action: 'duplicate-tests', runId: null, title: 'Test trùng / thừa' }));
    main.querySelector('[data-ai-select]')?.addEventListener('click', () =>
      openAiPanel({
        action: 'select-tests', runId: null, title: `AI chọn test · so với ${impact?.base ?? 'main'}`, extra: { base: impact?.base ?? 'main' },
        onDone: (text, box) => {
          const picks = parseSelection(text, all);
          if (!picks.length) return;
          box.innerHTML = `<button type="button" class="primary" data-run-ai>${icon('play', { size: 14 })}Chạy ${picks.length} test AI chọn</button>`;
          box.querySelector('[data-run-ai]').addEventListener('click', () => runKeys(picks.map((x) => x.key), `Chạy ${picks.length} test AI chọn`));
        },
      }));
    main.querySelector('[data-ai-ticket]')?.addEventListener('click', () => openTicketDialog());
    main.querySelector('[data-run-picked]')?.addEventListener('click', () => {
      const rows = all.map((t) => ({ ...t, id: t.key }));
      openRunDialog({ ...selectionToRun(rows, picked), allTargets: distinct(all.map((r) => r.target)), allAgents: distinct(all.map((r) => r.agent)), title: `Chạy ${picked.size} test` });
    });
    main.querySelectorAll('[data-f]').forEach((el) =>
      el.addEventListener('change', () => {
        filter = { ...filter, [el.dataset.f]: el.value };
        replaceParams({ ...filter, failed: filter.failed ? '1' : undefined });
        draw();
      }));
  };
  draw();
}

// dòng JSON cuối trong câu trả lời "AI chọn test": chỉ giữ key có thật
export function parseSelection(text, tests) {
  const keys = new Set(tests.map((t) => t.key));
  for (const l of String(text ?? '').trim().split('\n').reverse()) {
    const m = l.match(/\[.*\]/);
    if (!m) continue;
    try {
      const arr = JSON.parse(m[0]);
      if (Array.isArray(arr)) return arr.filter((x) => x && keys.has(x.key));
    } catch {
      // dòng trước
    }
  }
  return [];
}

// file .e2e.ts AI viết: khối ```ts cuối cùng và dòng "PATH: …"
export function parseDraft(text) {
  const blocks = [...String(text ?? '').matchAll(/```(?:ts|typescript|js)?\n([\s\S]*?)```/g)];
  const path = /^PATH:\s*`?([^`\s]+\.e2e\.ts)`?\s*$/m.exec(String(text ?? ''))?.[1] ?? '';
  return { code: blocks.at(-1)?.[1] ?? '', path };
}

let lastTicket = { ticket: '', folder: '' }; // giữ nội dung đã dán: AI lỗi hay lỡ đóng thì mở lại vẫn còn

function openTicketDialog() {
  document.getElementById('ticket-dialog')?.remove();
  const dlg = document.createElement('dialog');
  dlg.id = 'ticket-dialog';
  dlg.innerHTML = `<form method="dialog" class="ticket-form">
    <h2>${icon('sparkles', { size: 16 })} Viết test từ ticket</h2>
    <p class="muted small">Dán tiêu đề, mô tả và tiêu chí chấp nhận của ticket. AI đọc test sẵn có để viết đúng quy ước, chỗ ticket không rõ để <code>// TODO</code>.</p>
    <label class="small">Nội dung ticket<textarea name="ticket" rows="12" required minlength="10" maxlength="8000" placeholder="D1-1234 Tạo order cho khách mới…"></textarea></label>
    <label class="small">Thư mục đích (tuỳ chọn)<input name="folder" placeholder="TestCases/05_Billing/Orders" autocomplete="off"></label>
    <div class="row-actions"><button type="submit" class="btn-ai" value="go">${icon('sparkles', { size: 14 })}Viết test</button><button type="button" data-cancel>${icon('close', { size: 14 })}Huỷ</button></div>
  </form>`;
  document.body.append(dlg);
  dlg.querySelector('[name=ticket]').value = lastTicket.ticket;
  dlg.querySelector('[name=folder]').value = lastTicket.folder;
  dlg.querySelector('[data-cancel]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  dlg.querySelector('form').addEventListener('submit', (e) => {
    const f = e.target;
    const ticket = f.ticket.value.trim();
    const folder = f.folder.value.trim();
    lastTicket = { ticket, folder };
    openAiPanel({
      action: 'ticket-test', runId: null, title: 'Test từ ticket', extra: { ticket, folder },
      onDone: (text, box) => {
        const d = parseDraft(text);
        if (!d.code) return;
        box.innerHTML = `<form class="draft-save"><input name="path" value="${escapeHtml(d.path || `${folder || 'tests'}/new-test.e2e.ts`)}" aria-label="Đường dẫn file" required>
          <button type="submit">${icon('check', { size: 14 })}Lưu thành file</button></form>`;
        box.querySelector('form').addEventListener('submit', async (ev) => {
          ev.preventDefault();
          try {
            const r = await postJson('/api/tests/draft', { path: ev.target.path.value.trim(), content: d.code });
            toast(`Đã lưu ${r.saved}`);
          } catch (x) {
            toast(x.message.replace(/^\d{3}: /, ''), 'bad');
          }
        });
      },
    });
  });
  dlg.showModal();
}
