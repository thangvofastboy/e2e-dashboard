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
  const head = pageHead('Projects', 'folder', 'Mọi project đã mở dashboard trên máy này (lưu ở <code>~/.e2e-dashboard/projects.json</code>). Project đang chạy server có nút mở thẳng.');
  main.innerHTML = projects.length ? `${head}<section class="projects">${projects.map(projectCardHtml).join('')}</section>` : `${head}${emptyBox('Chưa có project nào')}`;
  main.querySelectorAll('[data-copy-cmd]').forEach((b) => b.addEventListener('click', () => copyToClipboard(b.dataset.copyCmd, b)));
  main.querySelectorAll('[data-forget]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Gỡ project khỏi danh sách', message: 'Gỡ project này khỏi dashboard? Dữ liệu trong project không bị xoá, mở lại dashboard ở đó sẽ thêm vào danh sách.', confirmLabel: 'Gỡ project' }))) return;
      const ok = await postJson('/api/projects/forget', { root: b.dataset.forget }).then(() => true, (x) => toast(x.message, 'bad'));
      if (!ok) return;
      renderProjects(main);
    }));
}
