import { getJson, postJson } from '../api.js';
import { pageHead } from '../analysis.js';
import { toast } from '../toast.js';
import { confirmDialog } from '../confirm.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';
import { tcCardsHtml, readTcCards } from './linear-issues.js';

// Trang Record, 3 bước: (1) trang cần test → (2) phiên đăng nhập, tuỳ chọn (dùng phiên đã lưu hoặc tạo mới bằng đăng nhập thủ công /
// cookie + link / nhờ AI) → (3) Record: ghi thao tác bằng codegen → testcase (AI sinh expected) → sửa → lưu .spec.ts → tuỳ chọn AI Gen e2e.
// Trạng thái đang sửa / vừa lưu / phiên đang chọn / tab nằm ở biến module; đổi trang thì dựng lại từ đầu.
let recEditing = null; // { name, url, slug, secrets, aiError?, testcases }
let recSaved = null; // { specPath, casesPath, secrets, slug, e2ePath }
let recAuthPick = null; // tên phiên đăng nhập dùng cho lần Record này
let recTab = 'manual'; // cách tạo phiên đang mở: manual | cookie | ai
let recNewOpen = false; // mục "Tạo phiên mới" đang mở
const REC_POLL_MS = 1500;
// ô của form: giữ giá trị khi trang vẽ lại (poll, xong phiên đăng nhập…)
const REC_FIELDS = ['[data-rec-url]', '[data-rec-name-new]', '[data-rec-login-name]', '[data-rec-cookie]', '[data-rec-link]', '[data-rec-ai-prompt]'];
const REC_TABS = [['manual', 'Đăng nhập thủ công', 'lock'], ['cookie', 'Cookie / link', 'copy'], ['ai', 'Nhờ AI', 'sparkles']];

const recSecretsNote = (secrets) => (secrets?.length
  ? `<p class="muted small" data-rec-secrets>Giá trị nhạy cảm đã được thay bằng biến môi trường ${secrets.map((s) => `<code>${escapeHtml(s)}</code>`).join(', ')}. Đặt giá trị của chúng trong <code>.env</code> hoặc môi trường trước khi chạy test.</p>`
  : '');

// "19/10/2026 15:03" theo giờ máy; ngày không hợp lệ thì để trống
const recWhen = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : escapeHtml(d.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }));
};

function recSessionsHtml(auth, pick) {
  if (!auth.length) return '<p class="muted small rec-empty">Chưa có phiên nào. Tạo phiên mới bên dưới nếu trang cần đăng nhập.</p>';
  const chips = auth.map((a) => {
    const on = a.name === pick;
    const n = escapeHtml(a.name);
    const when = recWhen(a.savedAt);
    return `<span class="rec-chip"><button type="button" class="keep-label" data-rec-auth-pick="${n}" aria-pressed="${on}" title="${on ? 'Đang dùng cho lần Record này, bấm để bỏ chọn' : 'Dùng phiên này cho lần Record này'}${when ? ` · lưu lúc ${when}` : ''}">${on ? icon('check', { size: 13 }) : ''}${n}</button><button type="button" class="icon-btn" data-rec-auth-del="${n}" aria-label="Xoá phiên ${n}" title="Xoá phiên này">${icon('close', { size: 12 })}</button></span>`;
  }).join('');
  return `<div class="rec-sessions" role="group" aria-label="Phiên đã lưu">${chips}</div><p class="muted small">Bấm một phiên để dùng cho lần Record này, bấm lại để bỏ chọn.</p>`;
}

function recNewSessionHtml(ui) {
  const off = ui.canRecord ? '' : ' disabled';
  const tabs = REC_TABS.map(([id, label, ic]) => `<button type="button" role="tab" class="keep-label" data-rec-tab="${id}" aria-selected="${ui.tab === id}" aria-controls="rec-panel-${id}" id="rec-tab-${id}">${icon(ic, { size: 14 })}${label}</button>`).join('');
  const panel = (id, body) => `<div class="rec-panel" role="tabpanel" id="rec-panel-${id}" data-rec-panel="${id}" aria-labelledby="rec-tab-${id}"${ui.tab === id ? '' : ' hidden'}>${body}</div>`;
  return `<details class="rec-new" data-rec-new${ui.newOpen ? ' open' : ''}>
    <summary>Tạo phiên mới</summary>
    <div class="rec-new-body">
      <label class="rec-field rec-narrow"><span>Tên phiên</span><input data-rec-login-name maxlength="60" placeholder="vd: admin" autocomplete="off" spellcheck="false"></label>
      <div class="seg-btns tabbar" role="tablist" aria-label="Cách tạo phiên">${tabs}</div>
      ${panel('manual', `<p class="muted small">Mở một trình duyệt tới URL ở bước 1. Bạn đăng nhập (và chuẩn bị sẵn trạng thái cần có), rồi bấm <em>Xong, lưu phiên</em>.</p>
        <div class="rec-actions"><button type="button" class="keep-label" data-rec-login${off}>${icon('lock', { size: 14 })}Mở trình duyệt để đăng nhập</button></div>`)}
      ${panel('cookie', `<label class="rec-field"><span>Chuỗi Cookie</span><textarea data-rec-cookie rows="3" autocomplete="off" spellcheck="false" placeholder="name=value; name2=value2"></textarea><small class="muted">DevTools → Network → chọn một request tới site đã đăng nhập → Request Headers → <code>Cookie</code> → copy giá trị. Cookie áp dụng cho đúng tên miền của URL.</small></label>
        <label class="rec-field"><span>Link đăng nhập một lần <em class="muted">(tuỳ chọn)</em></span><input data-rec-link maxlength="2000" autocomplete="off" spellcheck="false" placeholder="https://…/magic?token=…"><small class="muted">Được mở bằng trình duyệt ẩn (kèm cookie ở trên nếu có) rồi lưu phiên.</small></label>
        <div class="rec-actions"><button type="button" class="keep-label" data-rec-prepare title="Dựng phiên từ cookie và/hoặc link, không dùng AI">${icon('lock', { size: 14 })}Lưu phiên từ cookie / link</button></div>`)}
      ${panel('ai', `<label class="rec-field"><span>Việc AI cần làm</span><textarea data-rec-ai-prompt rows="4" autocomplete="off" spellcheck="false" placeholder="Đăng nhập bằng {{E2E_ADMIN_USER}} / {{E2E_ADMIN_PASSWORD}}, rồi mở mục Cài đặt"></textarea><small class="muted">Tài khoản, mật khẩu viết dạng <code>{{E2E_TÊN}}</code> và đặt giá trị trong <code>.env</code> của project hoặc môi trường: AI chỉ thấy tên, không thấy giá trị. Cần bật AI cho runner e2e (Cài đặt → AI). Mỗi lần tốn token, tối đa 3 phút.</small></label>
        <div class="rec-actions"><button type="button" class="keep-label" data-rec-prepare-ai title="AI làm theo prompt trong trình duyệt ẩn rồi lưu phiên (tốn token)">${icon('sparkles', { size: 14 })}Nhờ AI chuẩn bị phiên</button></div>`)}
    </div>
  </details>`;
}

function recFormHtml(status, auth, ui) {
  const pick = auth.some((a) => a.name === ui.authPick) ? ui.authPick : null;
  return `<section class="panel rec-card">
    <header class="rec-step"><span class="rec-no" aria-hidden="true">1</span><div><h2>Trang cần test</h2><p class="muted small">Địa chỉ trang bắt đầu và tên cho bộ test sẽ lưu.</p></div></header>
    <div class="rec-grid">
      <label class="rec-field"><span>URL trang</span><input data-rec-url maxlength="500" placeholder="https://app.example.com" autocomplete="off" spellcheck="false"></label>
      <label class="rec-field"><span>Tên bộ test</span><input data-rec-name-new maxlength="200" placeholder="Đăng nhập, Giỏ hàng…" autocomplete="off"></label>
    </div>
  </section>
  <section class="panel rec-card">
    <header class="rec-step"><span class="rec-no" aria-hidden="true">2</span><div><h2>Phiên đăng nhập <span class="chip rec-optional">tuỳ chọn</span></h2><p class="muted small">Trang cần đăng nhập (SSO, OTP, captcha)? Dùng một phiên đã lưu để Record bắt đầu khi đã đăng nhập.</p></div></header>
    ${recSessionsHtml(auth, pick)}
    ${recNewSessionHtml({ ...ui, canRecord: status.canRecord })}
  </section>
  <section class="panel rec-card rec-go">
    <header class="rec-step"><span class="rec-no" aria-hidden="true">3</span><div><h2>Ghi thao tác</h2><p class="muted small">Trình duyệt mở kèm cửa sổ Inspector: bấm nút assert ở đó để thêm kiểm tra. Đóng cửa sổ trình duyệt hoặc bấm Dừng để kết thúc.</p></div></header>
    <div class="rec-actions"><button type="button" class="primary keep-label rec-start" data-rec-start${status.canRecord ? '' : ' disabled'}>${icon('play', { size: 15 })}Bắt đầu Record${pick ? ` với phiên ${escapeHtml(pick)}` : ''}</button></div>
    ${status.reason ? `<p class="muted small" data-rec-reason>${escapeHtml(status.reason)}</p>` : ''}
    ${status.state === 'failed' ? `<p class="error" role="alert">${escapeHtml(status.error ?? 'Phiên record lỗi')}</p>` : ''}
    <details class="rec-note"><summary>Lưu ý về phiên đăng nhập</summary><p class="muted small">File phiên chứa cookie / token, nằm ở <code>.e2e-dashboard/auth/</code> (không commit). Spec lưu từ phiên chỉ chạy được trên máy có file đó; phiên hết hạn thì tạo lại cùng tên để ghi đè.</p></details>
  </section>`;
}

function recRecordingHtml(status) {
  if (status.kind === 'login') {
    return `<section class="panel rec-card"><h2><span class="chip tone-bad">Đang đăng nhập</span> ${escapeHtml(status.name ?? '')}</h2>
    <p class="muted small">${escapeHtml(status.url ?? '')}</p>
    <p class="muted small">Đăng nhập trong cửa sổ trình duyệt vừa mở (có thể chuẩn bị thêm trạng thái cần có). Xong thì bấm nút bên dưới: cookie và localStorage được lưu thành phiên.</p>
    <div class="rec-actions"><button type="button" class="primary keep-label" data-rec-stop>${icon('check', { size: 14 })}Xong, lưu phiên</button></div>
  </section>`;
  }
  return `<section class="panel rec-card"><h2><span class="chip tone-bad">Đang ghi</span> ${escapeHtml(status.name ?? '')}</h2>
    <p class="muted small">${escapeHtml(status.url ?? '')}${status.auth ? ` · phiên <code>${escapeHtml(status.auth)}</code>` : ''}</p>
    <p class="muted small">Thao tác trong cửa sổ trình duyệt vừa mở. Xong thì đóng cửa sổ đó hoặc bấm Dừng.</p>
    <div class="rec-actions"><button type="button" class="primary keep-label" data-rec-stop>${icon('stop', { size: 14 })}Dừng</button></div>
  </section>`;
}

function recEditorHtml(ed) {
  return `<section class="panel tc-editor rec-card"><h2>${icon('file', { size: 15 })} Testcase vừa ghi <span class="chip">${ed.testcases.length} testcase</span></h2>
    <label class="rec-field rec-narrow"><span>Tên bộ test <small class="muted">· lưu ở <code>tests/recorded/&lt;tên&gt;.spec.ts</code></small></span>
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
  return `<section class="panel rec-card"><h2>${icon('check', { size: 15 })} Đã lưu</h2>
    <p><code>${escapeHtml(sv.specPath)}</code><br><code>${escapeHtml(sv.casesPath)}</code></p>
    ${recSecretsNote(sv.secrets)}
    ${sv.e2ePath
    ? `<p>Đã tạo <code>${escapeHtml(sv.e2ePath)}</code></p>`
    : `<div class="rec-actions"><button type="button" class="keep-label" data-gen-e2e title="AI chuyển testcase đã lưu sang file *.e2e.ts">${icon('bolt', { size: 14 })}AI Gen e2e</button></div>`}
  </section>`;
}

// Thuần: dựng HTML theo trạng thái phiên record, testcase đang sửa, kết quả lưu, phiên đăng nhập đã lưu (auth), phiên đang chọn (authPick),
// tab cách tạo phiên (tab) và việc mục "Tạo phiên mới" đang mở (newOpen)
export function recordViewHtml({ status, editing, saved, auth = [], authPick = null, tab = 'manual', newOpen = false }) {
  const top = status.state === 'recording' ? recRecordingHtml(status) : editing ? '' : recFormHtml(status, auth, { authPick, tab, newOpen });
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
  recAuthPick = null;
  let status = await getJson('/api/record/status');
  recEditing = recKeepEditing(status, recEditing);
  let authList = [];
  let timer = null;
  let analyzing = false;
  const loadAuth = async () => {
    try {
      authList = (await getJson('/api/record/auth', { quiet: true })).sessions ?? [];
    } catch {
      authList = [];
    }
  };
  const draw = () => {
    const keep = REC_FIELDS.map((q) => main.querySelector(q)?.value ?? '');
    main.innerHTML = `${pageHead('Record', 'video', 'Ghi lại thao tác trên trình duyệt thật: dashboard đổi thành testcase và file test.')}${recordViewHtml({ status, editing: recEditing, saved: recSaved, auth: authList, authPick: recAuthPick, tab: recTab, newOpen: recNewOpen })}`;
    REC_FIELDS.forEach((q, i) => {
      const el = main.querySelector(q);
      if (el && keep[i]) el.value = keep[i];
    });
  };
  // phiên vừa lưu thì chọn sẵn cho lần Record này
  const savedSession = (name) => {
    recAuthPick = name;
    toast(`Đã lưu phiên "${name}"`);
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
      savedSession(status.auth);
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
  const startedSession = async (r) => {
    if (!r) return;
    recEditing = null;
    recSaved = null;
    watch();
    await settle();
  };

  // <details> không nổi bọt sự kiện toggle: bắt ở pha capture để nhớ trạng thái mở
  main.addEventListener('toggle', (e) => {
    if (e.target.matches?.('[data-rec-new]')) recNewOpen = e.target.open;
  }, true);

  main.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn || !main.contains(btn)) return;
    if (btn.hasAttribute('data-rec-tab')) {
      recTab = btn.getAttribute('data-rec-tab');
      recNewOpen = true;
      return draw();
    }
    if (btn.hasAttribute('data-rec-auth-pick')) {
      const name = btn.getAttribute('data-rec-auth-pick');
      recAuthPick = recAuthPick === name ? null : name;
      return draw();
    }
    if (btn.hasAttribute('data-rec-start')) {
      const body = { url: formValue('[data-rec-url]'), name: formValue('[data-rec-name-new]') };
      if (recAuthPick && authList.some((a) => a.name === recAuthPick)) body.auth = recAuthPick;
      return startedSession(await recBusy(btn, () => postJson('/api/record/start', body)));
    }
    if (btn.hasAttribute('data-rec-login')) {
      return startedSession(await recBusy(btn, () => postJson('/api/record/login', { url: formValue('[data-rec-url]'), name: formValue('[data-rec-login-name]') })));
    }
    if (btn.hasAttribute('data-rec-prepare')) {
      const body = { name: formValue('[data-rec-login-name]'), url: formValue('[data-rec-url]'), cookie: main.querySelector('[data-rec-cookie]')?.value ?? '', link: formValue('[data-rec-link]') };
      const r = await recBusy(btn, () => postJson('/api/record/prepare', body));
      if (r) {
        authList = r.sessions ?? [];
        savedSession(r.name);
        for (const q of ['[data-rec-cookie]', '[data-rec-link]']) main.querySelector(q).value = ''; // cookie không nằm lại trong trang
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
        savedSession(r.name);
      }
      return draw();
    }
    if (btn.hasAttribute('data-rec-auth-del')) {
      const name = btn.getAttribute('data-rec-auth-del');
      if (!(await confirmDialog({ title: 'Xoá phiên đăng nhập', message: `Xoá phiên "${name}"? Spec đã lưu dùng phiên này sẽ không chạy được cho đến khi đăng nhập lại.`, confirmLabel: 'Xoá phiên' }))) return;
      const r = await recBusy(btn, () => postJson('/api/record/auth/delete', { name }));
      if (r) {
        authList = r.sessions ?? [];
        if (recAuthPick === name) recAuthPick = null;
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
