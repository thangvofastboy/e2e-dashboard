// Bối cảnh dự án cho AI: thư mục chứa test, các thư mục khác của hệ thống (tuỳ chọn) kèm mô tả, và trạng thái
// "AI ghi nhớ": mỗi lần lưu, dashboard cho Claude đọc các thư mục này rồi viết bản ghi nhớ về hệ thống; bản ghi nhớ
// được gửi kèm mọi lần gọi AI sau đó. Dùng ở hộp Thêm / Sửa project (trang Projects) và tab Dự án (Cài đặt hệ thống).
import { getJson, postJson } from './api.js';
import { escapeHtml, fmtRelative } from './format.js';
import { icon } from './icons.js';
import { renderMarkdown } from './markdown.js';

export const CTX_SRC_MAX = 20;
export const CTX_PROMPT_MAX = 8000; // = PROMPT_MAX của server/settings.mjs
export const CTX_DESC_MAX = 500;

// đường dẫn chọn từ hộp thư mục (tuyệt đối) → tương đối với project khi nằm trong project
export function relTo(root, p) {
  const r = String(root ?? '').replace(/[\\/]+$/, '');
  const v = String(p ?? '').trim();
  if (!r || !v) return v;
  if (v === r) return '.';
  for (const sep of ['/', '\\']) if (v.startsWith(r + sep)) return v.slice(r.length + 1);
  return v;
}

export const ctxRowHtml = (s = {}) => `<li class="src-row ctx-row" data-ctx-row>
    <span class="ctx-path"><input name="ctxPath" value="${escapeHtml(s.path ?? '')}" placeholder="../crm-backend" aria-label="Đường dẫn thư mục" autocomplete="off" spellcheck="false"><button type="button" class="small-btn" data-ctx-pick>${icon('folder', { size: 13 })}Chọn…</button></span>
    <textarea name="ctxDesc" rows="2" maxlength="${CTX_DESC_MAX}" placeholder="Mô tả: vd. Backend NestJS, API đơn hàng, auth" aria-label="Mô tả thư mục">${escapeHtml(s.description ?? '')}</textarea>
    <button type="button" class="small-btn" data-ctx-del>${icon('close', { size: 13 })}Xoá</button></li>`;

// phần form (không gồm thẻ <form>): thư mục test + danh sách thư mục khác
export function contextFieldsHtml(ctx) {
  const t = ctx?.memory?.inputs;
  const sources = ctx?.sources ?? [];
  return `<label class="fb-field"><span>Thư mục chứa test <span class="muted small">(file *.e2e.ts)</span></span>
      <span class="ctx-path"><input name="ctxTestDir" value="${escapeHtml(ctx?.testDir ?? '')}" placeholder="${escapeHtml(t?.testDirDetected ? `${t.testDir} (tự đoán)` : 'tests')}" autocomplete="off" spellcheck="false" aria-label="Thư mục chứa test"><button type="button" class="small-btn" data-ctx-pick-test>${icon('folder', { size: 13 })}Chọn…</button></span>
      <small class="muted">Để trống: dashboard tự đoán${t?.testDirDetected ? ` (đang dùng <code>${escapeHtml(t.testDir)}</code>)` : ''}.</small></label>
    <div class="fb-field"><span>Thư mục khác của hệ thống <span class="muted small">(tuỳ chọn, tối đa ${CTX_SRC_MAX}; vd. backend, frontend, tài liệu; đường dẫn tương đối với project hoặc tuyệt đối)</span></span>
      <ul class="src-list" data-ctx-list>${sources.map(ctxRowHtml).join('')}</ul>
      <p><button type="button" data-ctx-add${sources.length >= CTX_SRC_MAX ? ' disabled' : ''}>${icon('plus', { size: 14 })}Thêm thư mục</button></p></div>
    <label class="fb-field"><span>Prompt: quy tắc, rule cho AI <span class="muted small">(tuỳ chọn, tối đa ${CTX_PROMPT_MAX} ký tự; gửi kèm mọi lần gọi AI của project)</span></span>
      <textarea class="proj-prompt" name="ctxPrompt" rows="6" maxlength="${CTX_PROMPT_MAX}" placeholder="Quy ước đặt tên test… Luồng nghiệp vụ chính… Rule: không xoá dữ liệu thật, tài khoản test là…" aria-label="Prompt quy tắc cho AI">${escapeHtml(ctx?.prompt ?? '')}</textarea></label>`;
}

// đọc form; trả { testDir, sources, prompt } hoặc { error }
export function readContextFields(root, f) {
  const sources = [...f.querySelectorAll('[data-ctx-row]')].map((r) => ({ path: relTo(root, r.querySelector('[name=ctxPath]').value), description: r.querySelector('[name=ctxDesc]').value.trim() }));
  if (sources.length > CTX_SRC_MAX) return { error: `Tối đa ${CTX_SRC_MAX} thư mục.` };
  const i = sources.findIndex((s) => !s.path);
  if (i >= 0) return { error: `Thư mục khác, dòng ${i + 1}: chưa nhập đường dẫn.` };
  const j = sources.findIndex((s) => s.description.length > CTX_DESC_MAX);
  if (j >= 0) return { error: `Thư mục khác, dòng ${j + 1}: mô tả dài quá ${CTX_DESC_MAX} ký tự.` };
  const prompt = f.querySelector('[name=ctxPrompt]')?.value ?? '';
  if (prompt.length > CTX_PROMPT_MAX) return { error: `Prompt dài quá ${CTX_PROMPT_MAX} ký tự.` };
  return { testDir: relTo(root, f.querySelector('[name=ctxTestDir]').value), sources, prompt };
}

// thêm / xoá dòng, nút Chọn… (pick(start) → đường dẫn tuyệt đối hoặc null)
export function bindContextFields(f, root, pick) {
  const list = f.querySelector('[data-ctx-list]');
  const sync = () => (f.querySelector('[data-ctx-add]').disabled = list.children.length >= CTX_SRC_MAX);
  f.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !f.contains(b)) return;
    if ('ctxAdd' in b.dataset) {
      list.insertAdjacentHTML('beforeend', ctxRowHtml());
      list.lastElementChild.querySelector('input').focus();
      sync();
    } else if ('ctxDel' in b.dataset) {
      b.closest('[data-ctx-row]').remove();
      sync();
    } else if ('ctxPick' in b.dataset || 'ctxPickTest' in b.dataset) {
      const input = 'ctxPickTest' in b.dataset ? f.querySelector('[name=ctxTestDir]') : b.closest('[data-ctx-row]').querySelector('[name=ctxPath]');
      const cur = input.value.trim();
      const start = !cur ? root : /^([a-z]:)?[\\/]/i.test(cur) ? cur : `${root.replace(/[\\/]+$/, '')}/${cur}`;
      const got = await pick(start);
      if (got) input.value = relTo(root, got);
    }
  });
}

const MEM_STATE = {
  ready: ['good', 'check', 'AI đã ghi nhớ hệ thống'],
  stale: ['warn', 'alert', 'Bối cảnh đã đổi: AI cần đọc lại'],
  learning: ['info', 'loader', 'AI đang đọc dự án để ghi nhớ…'],
  none: ['muted', 'info', 'AI chưa ghi nhớ dự án này'],
  error: ['bad', 'x', 'AI chưa đọc được dự án'],
};

// khối trạng thái ghi nhớ: nhãn, thời điểm, lỗi, nút AI đọc lại, bản ghi nhớ (thu gọn)
export function memoryHtml(mem) {
  if (!mem) return '';
  const [tone, ic, label] = MEM_STATE[mem.state] ?? MEM_STATE.none;
  const when = mem.state === 'learning' ? (mem.startedAt ? ` · bắt đầu ${fmtRelative(mem.startedAt)}` : '') : mem.updatedAt ? ` · ghi nhớ ${fmtRelative(mem.updatedAt)}` : '';
  return `<div class="ctx-memory" data-ctx-memory data-state="${escapeHtml(mem.state)}">
    <p class="ctx-mem-head"><span class="chip tone-${tone}">${icon(ic, { size: 12 })}${escapeHtml(label)}</span><span class="muted small">${escapeHtml(when)}</span>
      <button type="button" class="small-btn" data-ctx-relearn${mem.state === 'learning' ? ' disabled' : ''}>${icon('recycle', { size: 13 })}AI đọc lại dự án</button></p>
    ${mem.error ? `<p class="small tone-bad">${escapeHtml(mem.error)}</p>` : ''}
    <p class="muted small">Mỗi lần lưu, dashboard cho Claude đọc thư mục test và các thư mục trên rồi viết bản ghi nhớ về hệ thống; bản ghi nhớ đi kèm mọi lần gọi AI (phân tích lỗi, viết bug, viết test…).</p>
    ${mem.text ? `<details class="ctx-mem-text"><summary class="small">Xem bản ghi nhớ của AI</summary><div class="md">${renderMarkdown(mem.text)}</div></details>` : ''}
  </div>`;
}

// hỏi lại trạng thái tới khi AI đọc xong; onUpdate(mem) mỗi lần. Trả hàm dừng.
export function pollMemory(root, onUpdate, every = 3000) {
  let stop = false;
  const tick = async () => {
    if (stop) return;
    const ctx = await getJson(`/api/project-context?root=${encodeURIComponent(root)}`).catch(() => null);
    if (stop || !ctx) return;
    onUpdate(ctx.memory);
    if (ctx.memory.state === 'learning') setTimeout(tick, every);
  };
  setTimeout(tick, every);
  return () => (stop = true);
}

export const relearn = (root) => postJson('/api/project-memory/refresh', { root });
