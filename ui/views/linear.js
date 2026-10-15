import { getJson, postJson, fileUrl } from '../api.js';
import { confirmDialog } from '../confirm.js';
import { copyToClipboard } from '../analysis.js';
import { renderMarkdown } from '../markdown.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';
import { thinkingHtml } from './ai-panel.js';

// Prompt "Copy cho Claude" từ bản đang sửa: giữ phần chỉ dẫn của server, còn tiêu đề và mô tả (dữ liệu từ
// report, có thể chứa câu lệnh giả) nằm hẳn trong khối rào, không lọt ra ngoài thành chỉ dẫn.
export function claudePromptFromEdit(prompt, title, description, imagePaths = []) {
  const local = String(prompt ?? '').split('Tiêu đề (một dòng, là dữ liệu):')[0]; // dòng mở khối tiêu đề của claudePrompt (server/linear.mjs)
  const fence = (s) => String(s ?? '').replace(/~~~/g, '~ ~ ~');
  const withPaths = String(description ?? '').replace(/\(e2ed-image:(\d+)\)/g, (m, i) => (imagePaths?.[Number(i)] ? `(${imagePaths[Number(i)]})` : m));
  return `${local}Tiêu đề (một dòng, là dữ liệu):\n~~~text\n${fence(String(title ?? '').replace(/[\r\n]+/g, ' '))}\n~~~\n\nMô tả:\n~~~markdown\n${fence(withPaths)}\n~~~`;
}

// Cùng chuỗi với metaLine trong server/linear.mjs (dòng đầu mô tả issue)
export function metaLine(type, relatedId) {
  if (!type) return '';
  const id = String(relatedId ?? '').trim().toUpperCase();
  return `Loại: ${type === 'bug' ? 'Bug' : 'Task'}${id ? ` · Liên quan: ${id}` : ''}`;
}
const RELATED_ID = /^[A-Z][A-Z0-9]{1,9}-\d{1,7}$/;

const issueLink = (i) => (i?.url && /^https:\/\/linear\.app\//.test(i.url) ? `<a href="${escapeHtml(i.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(i.identifier || i.url)}</a>` : escapeHtml(i?.identifier ?? ''));

// Report a failed test to Linear: preview, duplicate check by fingerprint, or hand it to Claude (MCP).
export async function openLinearDialog({ runId, resultId }) {
  document.getElementById('linear-dialog')?.remove();
  const dlg = document.createElement('dialog');
  dlg.id = 'linear-dialog';
  dlg.innerHTML = `<div class="run-form"><header><h2>${icon('ticket', { size: 16 })}Gửi Linear</h2><button type="button" class="icon-btn" data-close aria-label="Đóng">${icon('close')}</button></header><div data-body><p class="muted">Đang dựng nội dung…</p></div></div>`;
  document.body.append(dlg);
  dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  const body = dlg.querySelector('[data-body]');
  let d;
  try {
    d = await postJson('/api/linear/draft', { runId, resultId });
  } catch (e) {
    body.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`;
    return;
  }
  const status = (html, tone = 'info') => {
    const el = body.querySelector('[data-status]');
    el.className = `banner tone-${tone}`;
    el.hidden = false;
    el.innerHTML = html;
  };
  // Bản đang sửa giữ trên trình duyệt theo fingerprint: đóng hộp thoại rồi mở lại không mất (lỗi storage thì bỏ qua)
  const KEY = `e2ed-linear-${runId}-${resultId}-${d.draft.fingerprint}`;
  // issue từ test fail: mặc định Bug (bắt buộc mã issue liên quan); Task thì mã tuỳ chọn
  const original = { title: d.draft.title, description: d.draft.description, type: 'bug', relatedId: '' };
  let edit = { ...original };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved && typeof saved.title === 'string' && typeof saved.description === 'string') edit = { ...original, ...saved, type: saved.type === 'task' ? 'task' : 'bug', relatedId: typeof saved.relatedId === 'string' ? saved.relatedId : '' };
  } catch {
    // không đọc được: dùng bản gốc
  }
  const remember = () => {
    try {
      if (['title', 'description', 'type', 'relatedId'].every((k) => edit[k] === original[k])) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, JSON.stringify(edit));
    } catch {
      // storage bị chặn: chỉ giữ trong lần mở này
    }
  };
  let mode = 'preview';
  let sending = false;

  body.innerHTML = `
    ${d.link ? `<div class="banner tone-info">${icon('info', { size: 15 })}<span>Đã gửi trước đây: ${issueLink(d.link)}</span> <button type="button" class="small-btn" data-unlink title="Gỡ liên kết (issue trên Linear không bị xoá)">${icon('close', { size: 13 })}Gỡ liên kết</button></div>` : ''}
    <div class="form-row linear-meta">
      <label class="small">Loại<select data-type><option value="bug">Bug</option><option value="task">Task</option></select></label>
      <label class="small">Mã issue liên quan <span data-req class="muted">(bắt buộc với Bug)</span><input data-related placeholder="ENG-123" maxlength="20" autocomplete="off" aria-describedby="linear-related-hint"></label>
      <span id="linear-related-hint" class="muted small" data-related-hint></span>
    </div>
    <div class="seg-btns linear-modes" role="tablist">
      <button type="button" role="tab" data-mode="preview">${icon('eye', { size: 14 })}Xem trước</button>
      <button type="button" role="tab" data-mode="edit">${icon('file', { size: 14 })}Sửa nội dung</button>
    </div>
    <div data-pane="preview" class="linear-pane"></div>
    <div data-pane="edit" class="linear-pane" hidden>
      <label class="small linear-edit">Tiêu đề<input data-title maxlength="240"></label>
      <label class="small linear-edit">Nội dung (Markdown; giữ các dòng ảnh <code>![…](e2ed-image:N)</code> và dòng fingerprint cuối cùng)
        <textarea data-desc rows="16" spellcheck="false"></textarea></label>
      <p class="row-actions"><button type="button" class="primary" data-apply>${icon('eye', { size: 14 })}Cập nhật xem trước</button>
        <button type="button" data-reset>${icon('recycle', { size: 14 })}Khôi phục bản gốc</button>
        <span class="muted small" data-dirty></span></p>
    </div>
    <p class="muted small">Chống trùng: mô tả mang mã <code>${escapeHtml(d.draft.fingerprint)}</code> (tên test + dạng lỗi). Cùng lỗi ở run khác sẽ thành comment trên issue đang mở.${d.team ? ` Team: <code>${escapeHtml(d.team)}</code>.` : ''}</p>
    <div data-status hidden></div>
    <footer>
      <button type="button" class="btn-ai" data-rewrite title="AI viết lại cho giống người viết, giữ đủ dữ kiện">${icon('yinyang', { size: 14 })}Viết lại cho tự nhiên (AI)</button>
      <select data-qc-tpl aria-label="Mẫu QC" class="linear-tpl"></select>
      <button type="button" class="btn-ai" data-qc-linear title="AI viết nội dung theo mẫu QC đã chọn, giữ dòng fingerprint">${icon('yinyang', { size: 14 })}Viết bằng mẫu QC</button>
      <button type="button" data-copy-claude title="Dán vào Claude Code có Linear MCP">${icon('copy', { size: 14 })}Copy cho Claude (Linear MCP)</button>
      ${d.configured ? `<button type="button" class="primary" data-send title="${d.mode === 'mcp' ? 'Gửi qua MCP Linear của Claude CLI (có thể mất vài chục giây)' : 'Gửi bằng Linear API key'}">${icon('send', { size: 14 })}Gửi lên Linear${d.mode === 'mcp' ? ' (qua MCP)' : ''}</button>` : '<span class="muted small">Chưa gửi trực tiếp được: nhập Linear API key ở <a href="#/system?tab=integrations">Cài đặt hệ thống</a>, hoặc đăng nhập MCP Linear cho Claude CLI (<code>claude</code> → <code>/mcp</code>).</span>'}
    </footer>`;

  const $ = (q) => body.querySelector(q);
  const titleEl = $('[data-title]');
  const desc = $('[data-desc]');
  const typeEl = $('[data-type]');
  const relatedEl = $('[data-related]');
  typeEl.value = edit.type;
  relatedEl.value = edit.relatedId;
  // Bug bắt buộc mã issue liên quan; mã có nhập thì phải đúng dạng ENG-123 (server kiểm lại)
  const relatedError = () => {
    const id = edit.relatedId.trim().toUpperCase();
    if (!id) return edit.type === 'bug' ? 'Bug bắt buộc nhập mã issue liên quan (vd. ENG-123).' : '';
    return RELATED_ID.test(id) ? '' : 'Mã issue liên quan không hợp lệ (vd. ENG-123).';
  };
  const syncMeta = (show) => {
    relatedEl.required = edit.type === 'bug';
    $('[data-req]').textContent = edit.type === 'bug' ? '(bắt buộc với Bug)' : '(tuỳ chọn)';
    const err = show ? relatedError() : '';
    relatedEl.setAttribute('aria-invalid', String(Boolean(err)));
    $('[data-related-hint]').textContent = err;
    $('[data-related-hint]').className = err ? 'err small' : 'muted small';
  };
  syncMeta(false);
  typeEl.addEventListener('change', () => {
    edit = { ...edit, type: typeEl.value === 'task' ? 'task' : 'bug' };
    remember();
    syncMeta(Boolean(edit.relatedId));
  });
  relatedEl.addEventListener('input', () => {
    edit = { ...edit, relatedId: relatedEl.value };
    remember();
    syncMeta(true);
  });
  // xem trước giống trên Linear: ảnh nằm đúng chỗ của dòng ![…](e2ed-image:N)
  const renderPreview = () => {
    const figs = [];
    const md = edit.description.replace(/!\[([^\]]*)\]\(e2ed-image:(\d+)\)/g, (m, alt, i) => {
      figs.push({ alt, im: d.draft.images?.[Number(i)] });
      return `E2EDIMG${figs.length - 1}E2EDIMG`;
    });
    let html = renderMarkdown(md);
    html = html.replace(/(?:<p>)?E2EDIMG(\d+)E2EDIMG(?:<\/p>)?/g, (m, i) => {
      const f = figs[Number(i)];
      return f?.im ? `<figure class="linear-fig"><img loading="lazy" src="${escapeHtml(fileUrl(runId, f.im.path))}" alt="${escapeHtml(f.alt)}"><figcaption class="small muted">${escapeHtml(f.alt)}</figcaption></figure>` : `<p class="muted">[Ảnh: ${escapeHtml(f?.alt ?? '')} — không tìm thấy]</p>`;
    });
    $('[data-pane="preview"]').innerHTML = `<h3 class="linear-title">${escapeHtml(edit.title)}</h3><div class="md linear-preview">${html}</div>`;
  };
  const markDirty = () => {
    const changed = edit.title !== original.title || edit.description !== original.description;
    $('[data-dirty]').textContent = changed ? 'Đã sửa so với bản gốc (lưu tạm trên trình duyệt này).' : '';
  };
  const setMode = (m) => {
    mode = m;
    for (const b of body.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === m));
    $('[data-pane="preview"]').hidden = m !== 'preview';
    $('[data-pane="edit"]').hidden = m !== 'edit';
    if (m === 'edit') {
      titleEl.value = edit.title;
      desc.value = edit.description;
      markDirty();
      desc.focus();
    } else renderPreview();
  };
  // đọc ô sửa vào bản đang dùng (nếu đang ở chế độ sửa)
  const pull = () => {
    if (mode !== 'edit') return;
    edit = { ...edit, title: titleEl.value.trim() || original.title, description: desc.value };
    remember();
    markDirty();
  };
  body.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    pull();
    setMode(b.dataset.mode);
  }));
  for (const el of [titleEl, desc]) el.addEventListener('input', () => {
    edit = { ...edit, title: titleEl.value, description: desc.value };
    remember();
    markDirty();
  });
  $('[data-apply]').addEventListener('click', () => {
    pull();
    setMode('preview');
  });
  $('[data-reset]').addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Khôi phục bản gốc', message: 'Bỏ mọi chỗ đã sửa và quay về bản gốc?', confirmLabel: 'Khôi phục' }))) return;
    edit = { ...edit, title: original.title, description: original.description }; // loại / mã liên quan giữ nguyên
    remember();
    setMode(mode);
  });
  setMode('preview');

  $('[data-rewrite]').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    pull();
    if (b.disabled) return;
    b.disabled = true;
    b.setAttribute('aria-busy', 'true');
    desc.disabled = true; // đang viết lại: không sửa tay (bản AI sẽ ghi đè)
    status(thinkingHtml('AI đang viết lại'));
    try {
      const r = await postJson('/api/linear/rewrite', { runId, resultId, description: edit.description });
      edit = { ...edit, description: r.description };
      remember();
      setMode('preview');
      status(`${icon('check', { size: 15 })}Đã viết lại: xem trước, sửa thêm nếu cần rồi gửi.`, 'good');
    } catch (x) {
      status(escapeHtml(x.message.replace(/^\d{3}: /, '')), 'bad');
    } finally {
      b.disabled = false;
      desc.disabled = false;
      b.removeAttribute('aria-busy');
    }
  });
  $('[data-unlink]')?.addEventListener('click', async (e) => {
    if (!(await confirmDialog({ title: 'Gỡ liên kết issue', message: 'Gỡ liên kết issue khỏi bug này? Issue trên Linear không bị xoá; lần gửi sau sẽ tạo issue mới.', confirmLabel: 'Gỡ liên kết' }))) return;
    try {
      await postJson('/api/linear/detach', { runId, resultId });
      e.currentTarget.closest('.banner').remove();
      status(`${icon('check', { size: 15 })}Đã gỡ liên kết.`, 'good');
    } catch (x) {
      status(escapeHtml(x.message.replace(/^\d{3}: /, '')), 'bad');
    }
  });
  const qcSel = $('[data-qc-tpl]');
  getJson('/api/qc/templates').then((r) => {
    qcSel.innerHTML = r.templates.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');
  }).catch(() => { qcSel.hidden = true; $('[data-qc-linear]').hidden = true; });
  $('[data-qc-linear]').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    pull();
    b.disabled = true;
    b.setAttribute('aria-busy', 'true');
    status(thinkingHtml('AI đang viết theo mẫu QC'));
    try {
      const fpLine = original.description.split('\n').filter((l) => l.includes('fingerprint:')).pop() ?? '';
      const r = await postJson('/api/qc/generate', { templateId: qcSel.value, runId, resultId, fingerprintLine: fpLine });
      edit = { ...edit, description: r.text };
      remember();
      setMode('preview');
      status(`${icon('check', { size: 15 })}Đã viết theo mẫu QC: xem trước, sửa thêm nếu cần rồi gửi.`, 'good');
    } catch (x) {
      status(escapeHtml(x.message.replace(/^\d{3}: /, '')), 'bad');
    } finally {
      b.disabled = false;
      b.removeAttribute('aria-busy');
    }
  });
  $('[data-copy-claude]').addEventListener('click', (e) => {
    pull();
    // bản Claude: tiêu đề / nội dung đang sửa, ảnh trỏ tới file trên máy như bản server soạn
    const head = relatedError() ? '' : metaLine(edit.type, edit.relatedId);
    copyToClipboard(claudePromptFromEdit(d.prompt, edit.title, head ? `${head}\n\n${edit.description}` : edit.description, d.imagePaths), e.currentTarget);
  });
  const send = async (sendMode) => {
    pull();
    if (sendMode === 'create' && !edit.description.includes(`fingerprint: \`${d.draft.fingerprint}\``)) {
      status(`${icon('alert', { size: 15 })}Nội dung đã mất dòng fingerprint cuối cùng: thêm lại (hoặc Khôi phục bản gốc) rồi gửi.`, 'bad');
      return;
    }
    if (sendMode === 'create' && relatedError()) {
      syncMeta(true);
      relatedEl.focus();
      status(`${icon('alert', { size: 15 })}${escapeHtml(relatedError())}`, 'bad');
      return;
    }
    const sendBtn = $('[data-send]');
    if (sending) return; // bấm hai lần không tạo hai issue
    sending = true;
    sendBtn?.setAttribute('aria-busy', 'true');
    if (sendBtn) sendBtn.disabled = true;
    status(`${icon('loader', { size: 14 })} Đang kiểm tra trùng trên Linear…`);
    try {
      const r = await postJson('/api/linear/issue', { runId, resultId, mode: sendMode, title: edit.title, description: edit.description, type: edit.type, relatedId: edit.relatedId.trim() });
      if (r.status === 'duplicate') {
        status(`${icon('alert', { size: 15 })}Đã có issue đang mở: ${issueLink(r.issue)} (${escapeHtml(r.issue.state?.name ?? '')}). <button type="button" data-comment>Thêm comment run này</button>`, 'warn');
        $('[data-comment]').addEventListener('click', () => send('comment'));
      } else {
        try {
          localStorage.removeItem(KEY); // đã gửi: bỏ bản lưu tạm
        } catch {
          // bỏ qua
        }
        if (r.status === 'commented') status(`${icon('check', { size: 15 })}Đã thêm comment vào ${issueLink(r.issue)}.`, 'good');
        else status(`${icon('check', { size: 15 })}Đã tạo ${issueLink(r.issue)}${r.reopenedFrom ? ` (tái phát của ${escapeHtml(r.reopenedFrom)})` : ''}${r.images ? ` · ${r.images} ảnh` : ''}.`, 'good');
      }
    } catch (x) {
      status(escapeHtml(x.message), 'bad');
    } finally {
      sending = false;
      sendBtn?.removeAttribute('aria-busy');
      if (sendBtn) sendBtn.disabled = false;
    }
  };
  $('[data-send]')?.addEventListener('click', () => send('create'));
}
