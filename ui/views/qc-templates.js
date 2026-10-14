import { getJson, postJson } from '../api.js';
import { confirmDialog } from '../confirm.js';
import { pageHead } from '../analysis.js';
import { toast } from '../toast.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';
import { pickerHtml, bindPicker } from '../test-picker.js';

// Mẫu prompt QC: sửa mẫu, chọn một test hoặc cả run, rồi chép prompt hoặc để AI viết nội dung (bug report, báo cáo, mô tả Linear).
const ALL_RUN = 'Cả run mới nhất';
const KINDS = [['linear', 'Mô tả Linear'], ['bug', 'Bug ngắn'], ['report', 'Báo cáo run'], ['custom', 'Khác']];

export async function renderQcTemplates(main) {
  const [t, res] = await Promise.all([getJson('/api/qc/templates'), getJson('/api/qc/results')]);
  let cur = t.templates[0]?.id ?? null;
  // /api/qc/results không trả file nên cây chỉ có một cấp; giữ lựa chọn qua các lần vẽ lại
  const srcRows = res.results.map((r) => ({ value: r.id, title: r.test, file: r.file ?? '', tags: [], sub: `${r.target} · ${r.status}` }));
  let src = '';
  const draw = () => {
    const tpl = cur === '' ? { id: '', name: '', kind: 'custom', body: '' } : t.templates.find((x) => x.id === cur) ?? null;
    main.innerHTML = `${pageHead('Mẫu prompt QC', 'file', 'Viết mẫu có chỗ trống {{tên}}, điền dữ liệu của test hoặc run, rồi chép prompt hoặc để AI viết nội dung.')}
      <div class="sys tq-tpl">
        <nav class="sys-nav tpl-list" aria-label="Danh sách mẫu">${t.templates.map((x) => `<button type="button" data-tpl="${escapeHtml(x.id)}" aria-pressed="${x.id === cur}"><span class="sys-nav-t"><strong>${escapeHtml(x.name)}</strong><span class="small">${escapeHtml(KINDS.find(([k]) => k === x.kind)?.[1] ?? x.kind)}</span></span></button>`).join('')}
          <button type="button" data-tpl-new class="small-btn">${icon('check', { size: 13 })}Mẫu mới</button></nav>
        <div class="sys-body">
          ${tpl ? `<section class="panel"><h2>${icon('file', { size: 18 })} Sửa mẫu</h2>
            <form data-tpl-form class="tpl-form">
              <label class="fb-field"><span>Tên</span><input name="name" maxlength="80" value="${escapeHtml(tpl.name)}"></label>
              <label class="fb-field"><span>Dùng để</span><select name="kind">${KINDS.map(([k, l]) => `<option value="${k}"${k === tpl.kind ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
              <label class="fb-field"><span>Nội dung prompt</span><textarea name="body" rows="14" maxlength="8000">${escapeHtml(tpl.body)}</textarea></label>
              <div class="tpl-chips" aria-label="Chỗ trống có thể chèn">${Object.entries(t.placeholders).map(([k, l]) => `<button type="button" class="pill" data-ph="${k}" title="${escapeHtml(l)}">{{${k}}}</button>`).join('')}</div>
              <div class="form-row"><button type="submit" class="primary">${icon('check', { size: 14 })}Lưu mẫu</button>
                ${tpl.id ? `<button type="button" data-tpl-del class="btn-stop">${icon('close', { size: 14 })}Xoá mẫu</button>` : ""}
                <button type="button" data-tpl-reset>${icon('recycle', { size: 14 })}Khôi phục mẫu gốc</button></div>
            </form></section>` : '<section class="panel"><p class="muted">Chọn một mẫu hoặc tạo mẫu mới.</p></section>'}
          <section class="panel"><h2>${icon('sparkles', { size: 18 })} Dùng mẫu</h2>
            <div class="form-row"><span class="form-label">Dữ liệu</span>${pickerHtml({ name: 'src', rows: srcRows, value: src, emptyLabel: ALL_RUN, attrs: 'data-src aria-label="Test hoặc run"' })}</div>
            <div class="form-row"><button type="button" data-use="prompt">${icon('copy', { size: 14 })}Chép prompt</button>
              <button type="button" class="primary" data-use="ai">${icon('sparkles', { size: 14 })}Để AI viết</button></div>
            <p class="muted small" data-missing></p>
            <pre class="tpl-out" data-out hidden></pre>
            <p class="row-actions" data-out-actions hidden><button type="button" data-copy-out>${icon('copy', { size: 14 })}Chép kết quả</button></p>
          </section>
        </div>
      </div>`;
    bind();
  };
  const bind = () => {
    bindPicker(main.querySelector('[data-tpick]'), srcRows, { emptyLabel: ALL_RUN, onChange: (v) => { src = v; } });
    main.querySelectorAll('[data-tpl]').forEach((b) => b.addEventListener('click', () => { cur = b.dataset.tpl; draw(); }));
    main.querySelector('[data-tpl-new]')?.addEventListener('click', () => { cur = ''; draw(); });
    main.querySelector('[data-tpl-form]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        const r = await postJson('/api/qc/templates', { ...(cur ? { id: cur } : {}), name: f.get('name'), kind: f.get('kind'), body: f.get('body') });
        t.templates = r.templates;
        cur = r.item.id;
        toast('Đã lưu mẫu');
        draw();
      } catch (x) {
        toast(x.message.replace(/^\d{3}: /, ''), 'bad');
      }
    });
    main.querySelectorAll('[data-ph]').forEach((b) => b.addEventListener('click', () => {
      const ta = main.querySelector('[data-tpl-form] textarea');
      const at = ta.selectionStart ?? ta.value.length;
      ta.value = `${ta.value.slice(0, at)}{{${b.dataset.ph}}}${ta.value.slice(at)}`;
      ta.focus();
    }));
    main.querySelector('[data-tpl-del]')?.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Xoá mẫu', message: 'Xoá mẫu này?', confirmLabel: 'Xoá' }))) return;
      const r = await postJson('/api/qc/templates', { delete: cur });
      t.templates = r.templates;
      cur = t.templates[0]?.id ?? null;
      draw();
    });
    main.querySelector('[data-tpl-reset]')?.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Khôi phục mẫu gốc', message: 'Khôi phục ba mẫu gốc? Mẫu bạn đã sửa sẽ mất.', confirmLabel: 'Khôi phục' }))) return;
      const r = await postJson('/api/qc/templates', { reset: true });
      t.templates = r.templates;
      cur = t.templates[0]?.id ?? null;
      draw();
    });
    main.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', async () => {
      if (!cur) return toast('Lưu mẫu trước khi dùng', 'bad');
      const src = main.querySelector('[data-src]').value;
      const body = { templateId: cur, ...(src ? { resultId: src, runId: res.results.find((r) => r.id === src)?.runId } : {}) };
      const out = main.querySelector('[data-out]');
      const actions = main.querySelector('[data-out-actions]');
      b.setAttribute('aria-busy', 'true');
      try {
        if (b.dataset.use === 'prompt') {
          const r = await postJson('/api/qc/render', body);
          showOut(r.prompt, r.missing);
        } else {
          const r = await postJson('/api/qc/generate', body);
          showOut(r.text, r.missing);
        }
        actions.hidden = false;
      } catch (x) {
        toast(x.message.replace(/^\d{3}: /, ''), 'bad');
      } finally {
        b.removeAttribute('aria-busy');
      }
      out.hidden = false;
    }));
    main.querySelector('[data-copy-out]')?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(main.querySelector('[data-out]').textContent);
      toast('Đã chép');
    });
  };
  const showOut = (text, missing) => {
    main.querySelector('[data-out]').textContent = text;
    main.querySelector('[data-missing]').textContent = missing?.length ? `Chưa điền được: ${missing.map((m) => `{{${m}}}`).join(', ')}` : '';
  };
  draw();
}
