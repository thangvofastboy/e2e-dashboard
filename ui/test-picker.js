import { escapeHtml } from './format.js';
import { icon } from './icons.js';
import { buildTree } from './test-tree.js';

// Ô chọn một test: nút mở popover gồm ô lọc + cây thư mục. Giá trị nằm ở <input type="hidden" name=…>
// nên form cũ đọc như <select> trước đây. Row: { value, title, file, tags, sub }.

// bỏ dấu tiếng Việt + chữ thường để lọc ("gio hang" khớp "Giỏ hàng")
export const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase();

export function filterTests(rows, query) {
  const q = fold(query).trim();
  if (!q) return rows;
  return rows.filter((r) => fold([r.title, r.file, ...(r.tags ?? [])].join(' ')).includes(q));
}

// emptyLabel: thêm lựa chọn giá trị rỗng ở đầu (vd. "Cả run mới nhất")
export function pickerHtml({ name, rows, value = '', emptyLabel = '', placeholder = 'Chọn test', attrs = '' }) {
  const cur = rows.find((r) => r.value === value);
  const text = cur ? cur.title : value === '' && emptyLabel ? emptyLabel : placeholder;
  return `<span class="tpick" data-tpick><input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(cur || emptyLabel ? value : '')}" ${attrs}>
    <button type="button" class="tpick-btn" aria-haspopup="listbox" aria-expanded="false"><span class="tpick-cur">${escapeHtml(text)}</span>${icon('down', { size: 13 })}</button>
    <span class="tpick-pop" hidden><input type="search" class="tpick-q" placeholder="Lọc theo tên, file, tag…" aria-label="Lọc test" autocomplete="off"><span class="tpick-list" role="listbox"></span></span></span>`;
}

function listHtml(rows, emptyLabel) {
  const out = emptyLabel ? [`<span role="option" class="tpick-opt" data-v="">${escapeHtml(emptyLabel)}</span>`] : [];
  const walk = (node, depth) => {
    for (const c of node.children) {
      out.push(`<span class="tpick-dir" style="--d:${depth}">${icon(c.children.length ? 'folder' : 'file', { size: 12 })}${escapeHtml(c.name)} <span class="muted small">${c.count}</span></span>`);
      walk(c, depth + 1);
    }
    for (const t of node.tests) {
      out.push(`<span role="option" class="tpick-opt" style="--d:${depth}" data-v="${escapeHtml(t.value)}">${escapeHtml(t.title)}${t.sub ? ` <span class="muted small">${escapeHtml(t.sub)}</span>` : ''}</span>`);
    }
  };
  walk(buildTree(rows, () => false), 0);
  return out.length ? out.join('') : '<span class="muted small tpick-none">Không test nào khớp</span>';
}

// gắn hành vi cho một ô đã vẽ bằng pickerHtml; onChange(value) khi chọn
export function bindPicker(wrap, rows, { emptyLabel = '', onChange = null } = {}) {
  const hidden = wrap.querySelector('input[type=hidden]');
  const btn = wrap.querySelector('.tpick-btn');
  const pop = wrap.querySelector('.tpick-pop');
  const q = wrap.querySelector('.tpick-q');
  const list = wrap.querySelector('.tpick-list');
  let active = -1;
  const opts = () => [...list.querySelectorAll('[role=option]')];
  const mark = (i) => {
    const os = opts();
    active = Math.max(0, Math.min(i, os.length - 1));
    os.forEach((o, j) => o.setAttribute('aria-selected', String(j === active)));
    os[active]?.scrollIntoView({ block: 'nearest' });
  };
  const paint = () => {
    list.innerHTML = listHtml(filterTests(rows, q.value), q.value.trim() ? '' : emptyLabel);
    mark(Math.max(0, opts().findIndex((o) => o.dataset.v === hidden.value)));
  };
  const close = () => {
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
  };
  const outside = (e) => !wrap.contains(e.target) && close();
  const pick = (o) => {
    if (!o) return;
    hidden.value = o.dataset.v;
    wrap.querySelector('.tpick-cur').textContent = o.dataset.v === '' ? emptyLabel : rows.find((r) => r.value === o.dataset.v)?.title ?? o.dataset.v;
    close();
    btn.focus();
    onChange?.(hidden.value);
  };
  btn.addEventListener('click', () => {
    if (!pop.hidden) return close();
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    q.value = '';
    paint();
    q.focus();
    document.addEventListener('pointerdown', outside, true);
  });
  q.addEventListener('input', paint);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      mark(active + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault(); // không submit form
      pick(opts()[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // không đóng dialog bao ngoài
      close();
      btn.focus();
    }
  });
  list.addEventListener('click', (e) => pick(e.target.closest('[role=option]')));
}
