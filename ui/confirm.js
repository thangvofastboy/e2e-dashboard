import { icon } from './icons.js';

// Hộp thoại xác nhận dùng chung cho mọi thao tác xoá hoặc nguy hiểm (thay cho confirm() của trình duyệt).
// Trả về Promise<boolean>. Mặc định focus vào nút Huỷ; Esc và bấm ra ngoài hộp là Huỷ.
// `typed`: bắt gõ đúng từ này mới bật nút xác nhận. Nội dung chèn bằng textContent: không HTML.
export function confirmDialog({ title = 'Xác nhận', message = '', items = [], confirmLabel = 'Xác nhận', danger = true, typed = null }) {
  document.getElementById('confirm-dialog')?.remove();
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.id = 'confirm-dialog';
    dlg.className = `confirm-dialog${danger ? ' danger' : ''}`;
    dlg.setAttribute('role', 'alertdialog');
    dlg.setAttribute('aria-labelledby', 'confirm-title');
    dlg.setAttribute('aria-describedby', 'confirm-message');
    dlg.innerHTML = `<form method="dialog" class="run-form confirm-form">
      <header><h2 id="confirm-title">${icon(danger ? 'alert' : 'info', { size: 18 })}<span data-title></span></h2></header>
      <p id="confirm-message" data-message></p>
      <ul data-items hidden></ul>
      <label class="fb-field" data-typed hidden><span>Gõ <code data-word></code> để xác nhận</span><input data-input autocomplete="off" spellcheck="false"></label>
      <footer><button type="submit" value="cancel" data-cancel>Huỷ</button><button type="submit" value="ok" data-ok class="${danger ? 'btn-stop' : 'primary'}"></button></footer></form>`;
    dlg.querySelector('[data-title]').textContent = title;
    dlg.querySelector('[data-message]').textContent = message;
    dlg.querySelector('[data-ok]').textContent = confirmLabel;
    if (items.length) {
      const ul = dlg.querySelector('[data-items]');
      ul.hidden = false;
      for (const it of items) ul.append(Object.assign(document.createElement('li'), { textContent: String(it) }));
    }
    const ok = dlg.querySelector('[data-ok]');
    const input = dlg.querySelector('[data-input]');
    if (typed) {
      dlg.querySelector('[data-typed]').hidden = false;
      dlg.querySelector('[data-word]').textContent = typed;
      ok.disabled = true;
      input.addEventListener('input', () => { ok.disabled = input.value !== typed; });
    }
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close('cancel'); }); // bấm ra ngoài = huỷ
    dlg.addEventListener('close', () => {
      const yes = dlg.returnValue === 'ok';
      dlg.remove();
      resolve(yes);
    });
    document.body.append(dlg);
    dlg.showModal();
    (typed ? input : dlg.querySelector('[data-cancel]')).focus(); // an toàn: Enter không xoá nhầm
  });
}
