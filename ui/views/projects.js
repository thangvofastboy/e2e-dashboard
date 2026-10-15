import { toast } from '../toast.js';
import { confirmDialog } from '../confirm.js';
import { getJson, postJson } from '../api.js';
import { pageHead, emptyBox, fmtPct, toneFor, copyToClipboard } from '../analysis.js';
import { escapeHtml, fmtRelative, statusBadge, countChips } from '../format.js';
import { icon } from '../icons.js';
import { contextFieldsHtml, readContextFields, bindContextFields, memoryHtml, pollMemory, relearn } from '../project-context.js';

const HEALTH_ICON = { good: 'check', warn: 'alert', bad: 'x' };
const AI_STATE = { ready: 'đã ghi nhớ', stale: 'cần đọc lại', learning: 'đang đọc dự án…', none: 'chưa ghi nhớ', error: 'lỗi khi đọc' };

export function projectCardHtml(p) {
  const h = p.health;
  const open = p.current
    ? '<span class="chip tone-info">Đang xem</span>'
    : p.url
      ? `<a class="button" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${icon('external', { size: 14 })}Mở dashboard</a>`
      : `<button type="button" data-copy-cmd="${escapeHtml(`cd '${p.root.replace(/'/g, "'\\''")}' && claude /e2e-dashboard`)}">${icon('copy', { size: 14 })}Lệnh mở</button>`;
  return `<article class="panel project${p.current ? ' current' : ''}">
    <header><h2>${icon('folder', { size: 16 })} ${escapeHtml(p.name)}</h2>${h ? `<span class="chip tone-${h.health}" title="Health score">${icon(HEALTH_ICON[h.health], { size: 12 })}${escapeHtml(h.score)}/100</span>` : ''}</header>
    <div class="muted small"><code>${escapeHtml(p.root)}</code>${p.exists ? '' : ' · <span class="tone-bad">thư mục không còn</span>'}</div>
    ${p.latest ? `<div class="project-latest">${statusBadge(p.latest.status)} ${countChips(p.latest.summary)} <span class="muted small">${escapeHtml(fmtRelative(p.latest.startedAt))}${p.latest.branch ? ` · ${escapeHtml(p.latest.branch)}` : ''}</span></div>
      <div class="small">Pass rate run gần nhất: <span class="tone-${toneFor(p.passRate)} delta">${fmtPct(p.passRate)}</span> · ${escapeHtml(p.runs)} run đã lưu</div>` : '<p class="muted">Chưa có run nào.</p>'}
    ${p.ai ? `<div class="small muted project-ai">${icon('sparkles', { size: 12 })} AI: ${escapeHtml(AI_STATE[p.ai.state] ?? p.ai.state)} · test: <code>${escapeHtml(p.ai.testDir || '?')}</code> · ${escapeHtml(p.ai.sources)} thư mục khác</div>` : ''}
    <footer>${open}<button type="button" class="icon-btn" data-edit="${escapeHtml(p.root)}" data-name="${escapeHtml(p.name)}"${p.current ? ' data-current' : ''} aria-label="Sửa project" title="Sửa project">${icon('edit', { size: 14 })}</button>${p.current ? '' : `<button type="button" class="icon-btn" data-forget="${escapeHtml(p.root)}" aria-label="Bỏ khỏi danh sách" title="Bỏ khỏi danh sách">${icon('close', { size: 14 })}</button>`}</footer>
  </article>`;
}

export async function renderProjects(main) {
  const { projects } = await getJson('/api/projects');
  const add = `<button type="button" class="primary" data-add-project>${icon('plus', { size: 14 })}Thêm project</button>`;
  const head = pageHead('Projects', 'folder', 'Mọi project đã mở dashboard trên máy này (lưu ở <code>~/.e2e-dashboard/projects.json</code>). Project đang chạy server có nút mở thẳng.', add);
  main.innerHTML = projects.length ? `${head}<section class="projects">${projects.map(projectCardHtml).join('')}</section>` : `${head}${emptyBox('Chưa có project nào')}`;
  main.querySelector('[data-add-project]').addEventListener('click', async () => {
    const root = (await pickFolder())?.path;
    if (!root) return;
    const r = await postJson('/api/projects/add', { root }).catch((x) => toast(x.message, 'bad'));
    if (!r) return;
    if (!r.added) return toast(`Project đã có trong danh sách: ${r.root}`, 'warn', 5000);
    toast(`Đã thêm project: ${r.root}`);
    // bước tiếp (tuỳ chọn): thư mục test + thư mục khác cho AI
    await projectDialog({ root: r.root, name: r.root.split(/[\\/]/).filter(Boolean).pop(), isNew: true });
    renderProjects(main);
  });
  main.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (await projectDialog({ root: b.dataset.edit, name: b.dataset.name, current: 'current' in b.dataset })) renderProjects(main);
    }));
  main.querySelectorAll('[data-copy-cmd]').forEach((b) => b.addEventListener('click', () => copyToClipboard(b.dataset.copyCmd, b)));
  main.querySelectorAll('[data-forget]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Gỡ project khỏi danh sách', message: 'Gỡ project này khỏi dashboard? Dữ liệu trong project không bị xoá, mở lại dashboard ở đó sẽ thêm vào danh sách.', confirmLabel: 'Gỡ project' }))) return;
      const ok = await postJson('/api/projects/forget', { root: b.dataset.forget }).then(() => true, (x) => toast(x.message, 'bad'));
      if (!ok) return;
      renderProjects(main);
    }));
  // project mà AI đang đọc: vẽ lại thẻ khi đọc xong (trả hàm dừng cho router khi rời trang)
  const learning = projects.find((x) => x.ai?.state === 'learning');
  if (learning) return pollMemory(learning.root, (m) => m.state !== 'learning' && renderProjects(main), 4000);
}

// Hộp chọn thư mục: duyệt cây thư mục phía server (trình duyệt không trả đường dẫn tuyệt đối), hoặc gõ thẳng đường dẫn.
// Trả về { path, name } (name khi mở để sửa), hoặc null khi Huỷ. lockPath: chỉ sửa tên (project đang mở).
// Hộp Thêm / Sửa project: tên, thư mục project, thư mục chứa test, các thư mục khác (tuỳ chọn) kèm mô tả, và trạng thái
// AI ghi nhớ. Lưu → AI đọc lại các thư mục để ghi nhớ hệ thống (chạy nền). Trả true khi đã lưu.
async function projectDialog({ root, name, current = false, isNew = false }) {
  const ctx = await getJson(`/api/project-context?root=${encodeURIComponent(root)}`).catch((x) => toast(x.message, 'bad'));
  if (!ctx) return false;
  document.getElementById('project-dialog')?.remove();
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.id = 'project-dialog';
    dlg.className = 'modal project-dialog';
    dlg.setAttribute('aria-labelledby', 'project-dialog-title');
    dlg.innerHTML = `<form class="run-form confirm-form" data-project-form>
      <header><h2 id="project-dialog-title">${icon('folder', { size: 18 })}<span>${isNew ? 'Thiết lập project mới' : 'Sửa project'}</span></h2>
        <button type="button" class="icon-btn" data-cancel aria-label="Đóng">${icon('close')}</button></header>
      ${isNew ? '<p class="muted small">Tuỳ chọn: cho dashboard biết thư mục test và các thư mục khác của hệ thống để AI đọc, hiểu và ghi nhớ.</p>' : ''}
      <label class="fb-field"><span>Tên hiển thị</span><input name="name" maxlength="80" required value="${escapeHtml(name ?? '')}"></label>
      <label class="fb-field"><span>Thư mục project${current ? ' <span class="muted small">(project đang mở, không đổi được)</span>' : ''}</span>
        <span class="ctx-path"><input name="root" value="${escapeHtml(root)}" autocomplete="off" spellcheck="false"${current || isNew ? ' readonly' : ''}>${current || isNew ? '' : `<button type="button" class="small-btn" data-pick-root>${icon('folder', { size: 13 })}Chọn…</button>`}</span></label>
      ${contextFieldsHtml(ctx)}
      <div data-mem>${memoryHtml(ctx.memory)}</div>
      <p class="err small tone-bad" data-err hidden></p>
      <footer><button type="button" data-cancel>${isNew ? 'Để sau' : 'Huỷ'}</button><button type="submit" class="primary">${icon('check', { size: 14 })}Lưu</button></footer></form>`;
    document.body.append(dlg);
    const f = dlg.querySelector('form');
    const err = dlg.querySelector('[data-err]');
    let saved = false;
    let stopPoll = () => {};
    const showMem = (m) => (dlg.querySelector('[data-mem]').innerHTML = memoryHtml(m));
    const watch = () => {
      stopPoll();
      stopPoll = pollMemory(f.root.value.trim(), showMem);
    };
    const pick = (start) => pickFolder({ title: 'Chọn thư mục', start }).then((v) => v?.path ?? null);
    bindContextFields(f, root, pick);
    dlg.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => dlg.close()));
    dlg.querySelector('[data-pick-root]')?.addEventListener('click', async () => {
      const got = await pick(f.root.value.trim());
      if (got) f.root.value = got;
    });
    dlg.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-ctx-relearn]');
      if (!b) return;
      b.disabled = true;
      const m = await relearn(f.root.value.trim()).catch((x) => toast(x.message, 'bad'));
      if (m) {
        showMem(m);
        watch();
      }
    });
    if (ctx.memory.state === 'learning') watch();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = readContextFields(root, f);
      err.hidden = !v.error;
      err.textContent = v.error ?? '';
      if (v.error) return;
      const newRoot = f.root.value.trim();
      try {
        // đổi tên / chuyển thư mục trước: bối cảnh lưu trong thư mục project (mới)
        if (!isNew || f.name.value.trim() !== name) await postJson('/api/projects/update', { root, name: f.name.value.trim(), ...(current || isNew ? {} : { newRoot }) });
        const r = await postJson('/api/project-context', { root: current || isNew ? root : newRoot, testDir: v.testDir, sources: v.sources });
        saved = true;
        showMem(r.memory);
        toast(r.memory.state === 'learning' ? 'Đã lưu. AI đang đọc dự án để ghi nhớ (chạy nền, xem tiến độ ở thẻ project)' : 'Đã lưu project');
        dlg.close();
      } catch (x) {
        err.hidden = false;
        err.textContent = x.message.replace(/^\d{3}: /, '');
      }
    });
    dlg.addEventListener('close', () => {
      stopPoll();
      dlg.remove();
      resolve(saved);
    });
    dlg.showModal();
    f.querySelector(isNew ? '[name=ctxTestDir]' : '[name=name]').focus();
  });
}

function pickFolder({ title = 'Chọn thư mục project', start = '', name = null, lockPath = false, okLabel = 'Chọn thư mục này' } = {}) {
  document.getElementById('folder-dialog')?.remove();
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.id = 'folder-dialog';
    dlg.className = 'confirm-dialog folder-dialog';
    dlg.setAttribute('aria-labelledby', 'folder-title');
    dlg.innerHTML = `<form method="dialog" class="run-form confirm-form">
      <header><h2 id="folder-title">${icon('folder', { size: 18 })}<span>${escapeHtml(title)}</span></h2></header>
      ${name === null ? '' : `<label class="fb-field"><span>Tên hiển thị</span><input data-name maxlength="80" required value="${escapeHtml(name)}"></label>`}
      <label class="fb-field"><span>Đường dẫn${lockPath ? ' (project đang mở, không đổi được)' : ''}</span><input data-path autocomplete="off" spellcheck="false"${lockPath ? ' readonly' : ''}></label>
      <ul class="folder-list" data-list role="listbox" aria-label="Thư mục con"${lockPath ? ' hidden' : ''}></ul>
      <p class="muted small" data-err hidden></p>
      <footer><button type="submit" value="cancel" formnovalidate>Huỷ</button><button type="submit" value="ok" class="primary">${escapeHtml(okLabel)}</button></footer></form>`;
    const input = dlg.querySelector('[data-path]');
    const list = dlg.querySelector('[data-list]');
    const err = dlg.querySelector('[data-err]');
    const go = async (path) => {
      const r = await getJson(`/api/fs/dirs${path ? `?path=${encodeURIComponent(path)}` : ''}`).catch((x) => ({ error: x.message }));
      err.hidden = !r.error;
      err.textContent = r.error ?? '';
      if (r.error) return;
      input.value = r.path;
      const item = (label, target, ic) => `<li><button type="button" class="folder-item" data-go="${escapeHtml(target)}">${icon(ic, { size: 14 })}${escapeHtml(label)}</button></li>`;
      const sep = r.path.endsWith('/') ? '' : '/';
      list.innerHTML = (r.parent ? item('.. (thư mục cha)', r.parent, 'folder') : '') + (r.dirs.length ? r.dirs.map((d) => item(d, r.path + sep + d, 'folder')).join('') : '<li class="muted small">Không có thư mục con</li>');
      list.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
    };
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault(); // Enter trong ô đường dẫn = mở thư mục đó, không chọn luôn
      go(input.value.trim());
    });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close('cancel'); });
    dlg.addEventListener('close', () => {
      const path = dlg.returnValue === 'ok' ? input.value.trim() : '';
      const nm = dlg.querySelector('[data-name]')?.value.trim();
      dlg.remove();
      resolve(path ? { path, ...(name === null ? {} : { name: nm }) } : null);
    });
    document.body.append(dlg);
    dlg.showModal();
    input.value = start; // thư mục cũ không còn thì vẫn thấy đường dẫn để sửa
    if (!lockPath) go(start);
  });
}
