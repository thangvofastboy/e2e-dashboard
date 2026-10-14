import { postJson, getJson } from '../api.js';
import { confirmDialog } from '../confirm.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';

const MODES = ['off', 'on', 'retain-on-failure', 'on-first-retry', 'on-all-retries'];
// một ô nhập: nhãn, ô, và dòng giải thích kèm giá trị mặc định
const fld = (label, control, hint) => `<label class="fld"><span class="fld-l">${label}</span>${control}<small class="fld-hint">${hint}</small></label>`;
const sw = (name, label, hint, checked = false) => `<label class="fld fld-sw"><span class="pill switch"><input type="checkbox" name="${name}"${checked ? ' checked' : ''}><span class="track"></span><span>${label}</span></span><small class="fld-hint">${hint}</small></label>`;
const csv = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

// Các option chạy dùng chung cho hộp Chạy test và form Lịch chạy (cùng tên ô, cùng luật đọc).
// `updateSnapshots`: tắt ở Lịch chạy (ghi đè ảnh mẫu khi không ai xem).
export function runOptionsHtml({ repeatEach = null, preset = {}, updateSnapshots = true, browserDefault = false, browserHint = 'Trình duyệt chạy lần này. Mặc định: giá trị đặt ở Tự động & lưu trữ (Chromium).', workersHint = 'Số test chạy song song. Để trống = tự động theo số lõi CPU.' } = {}) {
  return `<div class="run-grid">
      ${fld('Retries', '<input type="number" name="retries" min="0" max="10" placeholder="theo config">', 'Số lần chạy lại test bị fail. Mặc định: theo e2e.config.')}
      ${fld('Repeat each', `<input type="number" name="repeatEach" min="1" max="50" placeholder="1"${Number.isInteger(repeatEach) ? ` value="${repeatEach}"` : ''}>`, 'Chạy mỗi test N lần liên tiếp để dò flaky. Mặc định: 1.')}
      ${fld('Trình duyệt', `<select name="browser" aria-label="Trình duyệt">${browserDefault ? '<option value="">theo Settings của project</option>' : ''}${['chromium', 'firefox', 'webkit'].map((b) => `<option value="${b}">${b === 'webkit' ? 'WebKit' : b.charAt(0).toUpperCase() + b.slice(1)}</option>`).join('')}</select>`, browserHint)}
      ${fld('Workers', '<input type="number" name="workers" min="1" max="1024" placeholder="tự động">', workersHint)}
      ${sw('headed', 'Có giao diện (headed)', 'Mở cửa sổ trình duyệt khi chạy (--headed), cần màn hình. Mặc định: theo Tự động & lưu trữ.')}
    </div>
    ${sw('noCache', '--no-cache', 'Bỏ qua replay cache: mọi step agent gọi model thật (chậm, tốn token). Mặc định: tắt.')}
    <details class="run-adv"${preset.updateSnapshots ? ' open' : ''}><summary>Nâng cao</summary>
      <div class="run-grid">
        ${fld('Tag', '<input type="text" name="tag" placeholder="smoke,api">', 'Chỉ chạy test có tag này, cách nhau bằng dấu phẩy. Mặc định: chạy tất cả.')}
        ${fld('Tag mode', '<select name="tagMode"><option value="">mặc định</option><option value="any">any</option><option value="all">all</option></select>', 'any = khớp một trong các tag; all = khớp mọi tag. Mặc định: theo e2e.')}
        ${fld('Bỏ tag', '<input type="text" name="excludeTag" placeholder="slow">', 'Bỏ qua test có tag này. Mặc định: không bỏ test nào.')}
        ${fld('Grep', '<input type="text" name="grep" placeholder="login">', 'Chỉ chạy test có tên khớp biểu thức này. Mặc định: không lọc.')}
        ${fld('Shard', '<input type="text" name="shard" placeholder="1/4" pattern="\\d+/\\d+">', 'Chia suite để chạy một phần: 1/4 là phần 1 trong 4. Mặc định: chạy toàn bộ.')}
        ${fld('Max failures', '<input type="number" name="maxFailures" min="1" max="1000" placeholder="không giới hạn">', 'Dừng cả run sau N test fail. Mặc định: không giới hạn.')}
        ${fld('Trace', `<select name="trace">${['', ...MODES].map((m) => `<option value="${m}">${m || 'theo config'}</option>`).join('')}</select>`, 'Khi nào ghi trace để debug. Mặc định: theo config.')}
        ${fld('Video', `<select name="video">${['', ...MODES].map((m) => `<option value="${m}">${m || 'theo config'}</option>`).join('')}</select>`, 'Khi nào quay video. Mặc định: theo config.')}
      </div>
      <div class="run-grid">
        ${sw('strictCache', '--strict-cache', 'Cache nghiêm ngặt của e2e (dùng cho CI): không chấp nhận cache thiếu hoặc lệch. Mặc định: tắt.')}
        ${sw('lastFailed', '--last-failed', 'Chỉ chạy lại các test fail ở lần chạy trước. Mặc định: tắt.')}
        ${updateSnapshots ? sw('updateSnapshots', '-u (cập nhật snapshot)', 'Ghi đè ảnh mẫu bằng ảnh hiện tại, xem git diff trước khi commit. Mặc định: tắt.', preset.updateSnapshots) : ''}
        ${sw('aiTrace', '--ai-trace', 'Ghi từng lần gọi model của mỗi step vào ai-trace.json (tab Model). Mặc định: tắt.')}
      </div>
    </details>`;
}

// Đọc option từ FormData; ô trống = theo config của project nên không gửi.
export function runOptionsFrom(fd) {
  return {
    ...(fd.get('retries') !== '' ? { retries: Number(fd.get('retries')) } : {}),
    ...(fd.get('repeatEach') !== '' ? { repeatEach: Number(fd.get('repeatEach')) } : {}),
    noCache: fd.get('noCache') === 'on',
    browser: fd.get('browser') || 'chromium',
    ...(fd.get('workers') !== '' ? { workers: Number(fd.get('workers')) } : {}),
    ...(fd.get('headed') === 'on' ? { headed: true } : {}), // tắt = theo Settings (hộp Chạy test gửi rõ false khi đã tải Settings)
    ...(csv(fd.get('tag')).length ? { tag: csv(fd.get('tag')) } : {}),
    ...(fd.get('tagMode') ? { tagMode: fd.get('tagMode') } : {}),
    ...(csv(fd.get('excludeTag')).length ? { excludeTag: csv(fd.get('excludeTag')) } : {}),
    ...(fd.get('grep').trim() ? { grep: fd.get('grep').trim() } : {}),
    ...(fd.get('shard').trim() ? { shard: fd.get('shard').trim() } : {}),
    ...(fd.get('maxFailures') !== '' ? { maxFailures: Number(fd.get('maxFailures')) } : {}),
    ...(fd.get('trace') ? { trace: fd.get('trace') } : {}),
    ...(fd.get('video') ? { video: fd.get('video') } : {}),
    ...Object.fromEntries(['strictCache', 'lastFailed', 'updateSnapshots', 'aiTrace'].filter((k) => fd.get(k) === 'on').map((k) => [k, true])),
  };
}

// Modal to start an e2e run (spec §4.5): tests are file:line, plus targets/agents and run flags.
export function openRunDialog({ tests, targets = [], agents = [], allTargets = targets, allAgents = agents, rerunOf = null, title = 'Chạy test', repeatEach = null, preset = {} }) {
  document.getElementById('run-dialog')?.remove();
  const box = (name, values, checked) => values
    .map((v) => `<label class="pill"><input type="checkbox" name="${name}" value="${escapeHtml(v)}" ${checked.includes(v) ? 'checked' : ''}>${escapeHtml(v)}</label>`)
    .join('');
  const dlg = document.createElement('dialog');
  dlg.id = 'run-dialog';
  dlg.innerHTML = `<form method="dialog" class="run-form">
    <header><h2>${icon('play', { size: 16 })}${escapeHtml(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Đóng">${icon('close')}</button></header>
    <p class="muted">${tests.length ? `${tests.length} test` : 'Toàn bộ suite'}</p>
    ${tests.length ? `<details><summary>Danh sách test</summary><ul class="mono-list">${tests.map((t) => `<li><code>${escapeHtml(t)}</code></li>`).join('')}</ul></details>` : ''}
    ${allTargets.length ? `<fieldset><legend>Target</legend>${box('target', allTargets, targets)}</fieldset>` : ''}
    ${allAgents.length > 1 ? `<fieldset><legend>Agent</legend>${box('agent', allAgents, agents)}</fieldset>` : ''}
    ${runOptionsHtml({ repeatEach, preset })}
    <p class="small tone-warn" data-browser-note hidden></p>
    <label class="pill switch" data-q-wrap hidden><input type="checkbox" name="excludeQuarantined" checked><span class="track"></span><span>Bỏ qua <span data-q-count></span> test đang cách ly</span></label>
    <p class="err" hidden></p>
    <footer><button type="button" data-close>Huỷ</button><button type="submit" class="primary">${icon('play', { size: 14 })}Chạy</button></footer>
  </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector('form');
  const err = dlg.querySelector('.err');
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  dlg.addEventListener('close', () => dlg.remove());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = {
      tests,
      targets: fd.getAll('target'),
      agents: allAgents.length > 1 ? fd.getAll('agent') : agents,
      ...runOptionsFrom(fd),
      // trống = tự động cho lần này (null); chưa tải được Settings thì không gửi để server dùng mặc định
      ...(fd.get('workers') !== '' ? {} : settingsLoaded ? { workers: null } : {}),
      ...(settingsLoaded || fd.get('headed') === 'on' ? { headed: fd.get('headed') === 'on' } : {}),
      ...(fd.get('excludeQuarantined') === 'on' && !dlg.querySelector('[data-q-wrap]').hidden ? { excludeQuarantined: true } : {}),
      ...(rerunOf ? { rerunOf } : {}),
    };
    if (!body.targets.length) delete body.targets;
    if (!body.agents?.length) delete body.agents;
    if (body.updateSnapshots && !(await confirmDialog({ title: 'Cập nhật snapshot', message: 'Chạy với -u: ảnh mẫu (snapshot) trong project sẽ bị ghi đè bằng ảnh hiện tại, kể cả khi test fail vì giao diện sai. Hãy xem git diff trước khi commit.', confirmLabel: 'Chạy và ghi đè' }))) return;
    try {
      await postJson('/api/run', body);
      dlg.close();
      location.hash = '#/live';
    } catch (x) {
      err.hidden = false;
      err.textContent = x.message.startsWith('409') ? 'Đang có một run khác chạy — chờ xong hoặc dừng nó ở trang Live.' : `Không chạy được: ${x.message}`;
    }
  });
  dlg.showModal();
  let settingsLoaded = false;
  getJson('/api/settings').then((s) => {
    const input = form.elements.workers;
    input.placeholder = `Tự động (${s.autoWorkers})`;
    if (s.workers && input.value === '') input.value = String(s.workers);
    form.elements.headed.checked = s.headed === true;
    const sel = form.elements.browser;
    sel.value = s.browser ?? 'chromium';
    for (const o of sel.options) {
      if (s.browsers?.installed?.[o.value] === false) {
        o.disabled = true; // chưa cài: chạy sẽ lỗi ngay
        o.textContent += ' (chưa cài)';
      }
    }
    const note = dlg.querySelector('[data-browser-note]');
    if (s.browsers && !s.browsers.configReadsBrowser) {
      note.hidden = false;
      note.textContent = 'e2e.config chưa đọc E2E_BROWSER: chọn trình duyệt ở đây chưa có tác dụng. Chạy /e2e-dashboard setup để bật.';
    }
    settingsLoaded = true;
  }).catch(() => {});
  getJson('/api/quarantine').then((q) => {
    const n = q.list.length - q.expired.length;
    if (!n) return;
    dlg.querySelector('[data-q-count]').textContent = String(n);
    dlg.querySelector('[data-q-wrap]').hidden = false;
  }).catch(() => {});
}
