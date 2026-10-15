import { getJson, postJson } from '../api.js';
import { pageHead, emptyBox } from '../analysis.js';
import { toast } from '../toast.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';

// Issue Linear được giao cho các email đã chọn (Cài đặt → Tích hợp): phân tích bằng AI, sửa testcase, Gen file e2e.
// Trạng thái đang sửa testcase nằm trong `liEditing`; đổi trang thì trang mới dựng lại từ đầu.
let liEditing = null; // { identifier, testcases }

const liStateOf = (i) => (i.generatedPath ? 'Đã Gen' : i.testcases?.length ? 'Đã có testcase' : 'Chưa phân tích');
const LI_TONE = { 'Đã Gen': 'good', 'Đã có testcase': 'warn', 'Chưa phân tích': 'muted' };
const liIssueLink = (i) => (i.url && /^https:\/\/linear\.app\//.test(i.url) ? `<a href="${escapeHtml(i.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(i.identifier)}</a>` : escapeHtml(i.identifier));

function liIssuesTable(items) {
  return `<section class="panel"><div class="table-wrap"><table class="table">
    <thead><tr><th>Issue</th><th>Tiêu đề</th><th>Status</th><th>Người giao</th><th>Trạng thái</th><th></th></tr></thead>
    <tbody>${items.map((i) => {
      const s = liStateOf(i);
      return `<tr><td>${liIssueLink(i)}</td><td>${escapeHtml(i.title)}</td><td>${escapeHtml(i.state)}</td><td class="muted small">${escapeHtml(i.assignee)}</td>
        <td><span class="chip tone-${LI_TONE[s]}">${s}</span></td>
        <td><button type="button" class="small-btn" data-open="${escapeHtml(i.identifier)}"${i.testcases?.length ? '' : ' hidden'}>${icon('ticket', { size: 13 })}Mở testcase</button>
          <button type="button" class="small-btn" data-analyze="${escapeHtml(i.identifier)}">${icon('sparkles', { size: 13 })}Phân tích</button></td></tr>`;
    }).join('')}</tbody></table></div></section>`;
}

// Bảng sửa testcase: mỗi testcase là một khối; ô bước viết mỗi dòng một bước
export function liEditorHtml(ed, item) {
  const cards = ed.testcases.map((t, k) => `<article class="tc-card" data-tc="${k}">
      <header class="tc-head"><span class="tc-no">TC ${k + 1}</span>
        <input class="tc-title" data-f="title" value="${escapeHtml(t.title)}" placeholder="Tiêu đề testcase" aria-label="Tiêu đề testcase ${k + 1}">
        <button type="button" class="icon-btn tc-del" data-tc-del="${k}" aria-label="Xoá testcase ${k + 1}" title="Xoá testcase">${icon('close', { size: 14 })}</button></header>
      <div class="tc-body">
        <label class="tc-field"><span class="tc-label">${icon('list', { size: 13 })}Các bước <span class="muted">· mỗi dòng một bước</span></span>
          <textarea data-f="steps" rows="4" placeholder="Mở trang…&#10;Bấm…" aria-label="Các bước testcase ${k + 1}">${escapeHtml(t.steps.join('\n'))}</textarea></label>
        <label class="tc-field"><span class="tc-label">${icon('check', { size: 13 })}Kết quả mong đợi</span>
          <textarea data-f="expected" rows="4" placeholder="Hệ thống hiển thị…" aria-label="Kết quả mong đợi testcase ${k + 1}">${escapeHtml(t.expected)}</textarea></label>
      </div></article>`).join('');
  return `<section class="panel tc-editor"><h2>${icon('ticket', { size: 15 })} Testcase của ${escapeHtml(item.identifier)} <span class="chip">${ed.testcases.length} testcase</span></h2>
    ${cards ? `<div class="tc-list">${cards}</div>` : '<p class="muted small">Chưa có testcase.</p>'}
    <div class="tc-actions">
      <button type="button" data-tc-add>${icon('plus', { size: 14 })}<span class="tc-btn-text">Thêm testcase</span></button>
      <span class="tc-spacer"></span>
      <button type="button" data-gen ${item.testcases?.length ? '' : 'disabled'} title="${item.testcases?.length ? 'Sinh file *.e2e.ts từ testcase đã lưu' : 'Lưu testcase trước khi Gen e2e'}">${icon('bolt', { size: 14 })}<span class="tc-btn-text">Gen e2e</span></button>
      <button type="button" class="primary" data-save>${icon('check', { size: 14 })}<span class="tc-btn-text">Lưu testcase</span></button>
    </div></section>`;
}

// Đọc các ô đang sửa thành mảng testcase. Dòng trống trong ô bước bị bỏ ở server.
function liReadEditor(main) {
  return [...main.querySelectorAll('[data-tc]')].map((card) => ({
    title: card.querySelector('[data-f="title"]').value,
    steps: card.querySelector('[data-f="steps"]').value.split('\n'),
    expected: card.querySelector('[data-f="expected"]').value,
  }));
}

// Gọi API với nút tạm khoá; lỗi hiện toast (bỏ tiền tố mã HTTP như các trang khác)
async function liBusy(btn, fn) {
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

export async function renderLinearIssues(main) {
  const draw = async () => {
    const d = await getJson('/api/linear/issues');
    const item = liEditing ? d.items.find((i) => i.identifier === liEditing.identifier) : null;
    main.innerHTML = `${pageHead('Issue Linear', 'ticket', 'Issue được giao cho các email đã chọn ở Cài đặt → Tích hợp.')}
      <section class="panel">
        <div class="form-row">
          <button type="button" data-refresh>${icon('rerun', { size: 14 })}Lấy lại danh sách</button>
          <input data-add-id maxlength="200" placeholder="ENG-123 hoặc link Linear" aria-label="Mã issue">
          <button type="button" data-add>${icon('plus', { size: 14 })}Thêm</button>
        </div>
        ${d.fetchedAt ? `<p class="muted small">Cập nhật lúc ${escapeHtml(d.fetchedAt.slice(0, 16).replace('T', ' '))}</p>` : ''}
      </section>
      ${d.items.length ? liIssuesTable(d.items) : emptyBox('Chưa có issue', 'Lấy lại danh sách hoặc nhập mã issue.')}
      <div data-detail>${liEditing && item ? liEditorHtml(liEditing, item) : ''}</div>`;
  };

  main.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn || !main.contains(btn)) return;
    if (btn.hasAttribute('data-refresh')) {
      const r = await liBusy(btn, () => postJson('/api/linear/issues/refresh', {}));
      if (r) toast(`Đã lấy ${r.items.length} issue`);
      return draw();
    }
    if (btn.hasAttribute('data-add')) {
      const input = main.querySelector('[data-add-id]');
      const r = await liBusy(btn, () => postJson('/api/linear/issues/add', { id: input.value }));
      if (r) toast(`Đã thêm ${r.identifier}`);
      return draw();
    }
    // mở testcase đã lưu để sửa / Gen: không tốn một lượt AI
    if (btn.dataset.open) {
      const d = await getJson('/api/linear/issues');
      const item = d.items.find((i) => i.identifier === btn.dataset.open);
      if (item?.testcases?.length) liEditing = { identifier: item.identifier, testcases: item.testcases };
      return draw();
    }
    if (btn.dataset.analyze) {
      const id = btn.dataset.analyze;
      const r = await liBusy(btn, () => postJson(`/api/linear/issues/${id}/analyze`, {}));
      if (r) liEditing = { identifier: id, testcases: r.testcases };
      return draw();
    }
    if (!liEditing) return;
    const id = liEditing.identifier;
    if (btn.hasAttribute('data-tc-add')) {
      liEditing.testcases = [...liReadEditor(main), { title: '', steps: [''], expected: '' }];
      return draw();
    }
    if (btn.dataset.tcDel !== undefined) {
      liEditing.testcases = liReadEditor(main).filter((_t, k) => k !== Number(btn.dataset.tcDel));
      return draw();
    }
    if (btn.hasAttribute('data-save')) {
      const testcases = liReadEditor(main);
      const r = await liBusy(btn, () => postJson(`/api/linear/issues/${id}/testcases`, { testcases }));
      if (r) {
        toast('Đã lưu testcase');
        liEditing = { identifier: id, testcases: r.testcases };
      }
      return draw();
    }
    if (btn.hasAttribute('data-gen')) {
      const r = await liBusy(btn, () => postJson(`/api/linear/issues/${id}/gen`, {}));
      if (r) {
        toast(`Đã tạo ${r.saved}`);
        liEditing = null;
      }
      return draw();
    }
  });

  await draw();
}
