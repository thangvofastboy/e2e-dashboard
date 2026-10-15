// Popup "1 click setup": mở dashboard lần đầu, hoặc mở một project khác (mỗi project là một tab dashboard riêng),
// mà project còn thiếu phần cài đặt (theo kế hoạch Quick Setup của server) thì hỏi có cài luôn không.
// Cài ngay trong popup: từng bước có trạng thái chờ / đang cài / xong / lỗi, log thu gọn bên dưới.
// "Để sau": không hỏi lại trong phiên trình duyệt này. "Không hỏi lại": nhớ cho project này (localStorage).
import { getJson, postJson, postStream } from './api.js';
import { escapeHtml } from './format.js';
import { icon } from './icons.js';
import { toast } from './toast.js';

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

// mục cần làm: bước tự cài được, và mục bắt buộc phải làm tay (Node, API key, đăng nhập…)
export function setupNeeds(plan) {
  const auto = plan.items.filter((x) => plan.steps.includes(x.id));
  const manual = plan.items.filter((x) => !x.ok && !x.optional && !x.info && !plan.steps.includes(x.id));
  return { auto, manual };
}

export async function maybePromptSetup(info, { force = false } = {}) {
  if (!info?.root) return false;
  const key = keyFor(info.root);
  if (!force && (read(localStorage, key) === 'never' || read(sessionStorage, key) === 'later')) return false;
  const plan = await getJson('/api/system/quick-setup').catch(() => null);
  if (!plan) return false;
  const { auto, manual } = setupNeeds(plan);
  if (!auto.length && !manual.length) return false;
  openSetupDialog(plan, info, key);
  return true;
}

function stepRow(x, n, total) {
  return `<li class="sp-step" data-step="${escapeHtml(x.id)}" data-state="wait">
    <span class="sp-state" aria-hidden="true">${icon('clock', { size: 15 })}</span>
    <span><span class="chip">Bước ${n}/${total}</span> <strong>${escapeHtml(x.label)}</strong><br>
      <span class="muted small">${escapeHtml(x.detail ?? '')}</span><br><code>${escapeHtml(x.display ?? '')}</code></span>
    <span class="sp-label small" data-label>Chờ</span></li>`;
}

function manualRow(x) {
  // API key: nhập luôn trong popup (lưu vào .env qua /api/system/ai), không bắt mở trang khác
  if (x.id === 'ai-key' && x.provider) {
    return `<li class="sp-step" data-step="ai-key" data-state="manual"><span class="sp-state" aria-hidden="true">${icon('lock', { size: 15 })}</span>
      <span><strong>${escapeHtml(x.label)}</strong><br><span class="muted small">Model AI cho bước agent cần key này${x.keyUrl ? `: tạo ở <a href="${escapeHtml(x.keyUrl)}" target="_blank" rel="noreferrer">${escapeHtml(x.keyUrl)}</a>` : ''}. Lưu vào .env (git-ignore, quyền 600).</span>
      <form class="sp-key" data-key-form data-provider="${escapeHtml(x.provider)}"><input type="password" name="key" autocomplete="off" placeholder="Dán ${escapeHtml(x.env)}" aria-label="${escapeHtml(x.env)}" required><button type="submit">${icon('check', { size: 14 })}Lưu key</button></form></span>
      <span class="sp-label small" data-label>Cần nhập</span></li>`;
  }
  return `<li class="sp-step" data-state="manual"><span class="sp-state" aria-hidden="true">${icon('terminal', { size: 15 })}</span>
    <span><strong>${escapeHtml(x.label)}</strong><br><span class="muted small">${escapeHtml(x.detail ?? '')}</span><br><code>${escapeHtml(x.display ?? '')}</code>
    <button type="button" class="icon-btn" data-copy="${escapeHtml(x.display ?? '')}" aria-label="Copy lệnh" title="Copy lệnh">${icon('copy', { size: 13 })}</button></span>
    <span class="sp-label small">Làm tay</span></li>`;
}

function openSetupDialog(plan, info, key) {
  document.getElementById('setup-prompt')?.remove();
  const { auto, manual } = setupNeeds(plan);
  const dlg = document.createElement('dialog');
  dlg.id = 'setup-prompt';
  dlg.className = 'modal setup-prompt';
  dlg.setAttribute('aria-labelledby', 'sp-title');
  dlg.innerHTML = `<div class="run-form">
    <header><h2 id="sp-title">${icon('zap', { size: 16 })}Thiết lập project ${escapeHtml(info.project ?? '')}</h2>
      <button type="button" class="icon-btn" data-later aria-label="Để sau">${icon('close')}</button></header>
    <p>Project này chưa sẵn sàng để chạy e2e trên dashboard. ${auto.length ? `Bấm <strong>Cài tất cả</strong> để cài ${auto.length} mục theo thứ tự dưới đây.` : 'Còn vài việc cần làm tay.'}</p>
    ${plan.os ? `<p class="small muted">${icon('cpu', { size: 13 })} ${escapeHtml(plan.os.label)} · cách cài chọn theo hệ điều hành này</p>` : ''}
    ${auto.length ? `<ol class="sp-steps">${auto.map((x, i) => stepRow(x, i + 1, auto.length)).join('')}</ol>` : ''}
    ${manual.length ? `<h3 class="small">Cần làm tay</h3><ul class="sp-steps">${manual.map(manualRow).join('')}</ul>` : ''}
    ${!plan.canSudo && auto.some((x) => /^sudo /.test(x.display ?? '')) ? '<p class="small muted">Bước cần mật khẩu sudo không chạy được từ trình duyệt: chạy <code>/e2e-dashboard setup --quick</code> trong terminal.</p>' : ''}
    <p class="small" data-progress role="status" aria-live="polite"></p>
    <details class="sp-log" hidden><summary class="small">Log cài đặt</summary><pre class="log" data-log></pre></details>
    <footer>
      <button type="button" class="link-btn small" data-never>Không hỏi lại cho project này</button>
      <span class="sp-spacer"></span>
      <button type="button" data-later-btn>Để sau</button>
      ${auto.length ? `<button type="button" class="primary" data-run>${icon('download', { size: 14 })}Cài tất cả (${auto.length})</button>` : ''}
      <button type="button" class="primary" data-done hidden>${icon('check', { size: 14 })}Xong, tải lại trang</button>
    </footer></div>`;
  document.body.append(dlg);

  let running = false;
  const ac = new AbortController();
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
  dlg.querySelector('[data-never]').addEventListener('click', () => {
    write(localStorage, key, 'never');
    toast('Sẽ không hỏi lại. Cài sau ở Cài đặt hệ thống › Project › Quick Setup');
    dlg.close();
  });
  dlg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    navigator.clipboard?.writeText(b.dataset.copy).then(() => toast('Đã copy lệnh'), () => {});
  });
  dlg.querySelector('[data-done]').addEventListener('click', () => location.reload());
  dlg.querySelector('[data-key-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const li = f.closest('.sp-step');
    try {
      await postJson('/api/system/ai', { provider: f.dataset.provider, apiKey: f.key.value.trim() });
      li.dataset.state = 'ok';
      li.querySelector('.sp-state').innerHTML = icon('check', { size: 15 });
      li.querySelector('[data-label]').textContent = 'Đã lưu';
      f.replaceWith(Object.assign(document.createElement('span'), { className: 'small muted', textContent: 'Đã lưu vào .env.' }));
      toast('Đã lưu API key');
    } catch (x) {
      toast(x.message.replace(/^\d{3}: /, ''), 'bad');
    }
  });

  const runBtn = dlg.querySelector('[data-run]');
  runBtn?.addEventListener('click', async () => {
    running = true;
    runBtn.disabled = true;
    runBtn.setAttribute('aria-busy', 'true');
    for (const b of dlg.querySelectorAll('[data-later], [data-later-btn], [data-never]')) b.disabled = true;
    const progress = dlg.querySelector('[data-progress]');
    const logBox = dlg.querySelector('.sp-log');
    const logEl = dlg.querySelector('[data-log]');
    logBox.hidden = false;
    const lines = [];
    const log = (t) => {
      lines.push(t);
      logEl.textContent = lines.slice(-300).join('\n');
      logEl.scrollTop = logEl.scrollHeight;
    };
    const setState = (id, state, label) => {
      const li = dlg.querySelector(`[data-step="${CSS.escape(id)}"]`);
      if (!li) return;
      li.dataset.state = state;
      li.querySelector('.sp-state').innerHTML = icon({ run: 'loader', ok: 'check', fail: 'x', skip: 'skip' }[state] ?? 'clock', { size: 15 });
      li.querySelector('[data-label]').textContent = label;
    };
    const ids = auto.map((x) => x.id);
    const done = new Set();
    let failed = 0;
    try {
      await postStream('/api/system/quick-setup/run', { ids }, (e) => {
        if (e.type === 'step') {
          const n = ids.indexOf(e.id) + 1;
          setState(e.id, 'run', 'Đang cài…');
          progress.textContent = `Đang cài bước ${n}/${ids.length}: ${e.label}`;
          log(`\n▶ [${n}/${ids.length}] ${e.label}\n$ ${e.display ?? ''}`);
        } else if (e.type === 'log') log(e.text);
        else if (e.type === 'step-done') {
          done.add(e.id);
          if (!e.ok) failed++;
          setState(e.id, e.ok ? 'ok' : 'fail', e.ok ? 'Xong' : `Lỗi (mã ${e.code})`);
          log(e.ok ? '✓ Xong' : `✗ Lỗi (mã ${e.code})`);
        } else if (e.type === 'error') {
          failed++;
          log(`✗ ${e.message}`);
        }
      }, ac.signal);
    } catch (x) {
      failed++;
      log(`✗ ${x.message.replace(/^\d{3}: /, '')}`);
      progress.textContent = x.message.replace(/^\d{3}: /, '');
    }
    // bước không chạy (dừng sau khi npm install lỗi, hoặc server bỏ qua)
    for (const id of ids) if (!done.has(id)) setState(id, 'skip', 'Bỏ qua');
    running = false;
    runBtn.hidden = true;
    for (const b of dlg.querySelectorAll('[data-later], [data-later-btn], [data-never]')) b.disabled = false;
    dlg.querySelector('[data-done]').hidden = false;
    const after = await getJson('/api/system/quick-setup').catch(() => null);
    const left = after ? setupNeeds(after) : null;
    if (!failed && left && !left.auto.length && !left.manual.length) {
      progress.textContent = 'Đã cài xong. Project sẵn sàng chạy e2e.';
      write(sessionStorage, key, 'later');
    } else {
      progress.textContent = failed ? `${failed} bước lỗi: xem log, sửa rồi thử lại ở Cài đặt hệ thống › Project › Quick Setup.` : 'Đã cài xong phần tự cài; còn mục cần làm tay ở trên.';
      logBox.open = Boolean(failed);
    }
    toast(failed ? `Thiết lập: ${failed} bước lỗi` : 'Thiết lập xong', failed ? 'bad' : 'good');
  });

  dlg.showModal();
  (runBtn ?? dlg.querySelector('[data-later-btn]')).focus();
}
