// Danh sách bước 1 Click Setup dùng chung cho trang "1 Click Setup" (#/setup) và popup khi mở dashboard:
// bước tự cài theo thứ tự (Bước i/n, trạng thái Chờ / Đang cài / Xong / Lỗi / Bỏ qua), mục làm tay có nút copy,
// API key nhập tại chỗ (lưu vào .env qua /api/system/ai). Kế hoạch (lệnh) luôn do server dựng; client chỉ gửi id.
import { getJson, postJson, postStream } from './api.js';
import { escapeHtml } from './format.js';
import { icon } from './icons.js';
import { toast } from './toast.js';

// mục cần làm: bước tự cài được, và mục bắt buộc phải làm tay (Node, API key, đăng nhập…)
export function setupNeeds(plan) {
  const auto = plan.items.filter((x) => plan.steps.includes(x.id));
  const manual = plan.items.filter((x) => !x.ok && !x.optional && !x.info && !plan.steps.includes(x.id));
  return { auto, manual };
}

function stepRow(x, n, total) {
  return `<li class="sp-step" data-step="${escapeHtml(x.id)}" data-state="wait">
    <span class="sp-state" aria-hidden="true">${icon('clock', { size: 15 })}</span>
    <span><span class="chip">Bước ${n}/${total}</span> <strong>${escapeHtml(x.label)}</strong><br>
      <span class="muted small">${escapeHtml(x.detail ?? '')}</span><br><code>${escapeHtml(x.display ?? '')}</code>${x.display ? `<button type="button" class="icon-btn" data-copy-text="${escapeHtml(x.display)}" aria-label="Copy lệnh" title="Copy lệnh">${icon('copy', { size: 13 })}</button>` : ''}</span>
    <span class="sp-label small" data-label>Chờ</span></li>`;
}

function manualRow(x) {
  // API key: nhập luôn tại chỗ, không bắt mở trang khác
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

function okRow(x) {
  return `<li class="sp-step" data-state="${x.ok ? 'ok' : 'optional'}"><span class="sp-state" aria-hidden="true">${icon(x.ok ? 'check' : 'info', { size: 15 })}</span>
    <span><strong>${escapeHtml(x.label)}</strong>${x.optional && !x.ok ? ' <span class="muted small">(tuỳ chọn)</span>' : ''}<br><span class="muted small">${escapeHtml(x.detail ?? '')}</span>${!x.ok && x.display ? `<br><code>${escapeHtml(x.display)}</code><button type="button" class="icon-btn" data-copy-text="${escapeHtml(x.display)}" aria-label="Copy lệnh" title="Copy lệnh">${icon('copy', { size: 13 })}</button>` : ''}</span>
    <span class="sp-label small">${x.ok ? 'Đã có' : 'Tuỳ chọn'}</span></li>`;
}

// html các bước. showOk: thêm (thu gọn) các mục đã có và mục tuỳ chọn — cho trang 1 Click Setup
export function stepsHtml(plan, { showOk = false, runLabel = 'Cài tất cả' } = {}) {
  const { auto, manual } = setupNeeds(plan);
  const rest = plan.items.filter((x) => !x.info && !auto.includes(x) && !manual.includes(x));
  return `${auto.length ? `<ol class="sp-steps">${auto.map((x, i) => stepRow(x, i + 1, auto.length)).join('')}</ol>` : ''}
    ${manual.length ? `<h3 class="small sp-h">Cần làm tay</h3><ul class="sp-steps">${manual.map(manualRow).join('')}</ul>` : ''}
    ${!plan.canSudo && auto.some((x) => /^sudo /.test(x.display ?? '')) ? '<p class="small muted">Bước cần mật khẩu sudo không chạy được từ trình duyệt: chạy <code>/e2e-dashboard 1-setup</code><button type="button" class="icon-btn" data-copy-text="/e2e-dashboard 1-setup" aria-label="Copy lệnh" title="Copy lệnh">' + icon('copy', { size: 13 }) + '</button> trong terminal.</p>' : ''}
    ${showOk && rest.length ? `<details class="sp-ok"><summary class="small">Đã có / tuỳ chọn (${rest.length})</summary><ul class="sp-steps">${rest.map(okRow).join('')}</ul></details>` : ''}
    <p class="small" data-progress role="status" aria-live="polite"></p>
    <details class="sp-log" hidden><summary class="small">Log cài đặt</summary><pre class="log" data-log></pre></details>
    ${auto.length ? `<p class="sp-actions"><button type="button" class="primary keep-label" data-run>${icon('download', { size: 14 })}${escapeHtml(runLabel)} (${auto.length})</button></p>` : ''}`;
}

// gắn hành vi cho các bước trong `root`: copy lệnh, lưu API key, chạy Cài tất cả.
// onBusy(true|false) quanh lúc cài; onFinish({ failed, left }) sau khi cài và kiểm tra lại kế hoạch
export function bindSteps(root, plan, { onBusy = () => {}, onFinish = () => {} } = {}) {
  const { auto } = setupNeeds(plan);
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b || !root.contains(b)) return;
    navigator.clipboard?.writeText(b.dataset.copy).then(() => toast('Đã copy lệnh'), () => {});
  });
  root.querySelector('[data-key-form]')?.addEventListener('submit', async (e) => {
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

  const runBtn = root.querySelector('[data-run]');
  runBtn?.addEventListener('click', async () => {
    runBtn.disabled = true;
    runBtn.setAttribute('aria-busy', 'true');
    onBusy(true);
    const progress = root.querySelector('[data-progress]');
    const logBox = root.querySelector('.sp-log');
    const logEl = root.querySelector('[data-log]');
    logBox.hidden = false;
    const lines = [];
    const log = (t) => {
      lines.push(t);
      logEl.textContent = lines.slice(-300).join('\n');
      logEl.scrollTop = logEl.scrollHeight;
    };
    const setState = (id, state, label) => {
      const li = root.querySelector(`[data-step="${CSS.escape(id)}"]`);
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
      });
    } catch (x) {
      failed++;
      log(`✗ ${x.message.replace(/^\d{3}: /, '')}`);
    }
    // bước không chạy (dừng sau khi npm install lỗi, hoặc server bỏ qua)
    for (const id of ids) if (!done.has(id)) setState(id, 'skip', 'Bỏ qua');
    runBtn.hidden = true;
    onBusy(false);
    const after = await getJson('/api/system/quick-setup').catch(() => null);
    const left = after ? setupNeeds(after) : null;
    const ready = !failed && left && !left.auto.length && !left.manual.length;
    progress.textContent = ready ? 'Đã cài xong. Project sẵn sàng chạy e2e.' : failed ? `${failed} bước lỗi: xem log, sửa rồi bấm Kiểm tra lại.` : 'Đã cài xong phần tự cài; còn mục cần làm tay ở trên.';
    logBox.open = Boolean(failed);
    toast(failed ? `Thiết lập: ${failed} bước lỗi` : 'Thiết lập xong', failed ? 'bad' : 'good');
    onFinish({ failed, left, ready, log: lines.join('\n') });
  });
  return { runBtn };
}
