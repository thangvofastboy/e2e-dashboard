// Popup "1 click setup": mở dashboard lần đầu, hoặc mở một project khác (mỗi project là một tab dashboard riêng),
// mà project còn thiếu phần cài đặt (theo kế hoạch Quick Setup của server) thì hỏi có cài luôn không.
// Nội dung và cách cài dùng chung với trang 1 Click Setup (#/setup): ui/setup-steps.js.
// "Để sau": không hỏi lại trong phiên trình duyệt này. "Không hỏi lại": nhớ cho project này (localStorage).
import { getJson } from './api.js';
import { escapeHtml } from './format.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { setupNeeds, stepsHtml, bindSteps } from './setup-steps.js';

const keyFor = (root) => `e2ed-setup-prompt:${root}`;
const read = (store, k) => {
  try {
    return store.getItem(k);
  } catch {
    return null;
  }
};
const write = (store, k, v) => {
  try {
    store.setItem(k, v);
  } catch {
    // không có storage: lần sau vẫn hỏi, chấp nhận được
  }
};

export async function maybePromptSetup(info, { force = false } = {}) {
  if (!info?.root) return false;
  if (!force && location.hash.startsWith('#/setup')) return false; // đang ở trang 1 Click Setup rồi
  const key = keyFor(info.root);
  if (!force && (read(localStorage, key) === 'never' || read(sessionStorage, key) === 'later')) return false;
  const plan = await getJson('/api/system/quick-setup').catch(() => null);
  if (!plan) return false;
  const { auto, manual } = setupNeeds(plan);
  if (!auto.length && !manual.length) return false;
  openSetupDialog(plan, info, key);
  return true;
}

function openSetupDialog(plan, info, key) {
  document.getElementById('setup-prompt')?.remove();
  const { auto } = setupNeeds(plan);
  const dlg = document.createElement('dialog');
  dlg.id = 'setup-prompt';
  dlg.className = 'modal setup-prompt';
  dlg.setAttribute('aria-labelledby', 'sp-title');
  dlg.innerHTML = `<div class="run-form">
    <header><h2 id="sp-title">${icon('zap', { size: 16 })}Thiết lập project ${escapeHtml(info.project ?? '')}</h2>
      <button type="button" class="icon-btn" data-later aria-label="Để sau">${icon('close')}</button></header>
    <p>Project này chưa sẵn sàng để chạy e2e trên dashboard. ${auto.length ? `Bấm <strong>Cài tất cả</strong> để cài ${auto.length} mục theo thứ tự dưới đây.` : 'Còn vài việc cần làm tay.'}</p>
    ${plan.os ? `<p class="small muted">${icon('cpu', { size: 13 })} ${escapeHtml(plan.os.label)} · cách cài chọn theo hệ điều hành này</p>` : ''}
    <div data-steps>${stepsHtml(plan)}</div>
    <footer>
      <button type="button" class="link-btn small" data-never>Không hỏi lại cho project này</button>
      <a class="link-btn small" href="#/setup" data-open-page>Mở trang 1 Click Setup</a>
      <span class="sp-spacer"></span>
      <button type="button" data-later-btn>Để sau</button>
      <button type="button" class="primary" data-done hidden>${icon('check', { size: 14 })}Xong, tải lại trang</button>
    </footer></div>`;
  // nút Cài tất cả nằm trong danh sách bước: chuyển xuống footer cho popup
  const steps = dlg.querySelector('[data-steps]');
  const actions = steps.querySelector('.sp-actions');
  if (actions) {
    dlg.querySelector('footer').append(...actions.children);
    actions.remove();
  }
  document.body.append(dlg);

  let running = false;
  const later = () => {
    if (running) return;
    write(sessionStorage, key, 'later');
    dlg.close();
  };
  dlg.addEventListener('cancel', (e) => {
    if (running) e.preventDefault(); // Esc khi đang cài: không đóng giữa chừng
    else write(sessionStorage, key, 'later');
  });
  dlg.addEventListener('close', () => dlg.remove());
  dlg.querySelector('[data-later]').addEventListener('click', later);
  dlg.querySelector('[data-later-btn]').addEventListener('click', later);
  dlg.querySelector('[data-open-page]').addEventListener('click', (e) => {
    if (running) return e.preventDefault();
    write(sessionStorage, key, 'later');
    dlg.close();
  });
  dlg.querySelector('[data-never]').addEventListener('click', () => {
    write(localStorage, key, 'never');
    toast('Sẽ không hỏi lại. Cài sau ở trang 1 Click Setup (menu Tích hợp)');
    dlg.close();
  });
  dlg.querySelector('[data-done]').addEventListener('click', () => location.reload());
  const lock = (on) => {
    running = on;
    for (const b of dlg.querySelectorAll('[data-later], [data-later-btn], [data-never]')) b.disabled = on;
  };
  // nút Cài tất cả đã chuyển xuống footer: bindSteps tìm theo cả dialog
  const { runBtn } = bindSteps(dlg, plan, {
    onBusy: lock,
    onFinish: ({ ready }) => {
      dlg.querySelector('[data-done]').hidden = false;
      if (ready) write(sessionStorage, key, 'later');
    },
  });

  dlg.showModal();
  (runBtn ?? dlg.querySelector('[data-later-btn]')).focus();
}
