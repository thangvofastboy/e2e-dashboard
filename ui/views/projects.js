import { toast } from '../toast.js';
import { confirmDialog } from '../confirm.js';
import { getJson, postJson } from '../api.js';
import { pageHead, emptyBox, fmtPct, toneFor, copyToClipboard } from '../analysis.js';
import { escapeHtml, fmtRelative, statusBadge, countChips } from '../format.js';
import { icon } from '../icons.js';

const HEALTH_ICON = { good: 'check', warn: 'alert', bad: 'x' };

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
    <footer>${open}${p.current ? '' : `<button type="button" class="icon-btn" data-forget="${escapeHtml(p.root)}" aria-label="Bỏ khỏi danh sách" title="Bỏ khỏi danh sách">${icon('close', { size: 14 })}</button>`}</footer>
  </article>`;
}

export async function renderProjects(main) {
  const { projects } = await getJson('/api/projects');
  const add = `<button type="button" class="primary" data-add-project>${icon('plus', { size: 14 })}Thêm project</button>`;
  const head = pageHead('Projects', 'folder', 'Mọi project đã mở dashboard trên máy này (lưu ở <code>~/.e2e-dashboard/projects.json</code>). Project đang chạy server có nút mở thẳng.', add);
  main.innerHTML = projects.length ? `${head}<section class="projects">${projects.map(projectCardHtml).join('')}</section>` : `${head}${emptyBox('Chưa có project nào')}`;
  main.querySelector('[data-add-project]').addEventListener('click', async () => {
    const root = await pickFolder();
    if (!root) return;
    const r = await postJson('/api/projects/add', { root }).catch((x) => toast(x.message, 'bad'));
    if (!r) return;
    if (!r.added) return toast(`Project đã có trong danh sách: ${r.root}`, 'warn', 5000);
    toast(`Đã thêm project: ${r.root}`);
    renderProjects(main);
  });
  main.querySelectorAll('[data-copy-cmd]').forEach((b) => b.addEventListener('click', () => copyToClipboard(b.dataset.copyCmd, b)));
  main.querySelectorAll('[data-forget]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Gỡ project khỏi danh sách', message: 'Gỡ project này khỏi dashboard? Dữ liệu trong project không bị xoá, mở lại dashboard ở đó sẽ thêm vào danh sách.', confirmLabel: 'Gỡ project' }))) return;
      const ok = await postJson('/api/projects/forget', { root: b.dataset.forget }).then(() => true, (x) => toast(x.message, 'bad'));
      if (!ok) return;
      renderProjects(main);
    }));
}

// Hộp chọn thư mục: duyệt cây thư mục phía server (trình duyệt không trả đường dẫn tuyệt đối), hoặc gõ thẳng đường dẫn.
// Trả về đường dẫn đã chọn, hoặc null khi Huỷ.
function pickFolder() {
  document.getElementById('folder-dialog')?.remove();
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.id = 'folder-dialog';
    dlg.className = 'confirm-dialog folder-dialog';
    dlg.setAttribute('aria-labelledby', 'folder-title');
    dlg.innerHTML = `<form method="dialog" class="run-form confirm-form">
      <header><h2 id="folder-title">${icon('folder', { size: 18 })}<span>Chọn thư mục project</span></h2></header>
      <label class="fb-field"><span>Đường dẫn</span><input data-path autocomplete="off" spellcheck="false"></label>
      <ul class="folder-list" data-list role="listbox" aria-label="Thư mục con"></ul>
      <p class="muted small" data-err hidden></p>
      <footer><button type="submit" value="cancel">Huỷ</button><button type="submit" value="ok" class="primary">Chọn thư mục này</button></footer></form>`;
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
      dlg.remove();
      resolve(path || null);
    });
    document.body.append(dlg);
    dlg.showModal();
    go('');
  });
}
