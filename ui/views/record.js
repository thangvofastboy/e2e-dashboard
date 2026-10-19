import { getJson, postJson } from '../api.js';
import { pageHead } from '../analysis.js';
import { toast } from '../toast.js';
import { confirmDialog } from '../confirm.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';
import { tcCardsHtml, readTcCards } from './linear-issues.js';

// Trang Record: (tuỳ chọn) đăng nhập trước và lưu phiên → ghi thao tác bằng codegen → testcase (AI sinh expected) → sửa →
// lưu .spec.ts → tuỳ chọn AI Gen e2e. Trạng thái đang sửa / vừa lưu nằm ở biến module; đổi trang thì dựng lại từ đầu.
let recEditing = null; // { name, url, slug, secrets, aiError?, testcases }
let recSaved = null; // { specPath, casesPath, secrets, slug, e2ePath }
const REC_POLL_MS = 1500;
// ô của form ghi mới: giữ giá trị khi trang vẽ lại (poll, xong phiên đăng nhập…)
const REC_FIELDS = ['[data-rec-url]', '[data-rec-name-new]', '[data-rec-auth]', '[data-rec-login-name]', '[data-rec-cookie]', '[data-rec-link]', '[data-rec-ai-prompt]'];

const recSecretsNote = (secrets) => (secrets?.length
  ? `<p class="muted small" data-rec-secrets>Giá trị nhạy cảm đã được thay bằng biến môi trường ${secrets.map((s) => `<code>${escapeHtml(s)}</code>`).join(', ')}. Đặt giá trị của chúng trong <code>.env</code> hoặc môi trường trước khi chạy test.</p>`
  : '');

const recWhen = (iso) => escapeHtml(String(iso ?? '').slice(0, 16).replace('T', ' '));

function recFormHtml(status, auth) {
  const off = status.canRecord ? '' : ' disabled';
  return `<section class="panel"><h2>${icon('video', { size: 15 })} Ghi thao tác mới</h2>
    <div class="form-row">
      <input data-rec-url maxlength="500" placeholder="https://app.example.com" aria-label="URL cần ghi">
      <input data-rec-name-new maxlength="200" placeholder="Tên bộ test (vd: Đăng nhập)" aria-label="Tên bộ test">
      <select data-rec-auth aria-label="Phiên đăng nhập"><option value="">Không dùng phiên đăng nhập</option>${auth.map((a) => `<option value="${escapeHtml(a.name)}">${escapeHtml(a.name)} · ${recWhen(a.savedAt)}</option>`).join('')}</select>
      ${auth.length ? `<button type="button" class="icon-btn" data-rec-auth-del aria-label="Xoá phiên đã chọn" title="Xoá phiên đã chọn">${icon('close', { size: 14 })}</button>` : ''}
      <button type="button" class="primary" data-rec-start${off}>${icon('play', { size: 14 })}Record</button>
    </div>
    <div class="form-row">
      <input data-rec-login-name maxlength="60" placeholder="Tên phiên mới (vd: admin)" aria-label="Tên phiên đăng nhập mới">
      <button type="button" data-rec-login${off} title="Mở trình duyệt để đăng nhập (hoặc chuẩn bị sẵn trạng thái), rồi lưu phiên cho các lần Record sau">${icon('lock', { size: 14 })}Đăng nhập trước</button>
    </div>
    <div class="form-row">
      <textarea data-rec-cookie rows="2" autocomplete="off" spellcheck="false" placeholder="Hoặc dán chuỗi Cookie từ DevTools (name=value; name2=value2)" aria-label="Chuỗi Cookie"></textarea>
      <input data-rec-link maxlength="2000" autocomplete="off" placeholder="Link đăng nhập một lần (tuỳ chọn)" aria-label="Link đăng nhập một lần">
      <button type="button" data-rec-prepare title="Dựng phiên từ cookie và/hoặc link, không mở cửa sổ đăng nhập, không dùng AI">${icon('lock', { size: 14 })}Lưu phiên từ cookie / link</button>
    </div>
    <div class="form-row">
      <textarea data-rec-ai-prompt rows="3" autocomplete="off" spellcheck="false" placeholder="Hoặc nhờ AI chuẩn bị: vd &quot;Đăng nhập bằng {{E2E_ADMIN_USER}} / {{E2E_ADMIN_PASSWORD}}, rồi mở mục Cài đặt&quot;" aria-label="Prompt cho AI chuẩn bị phiên"></textarea>
      <button type="button" data-rec-prepare-ai title="AI làm theo prompt trong trình duyệt ẩn rồi lưu phiên (tốn token)">${icon('sparkles', { size: 14 })}Nhờ AI chuẩn bị phiên</button>
    </div>
    ${status.reason ? `<p class="muted small" data-rec-reason>${escapeHtml(status.reason)}</p>` : ''}
    ${status.state === 'failed' ? `<p class="error" role="alert">${escapeHtml(status.error ?? 'Phiên record lỗi')}</p>` : ''}
    <p class="muted small">Lấy cookie: DevTools → Network → chọn một request tới site (đã đăng nhập) → Request Headers → <code>Cookie</code> → copy giá trị. Dùng ô <em>Tên phiên mới</em> và URL ở trên; cookie áp dụng cho đúng tên miền của URL. Link đăng nhập một lần được mở bằng trình duyệt ẩn rồi lưu phiên. Cookie và link chỉ xử lý trên máy này, không gửi cho AI, và ô dán được xoá sau khi lưu.</p>
    <p class="muted small">Nhờ AI chuẩn bị: viết việc cần làm (đăng nhập, mở sẵn một mục…) bằng lời. Tài khoản, mật khẩu, token viết dạng <code>{{E2E_TÊN}}</code> (vd <code>{{E2E_ADMIN_PASSWORD}}</code>) và đặt giá trị trong <code>.env</code> của project hoặc môi trường: AI chỉ thấy tên, không bao giờ thấy giá trị. Cần đã bật AI cho runner e2e (Cài đặt → AI); mỗi lần tốn token, tối đa 3 phút.</p>
    <p class="muted small">Trang cần đăng nhập (SSO, OTP, captcha): bấm <em>Đăng nhập trước</em>, đăng nhập xong thì <em>Xong, lưu phiên</em>, rồi chọn phiên đó ở trên trước khi Record. File phiên chứa cookie / token, nằm ở <code>.e2e-dashboard/auth/</code> (không commit); test dùng phiên chỉ chạy được trên máy có file đó.</p>
    <p class="muted small">Trình duyệt Record mở kèm cửa sổ Inspector: bấm nút assert ở đó để thêm kiểm tra. Đóng cửa sổ trình duyệt hoặc bấm Dừng để kết thúc.</p>
  </section>`;
}

function recRecordingHtml(status) {
  if (status.kind === 'login') {
    return `<section class="panel"><h2><span class="chip tone-bad">Đang đăng nhập</span> ${escapeHtml(status.name ?? '')}</h2>
    <p class="muted small">${escapeHtml(status.url ?? '')}</p>
    <p class="muted small">Đăng nhập trong cửa sổ trình duyệt vừa mở (có thể chuẩn bị thêm trạng thái cần có). Xong thì bấm nút bên dưới: cookie và localStorage được lưu thành phiên.</p>
    <div class="tc-actions"><button type="button" class="primary" data-rec-stop>${icon('check', { size: 14 })}Xong, lưu phiên</button></div>
  </section>`;
  }
  return `<section class="panel"><h2><span class="chip tone-bad">Đang ghi</span> ${escapeHtml(status.name ?? '')}</h2>
    <p class="muted small">${escapeHtml(status.url ?? '')}${status.auth ? ` · phiên <code>${escapeHtml(status.auth)}</code>` : ''}</p>
    <p class="muted small">Thao tác trong cửa sổ trình duyệt vừa mở. Xong thì đóng cửa sổ đó hoặc bấm Dừng.</p>
    <div class="tc-actions"><button type="button" class="primary" data-rec-stop>${icon('stop', { size: 14 })}Dừng</button></div>
  </section>`;
}

function recEditorHtml(ed) {
  return `<section class="panel tc-editor"><h2>${icon('file', { size: 15 })} Testcase vừa ghi <span class="chip">${ed.testcases.length} testcase</span></h2>
    <label class="tc-field"><span class="tc-label">Tên bộ test <span class="muted">· file lưu ở <code>tests/recorded/&lt;tên&gt;.spec.ts</code></span></span>
      <input data-rec-name value="${escapeHtml(ed.name)}" maxlength="200" aria-label="Tên bộ test"></label>
    ${ed.aiError ? `<p class="error" data-rec-ai-error role="alert">AI chưa sinh được kết quả mong đợi (${escapeHtml(ed.aiError)}): hãy điền tay.</p>` : ''}
    ${recSecretsNote(ed.secrets)}
    ${tcCardsHtml(ed.testcases)}
    <div class="tc-actions">
      <button type="button" data-tc-add>${icon('plus', { size: 14 })}<span class="tc-btn-text">Thêm testcase</span></button>
      <span class="tc-spacer"></span>
      <button type="button" data-rec-discard>${icon('close', { size: 14 })}<span class="tc-btn-text">Bỏ</span></button>
      <button type="button" class="primary" data-rec-save>${icon('check', { size: 14 })}<span class="tc-btn-text">Lưu</span></button>
    </div></section>`;
}

function recSavedHtml(sv) {
  return `<section class="panel"><h2>${icon('check', { size: 15 })} Đã lưu</h2>
    <p><code>${escapeHtml(sv.specPath)}</code><br><code>${escapeHtml(sv.casesPath)}</code></p>
    ${recSecretsNote(sv.secrets)}
    ${sv.e2ePath
    ? `<p>Đã tạo <code>${escapeHtml(sv.e2ePath)}</code></p>`
    : `<div class="tc-actions"><button type="button" data-gen-e2e title="AI chuyển testcase đã lưu sang file *.e2e.ts">${icon('bolt', { size: 14 })}<span class="tc-btn-text">AI Gen e2e</span></button></div>`}
  </section>`;
}

// Thuần: dựng HTML theo trạng thái phiên record, testcase đang sửa, kết quả lưu và danh sách phiên đăng nhập đã lưu
export function recordViewHtml({ status, editing, saved, auth = [] }) {
  const top = status.state === 'recording' ? recRecordingHtml(status) : editing ? '' : recFormHtml(status, auth);
  return `${top}${editing ? recEditorHtml(editing) : ''}${saved ? recSavedHtml(saved) : ''}`;
}

// Thuần: phiên record vừa xong và chưa có testcase / kết quả lưu, và không có lượt analyze nào đang chạy (mỗi lượt là một lần gọi AI).
// Phiên đăng nhập không có gì để phân tích.
export const recNeedsAnalyze = ({ status, editing, saved, analyzing }) => status.state === 'done' && status.kind !== 'login' && !editing && !saved && !analyzing;

// Thuần: khoá so sánh trạng thái phiên; poll nền chỉ vẽ lại trang khi khoá đổi
export const recStatusKey = (s) => [s.state, s.kind ?? '', s.id ?? '', s.auth ?? '', s.error ?? '', s.canRecord, s.reason ?? ''].join('|');

// Thuần: vào lại trang thì giữ testcase đang sửa chừng nào phiên trên server còn `done`
export const recKeepEditing = (status, editing) => (status.state === 'done' ? editing : null);

// Gọi API với nút tạm khoá; lỗi hiện toast (bỏ tiền tố mã HTTP như các trang khác)
async function recBusy(btn, fn) {
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    return await fn();
  } catch (x) {
    toast(x.message.replace(/^\d{3}: /, ''), 'bad');
    return null;
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}

export async function renderRecord(main) {
  recSaved = null;
  let status = await getJson('/api/record/status');
  recEditing = recKeepEditing(status, recEditing);
  let authList = [];
  let timer = null;
  let analyzing = false;
  let preferAuth = null; // phiên vừa lưu: chọn sẵn trong ô chọn phiên sau khi vẽ
  const loadAuth = async () => {
    try {
      authList = (await getJson('/api/record/auth', { quiet: true })).sessions ?? [];
    } catch {
      authList = [];
    }
  };
  const draw = () => {
    const keep = REC_FIELDS.map((q) => main.querySelector(q)?.value ?? '');
    main.innerHTML = `${pageHead('Record', 'video', 'Ghi lại thao tác trên trình duyệt thật: dashboard đổi thành testcase và file test.')}${recordViewHtml({ status, editing: recEditing, saved: recSaved, auth: authList })}`;
    REC_FIELDS.forEach((q, i) => {
      const el = main.querySelector(q);
      if (el && keep[i]) el.value = keep[i];
    });
    if (preferAuth) {
      const sel = main.querySelector('[data-rec-auth]');
      if (sel) sel.value = preferAuth;
      preferAuth = null;
    }
  };
  // làm mới trạng thái; phiên record vừa xong thì nhờ AI sinh testcase + expected
  const settle = async ({ quiet = false } = {}) => {
    const before = recStatusKey(status);
    let changed = false;
    status = await getJson('/api/record/status', { quiet });
    if (status.state !== 'recording' && timer) {
      clearInterval(timer);
      timer = null;
    }
    if (status.state === 'done' && status.kind === 'login') {
      toast(`Đã lưu phiên đăng nhập "${status.auth}"`);
      preferAuth = status.auth;
      await postJson('/api/record/discard', {}).catch(() => {});
      status = await getJson('/api/record/status', { quiet: true });
      await loadAuth();
      changed = true;
    }
    if (recNeedsAnalyze({ status, editing: recEditing, saved: recSaved, analyzing })) {
      analyzing = true;
      changed = true;
      try {
        const r = await postJson('/api/record/analyze', {});
        if (!recEditing) recEditing = r; // người dùng đã sửa trong lúc chờ AI thì không ghi đè
        if (r.aiError) toast('AI chưa sinh được kết quả mong đợi, hãy điền tay', 'warn');
      } catch (x) {
        toast(x.message.replace(/^\d{3}: /, ''), 'bad');
      } finally {
        analyzing = false;
      }
    }
    if (quiet && !changed && recStatusKey(status) === before) return; // poll nền không có gì mới: không vẽ lại trang
    draw();
  };
  const watch = () => {
    if (!timer) timer = setInterval(() => settle({ quiet: true }).catch(() => {}), REC_POLL_MS);
  };
  const editedName = () => main.querySelector('[data-rec-name]')?.value ?? recEditing?.name ?? '';
  const formValue = (q) => main.querySelector(q)?.value.trim() ?? '';

  main.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn || !main.contains(btn)) return;
    if (btn.hasAttribute('data-rec-start')) {
      const body = { url: formValue('[data-rec-url]'), name: formValue('[data-rec-name-new]') };
      const auth = formValue('[data-rec-auth]');
      if (auth) body.auth = auth;
      const r = await recBusy(btn, () => postJson('/api/record/start', body));
      if (r) {
        recEditing = null;
        recSaved = null;
        watch();
        await settle();
      }
      return;
    }
    if (btn.hasAttribute('data-rec-login')) {
      const r = await recBusy(btn, () => postJson('/api/record/login', { url: formValue('[data-rec-url]'), name: formValue('[data-rec-login-name]') }));
      if (r) {
        recEditing = null;
        recSaved = null;
        watch();
        await settle();
      }
      return;
    }
    if (btn.hasAttribute('data-rec-prepare')) {
      const body = { name: formValue('[data-rec-login-name]'), url: formValue('[data-rec-url]'), cookie: main.querySelector('[data-rec-cookie]')?.value ?? '', link: formValue('[data-rec-link]') };
      const r = await recBusy(btn, () => postJson('/api/record/prepare', body));
      if (r) {
        authList = r.sessions ?? [];
        preferAuth = r.name;
        for (const q of ['[data-rec-cookie]', '[data-rec-link]']) main.querySelector(q).value = ''; // cookie không nằm lại trong trang
        toast(`Đã lưu phiên "${r.name}"`);
      }
      return draw();
    }
    if (btn.hasAttribute('data-rec-prepare-ai')) {
      const body = { name: formValue('[data-rec-login-name]'), url: formValue('[data-rec-url]'), prompt: main.querySelector('[data-rec-ai-prompt]')?.value ?? '' };
      if (!body.prompt.trim()) return toast('Viết prompt cho AI trước', 'warn');
      if (!(await confirmDialog({ title: 'Nhờ AI chuẩn bị phiên', message: `AI sẽ điều khiển một trình duyệt ẩn tới ${body.url || 'URL đã nhập'} theo prompt của bạn rồi lưu phiên "${body.name || '…'}". Việc này tốn token và có thể mất vài phút.`, confirmLabel: 'Chạy' }))) return;
      const r = await recBusy(btn, () => postJson('/api/record/prepare-ai', body));
      if (r) {
        authList = r.sessions ?? [];
        preferAuth = r.name;
        toast(`Đã lưu phiên "${r.name}"`);
      }
      return draw();
    }
    if (btn.hasAttribute('data-rec-auth-del')) {
      const name = formValue('[data-rec-auth]');
      if (!name) return toast('Chọn phiên cần xoá ở ô chọn phiên', 'warn');
      if (!(await confirmDialog({ title: 'Xoá phiên đăng nhập', message: `Xoá phiên "${name}"? Spec đã lưu dùng phiên này sẽ không chạy được cho đến khi đăng nhập lại.`, confirmLabel: 'Xoá phiên' }))) return;
      const r = await recBusy(btn, () => postJson('/api/record/auth/delete', { name }));
      if (r) {
        authList = r.sessions ?? [];
        toast(`Đã xoá phiên "${name}"`);
      }
      return draw();
    }
    if (btn.hasAttribute('data-rec-stop')) {
      await recBusy(btn, () => postJson('/api/record/stop', {}));
      return settle();
    }
    if (!recEditing && !recSaved) return;
    if (btn.hasAttribute('data-tc-add') && recEditing) {
      recEditing = { ...recEditing, name: editedName(), testcases: [...readTcCards(main), { title: '', steps: [''], expected: '' }] };
      return draw();
    }
    if (btn.dataset.tcDel !== undefined && recEditing) {
      recEditing = { ...recEditing, name: editedName(), testcases: readTcCards(main).filter((_t, k) => k !== Number(btn.dataset.tcDel)) };
      return draw();
    }
    if (btn.hasAttribute('data-rec-discard')) {
      await recBusy(btn, () => postJson('/api/record/discard', {}));
      recEditing = null;
      return settle();
    }
    if (btn.hasAttribute('data-rec-save') && recEditing) {
      const testcases = readTcCards(main);
      const name = editedName().trim();
      const r = await recBusy(btn, () => postJson('/api/record/save', { testcases, name }));
      if (r) {
        recSaved = { ...r, slug: r.specPath.replace(/^.*\//, '').replace(/\.spec\.ts$/, ''), e2ePath: null };
        recEditing = null;
        toast(`Đã lưu ${r.specPath}`);
        return settle();
      }
      recEditing = { ...recEditing, name, testcases }; // lỗi (vd trùng tên): giữ nguyên phần đang sửa để đổi tên rồi lưu lại
      return draw();
    }
    if (btn.hasAttribute('data-gen-e2e') && recSaved) {
      const r = await recBusy(btn, () => postJson('/api/record/gen-e2e', { slug: recSaved.slug }));
      if (r) {
        recSaved = { ...recSaved, e2ePath: r.saved };
        toast(`Đã tạo ${r.saved}`);
      }
      return draw();
    }
  });

  await loadAuth();
  if (status.state === 'recording') watch();
  await settle();
  return () => {
    if (timer) clearInterval(timer);
  };
}
