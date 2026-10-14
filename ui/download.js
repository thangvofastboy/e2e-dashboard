import { icon } from './icons.js';
import { isExport } from './api.js';
import { fmtBytes } from './views/settings.js';

// Popup "Tải về" cho mọi chỗ xuất dữ liệu: tải file trước, hiện tên (sửa được) và dung lượng, bấm Tải về mới lưu.
// `href` (tải từ server, tên lấy từ Content-Disposition) hoặc `blob` (dữ liệu có sẵn trong trình duyệt).
export function downloadDialog({ href = null, blob = null, filename = '' }) {
  document.getElementById('download-dialog')?.remove();
  const dlg = document.createElement('dialog');
  dlg.id = 'download-dialog';
  dlg.className = 'confirm-dialog';
  dlg.setAttribute('aria-labelledby', 'download-title');
  dlg.innerHTML = `<form method="dialog" class="run-form confirm-form">
    <header><h2 id="download-title">${icon('download', { size: 18 })}<span>Tải dữ liệu về</span></h2></header>
    <label class="fb-field"><span>Tên file</span><input data-name autocomplete="off" spellcheck="false"></label>
    <p class="muted small" data-info>${icon('loader', { size: 14 })}Đang chuẩn bị file…</p>
    <footer><button type="submit" value="cancel">Huỷ</button><button type="submit" value="ok" class="primary" data-ok disabled>${icon('download', { size: 14 })}Tải về</button></footer></form>`;
  const name = dlg.querySelector('[data-name]');
  const info = dlg.querySelector('[data-info]');
  const ok = dlg.querySelector('[data-ok]');
  name.value = filename;
  let file = blob;
  const ready = () => {
    info.textContent = `Dung lượng: ${fmtBytes(file.size)}`;
    ok.disabled = !name.value.trim();
  };
  name.addEventListener('input', () => { if (file) ok.disabled = !name.value.trim(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close('cancel'); });
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'ok' && file) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = name.value.trim();
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    dlg.remove();
  });
  document.body.append(dlg);
  dlg.showModal();
  if (file) ready();
  else
    fetch(href)
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
        const cd = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '');
        if (!name.value) name.value = cd?.[1] ?? decodeURIComponent(new URL(href, location.href).pathname.split('/').pop());
        file = await res.blob();
        ready();
      })
      .catch((e) => {
        info.textContent = `Không xuất được: ${e.message}`;
        info.classList.add('tone-bad');
      });
}

// Mọi link <a download> trong dashboard mở popup thay vì tải thẳng. Bản export tĩnh không có server: để nguyên.
export function bindDownloads() {
  if (isExport()) return;
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[download]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    downloadDialog({ href: a.href, filename: a.getAttribute('download') ?? '' });
  });
}
