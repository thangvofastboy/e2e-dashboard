import { icon } from './icons.js';
import { escapeHtml } from './format.js';
import { toast } from './toast.js';

// Bộ lọc đã lưu: tên + địa chỉ trang (gồm cả tham số lọc). Chỉ là tiện ích của từng người xem nên lưu localStorage.
const KEY = 'e2ed-views';
const MAX_VIEWS = 30;

export function loadViews() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(list) ? list.filter((v) => typeof v?.name === 'string' && /^#\//.test(v?.hash)) : [];
  } catch {
    return [];
  }
}
function storeViews(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_VIEWS)));
  } catch {
    toast('Không lưu được: trình duyệt chặn lưu trữ', 'bad');
  }
}

export const viewsButton = () => `<button type="button" class="icon-btn views-btn" data-tip="Bộ lọc đã lưu" aria-label="Bộ lọc đã lưu">${icon('star', { size: 14 })}</button>`;

export function openViews() {
  document.getElementById('views-dialog')?.remove();
  const dlg = document.createElement('dialog');
  dlg.id = 'views-dialog';
  dlg.className = 'confirm-dialog';
  const draw = () => {
    const views = loadViews();
    dlg.innerHTML = `<form method="dialog" class="run-form confirm-form">
      <header><h2>${icon('star', { size: 18 })} Bộ lọc đã lưu</h2></header>
      <label class="fb-field"><span>Lưu trang hiện tại (kèm bộ lọc) với tên</span><input data-name maxlength="60" placeholder="Ví dụ: Fail của tôi trên main"></label>
      <button type="button" class="primary" data-save>${icon('check', { size: 14 })}Lưu</button>
      <ul class="views-list">${views.length ? views.map((v, i) => `<li><a href="${escapeHtml(v.hash)}" data-go>${escapeHtml(v.name)}</a><button type="button" class="small-btn" data-del="${i}" aria-label="Xoá ${escapeHtml(v.name)}">${icon('close', { size: 13 })}</button></li>`).join('') : '<li class="muted">Chưa lưu bộ lọc nào.</li>'}</ul>
      <footer><button type="submit">Đóng</button></footer></form>`;
    dlg.querySelector('[data-save]').addEventListener('click', () => {
      const name = dlg.querySelector('[data-name]').value.trim();
      if (!name) return toast('Đặt tên cho bộ lọc', 'bad');
      storeViews([...loadViews().filter((v) => v.name !== name), { name, hash: location.hash || '#/' }]);
      draw();
    });
    dlg.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      storeViews(loadViews().filter((_, i) => i !== Number(b.dataset.del)));
      draw();
    }));
    dlg.querySelectorAll('[data-go]').forEach((a) => a.addEventListener('click', () => dlg.close()));
  };
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => dlg.remove());
  draw();
  document.body.append(dlg);
  dlg.showModal();
}
