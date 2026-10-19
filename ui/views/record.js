import { getJson, postJson } from '../api.js';
import { pageHead } from '../analysis.js';
import { toast } from '../toast.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';
import { tcCardsHtml, readTcCards } from './linear-issues.js';

// Trang Record: ghi thao tác bằng codegen → testcase (AI sinh expected) → sửa → lưu .spec.ts → tuỳ chọn AI Gen e2e.
// Trạng thái đang sửa / vừa lưu nằm ở biến module; đổi trang thì trang mới dựng lại từ đầu.
let recEditing = null; // { name, url, slug, secrets, aiError?, testcases }
let recSaved = null; // { specPath, casesPath, secrets, slug, e2ePath }
const REC_POLL_MS = 1500;

const recSecretsNote = (secrets) => (secrets?.length
  ? `<p class="muted small" data-rec-secrets>Giá trị nhạy cảm đã được thay bằng biến môi trường ${secrets.map((s) => `<code>${escapeHtml(s)}</code>`).join(', ')}. Đặt giá trị của chúng trong <code>.env</code> hoặc môi trường trước khi chạy test.</p>`
  : '');

function recFormHtml(status) {
  return `<section class="panel"><h2>${icon('video', { size: 15 })} Ghi thao tác mới</h2>
    <div class="form-row">
      <input data-rec-url maxlength="500" placeholder="https://app.example.com" aria-label="URL cần ghi">
      <input data-rec-name-new maxlength="200" placeholder="Tên bộ test (vd: Đăng nhập)" aria-label="Tên bộ test">
      <button type="button" class="primary" data-rec-start${status.canRecord ? '' : ' disabled'}>${icon('play', { size: 14 })}Record</button>
    </div>
    ${status.reason ? `<p class="muted small" data-rec-reason>${escapeHtml(status.reason)}</p>` : ''}
    ${status.state === 'failed' ? `<p class="error" role="alert">${escapeHtml(status.error ?? 'Phiên record lỗi')}</p>` : ''}
    <p class="muted small">Trình duyệt mở kèm cửa sổ Inspector: bấm nút assert ở đó để thêm kiểm tra. Đóng cửa sổ trình duyệt hoặc bấm Dừng để kết thúc.</p>
  </section>`;
}

function recRecordingHtml(status) {
  return `<section class="panel"><h2><span class="chip tone-bad">Đang ghi</span> ${escapeHtml(status.name ?? '')}</h2>
    <p class="muted small">${escapeHtml(status.url ?? '')}</p>
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

// Thuần: dựng HTML theo trạng thái phiên record, testcase đang sửa và kết quả lưu
export function recordViewHtml({ status, editing, saved }) {
  const top = status.state === 'recording' ? recRecordingHtml(status) : editing ? '' : recFormHtml(status);
  return `${top}${editing ? recEditorHtml(editing) : ''}${saved ? recSavedHtml(saved) : ''}`;
}

// Thuần: phiên vừa xong và chưa có testcase / kết quả lưu, và không có lượt analyze nào đang chạy (mỗi lượt là một lần gọi AI)
export const recNeedsAnalyze = ({ status, editing, saved, analyzing }) => status.state === 'done' && !editing && !saved && !analyzing;

// Thuần: khoá so sánh trạng thái phiên; poll nền chỉ vẽ lại trang khi khoá đổi
export const recStatusKey = (s) => [s.state, s.id ?? '', s.error ?? '', s.canRecord, s.reason ?? ''].join('|');

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
  let timer = null;
  let analyzing = false;
  const draw = () => {
    main.innerHTML = `${pageHead('Record', 'video', 'Ghi lại thao tác trên trình duyệt thật: dashboard đổi thành testcase và file test.')}${recordViewHtml({ status, editing: recEditing, saved: recSaved })}`;
  };
  // làm mới trạng thái; phiên vừa xong thì nhờ AI sinh testcase + expected
  const settle = async ({ quiet = false } = {}) => {
    const before = recStatusKey(status);
    let analyzed = false;
    status = await getJson('/api/record/status', { quiet });
    if (status.state !== 'recording' && timer) {
      clearInterval(timer);
      timer = null;
    }
    if (recNeedsAnalyze({ status, editing: recEditing, saved: recSaved, analyzing })) {
      analyzing = true;
      analyzed = true;
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
    if (quiet && !analyzed && recStatusKey(status) === before) return; // poll nền không có gì mới: không vẽ lại trang
    draw();
  };
  const watch = () => {
    if (!timer) timer = setInterval(() => settle({ quiet: true }).catch(() => {}), REC_POLL_MS);
  };
  const editedName = () => main.querySelector('[data-rec-name]')?.value ?? recEditing?.name ?? '';

  main.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn || !main.contains(btn)) return;
    if (btn.hasAttribute('data-rec-start')) {
      const url = main.querySelector('[data-rec-url]').value.trim();
      const name = main.querySelector('[data-rec-name-new]').value.trim();
      const r = await recBusy(btn, () => postJson('/api/record/start', { url, name }));
      if (r) {
        recEditing = null;
        recSaved = null;
        watch();
        await settle();
      }
      return;
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

  if (status.state === 'recording') watch();
  await settle();
  return () => {
    if (timer) clearInterval(timer);
  };
}
