import { getJson, isExport } from '../api.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';

const KIND_LABEL = { test: 'Test', error: 'Lỗi', url: 'URL', run: 'Run' };

export function searchHitsHtml(hits, active = 0) {
  if (!hits.length) return '<li class="muted small" style="padding:10px">Không có kết quả.</li>';
  return hits
    .map((h, i) => `<li><a href="${escapeHtml(h.href)}" class="${i === active ? 'on' : ''}" data-hit="${i}"><span class="kind">${escapeHtml(KIND_LABEL[h.kind] ?? h.kind)}</span><span class="lbl">${escapeHtml(h.label)}</span><span class="sub">${escapeHtml(h.sub)}</span></a></li>`)
    .join('');
}

// Ctrl/⌘+K: one box for test titles, error codes and messages, URLs, branches, commits, run ids.
export function openSearch() {
  if (isExport() || document.getElementById('search-dialog')) return;
  const dlg = document.createElement('dialog');
  dlg.id = 'search-dialog';
  dlg.className = 'modal';
  dlg.innerHTML = `<div class="search-box">${icon('search', { size: 18 })}<input type="text" placeholder="Tìm test, mã lỗi, URL, branch, commit, run id…" aria-label="Tìm kiếm" autocomplete="off"></div>
    <ul class="search-hits" role="listbox"></ul><div class="search-foot">↑↓ chọn · Enter mở · Esc đóng · tìm trong 50 run gần nhất, không phân biệt dấu</div>`;
  document.body.append(dlg);
  const input = dlg.querySelector('input');
  const list = dlg.querySelector('.search-hits');
  let hits = [];
  let active = 0;
  let timer = null;
  let seq = 0;
  const draw = () => (list.innerHTML = input.value.trim() ? searchHitsHtml(hits, active) : '');
  const go = (i) => {
    if (!hits[i]) return;
    location.hash = hits[i].href;
    dlg.close();
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const mine = ++seq;
      const q = input.value.trim();
      const r = q ? await getJson(`/api/search?q=${encodeURIComponent(q)}`).catch(() => ({ hits: [] })) : { hits: [] };
      if (mine !== seq) return;
      hits = r.hits;
      active = 0;
      draw();
    }, 150);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % Math.max(1, hits.length);
      draw();
      list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter') go(active);
  });
  list.addEventListener('click', (e) => {
    const a = e.target.closest('[data-hit]');
    if (!a) return;
    e.preventDefault();
    go(Number(a.dataset.hit));
  });
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => e.target === dlg && dlg.close());
  dlg.showModal();
  input.focus();
}

export function bindSearchShortcut() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openSearch();
    }
  });
}
