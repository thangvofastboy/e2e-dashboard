import { getJson, postJson } from '../api.js';
import { icon } from '../icons.js';
import { escapeHtml } from '../format.js';
import { toast } from '../toast.js';
import { confirmDialog } from '../confirm.js';
import { highlight } from '../highlight.js';

// Xem / sửa file test (.e2e.ts, .spec.ts, .test.ts) ngay trên trang Tests. Ctrl/Cmd+S lưu.
// Lưu kèm mtime lúc mở: file đổi trên đĩa trong lúc sửa thì server trả 409, không ghi đè.
export async function openSourceDialog(file, { onSaved } = {}) {
  let src;
  try {
    src = await getJson(`/api/tests/source?file=${encodeURIComponent(file)}`);
  } catch (e) {
    toast(e.message, 'bad');
    return;
  }
  document.getElementById('source-dialog')?.remove();
  const dlg = document.createElement('dialog');
  dlg.id = 'source-dialog';
  dlg.innerHTML = `<form method="dialog" class="run-form">
    <header><h2>${icon('code', { size: 16 })}<code>${escapeHtml(file)}</code></h2><button type="button" class="icon-btn" data-close aria-label="Đóng">${icon('close')}</button></header>
    <div class="src-wrap"><pre class="src-hl" aria-hidden="true" data-hl></pre><textarea class="src-ta" data-src spellcheck="false" autocomplete="off" aria-label="Nội dung ${escapeHtml(file)}"></textarea></div>
    <footer><span class="muted small" data-state></span><button type="button" data-close>Đóng</button><button type="button" class="primary" data-save disabled>${icon('check', { size: 14 })}Lưu</button></footer></form>`;
  const ta = dlg.querySelector('[data-src]');
  const save = dlg.querySelector('[data-save]');
  const state = dlg.querySelector('[data-state]');
  const hl = dlg.querySelector('[data-hl]');
  // lớp tô màu nằm dưới textarea trong suốt: vẽ lại theo nội dung, đồng bộ cuộn. Dòng cuối thêm \n để chiều cao khớp
  const paint = () => {
    hl.innerHTML = `${highlight(ta.value, 'js')}\n`;
    hl.scrollTop = ta.scrollTop;
    hl.scrollLeft = ta.scrollLeft;
  };
  ta.value = src.content;
  paint();
  const dirty = () => ta.value !== src.content;
  ta.addEventListener('input', () => {
    save.disabled = !dirty();
    state.textContent = dirty() ? 'Chưa lưu' : '';
    paint();
  });
  ta.addEventListener('scroll', () => { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; });
  const doSave = async () => {
    if (!dirty() || save.getAttribute('aria-busy')) return;
    save.setAttribute('aria-busy', 'true');
    try {
      const r = await postJson('/api/tests/source', { file, content: ta.value, mtime: src.mtime });
      src = { ...src, content: ta.value, mtime: r.mtime };
      save.disabled = true;
      state.textContent = 'Đã lưu';
      toast(`Đã lưu ${file}`, 'good');
      onSaved?.();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      save.removeAttribute('aria-busy');
    }
  };
  const close = async () => {
    if (dirty() && !(await confirmDialog({ title: 'Bỏ thay đổi?', message: `${file} có thay đổi chưa lưu.`, confirmLabel: 'Bỏ thay đổi' }))) return;
    dlg.close();
  };
  save.addEventListener('click', doSave);
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); }); // Esc: hỏi nếu còn thay đổi chưa lưu
  dlg.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      doSave();
    }
    if (e.key === 'Tab' && e.target === ta && !e.shiftKey) { // Tab chèn 2 dấu cách thay vì nhảy khỏi ô
      e.preventDefault();
      ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input'));
    }
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  ta.focus();
}
