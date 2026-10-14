import { getJson, postJson } from '../api.js';
import { confirmDialog } from '../confirm.js';
import { pageHead, emptyBox, fmtPct } from '../analysis.js';
import { toast } from '../toast.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';

// Test thủ công: các ca QC chạy tay, không có file test. Cùng bảng với test tự động để thấy độ phủ đầy đủ.
const LABEL = { 'not-run': 'Chưa chạy', pass: 'Pass', fail: 'Fail', blocked: 'Bị chặn' };
const TONE = { 'not-run': 'muted', pass: 'good', fail: 'bad', blocked: 'warn' };

function summaryHtml(s) {
  const tile = (label, v, tone = '') => `<div class="sys-stat${tone ? ` tone-${tone}` : ''}"><span class="sys-stat-v">${v}</span><span class="sys-stat-l">${label}</span></div>`;
  return `<div class="sys-stats">${tile('Tổng ca', s.total)}${tile('Pass', s.pass, 'good')}${tile('Fail', s.fail, s.fail ? 'bad' : '')}${tile('Bị chặn', s.blocked, s.blocked ? 'warn' : '')}${tile('Chưa chạy', s['not-run'], 'muted')}${tile('Tỉ lệ pass (đã chạy)', fmtPct(s.passRate))}</div>`;
}

function rowHtml(x) {
  return `<tr data-id="${escapeHtml(x.id)}">
    <td><input class="tri-input" data-f="title" value="${escapeHtml(x.title)}" aria-label="Tiêu đề ca test"></td>
    <td><input class="tri-input" data-f="module" value="${escapeHtml(x.module)}" placeholder="Module" aria-label="Module"></td>
    <td><input class="tri-input" data-f="owner" value="${escapeHtml(x.owner)}" placeholder="Người test" aria-label="Người test"></td>
    <td><select data-f="status" aria-label="Trạng thái" class="tone-${TONE[x.status]}">${Object.entries(LABEL).map(([v, l]) => `<option value="${v}"${v === x.status ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
    <td><input class="tri-input" data-f="note" value="${escapeHtml(x.note)}" placeholder="Ghi chú" aria-label="Ghi chú"></td>
    <td class="muted small">${escapeHtml((x.updatedAt ?? '').slice(0, 16).replace('T', ' '))}</td>
    <td><button type="button" class="small-btn" data-del>${icon('close', { size: 13 })}Xoá</button></td></tr>`;
}

export async function renderManual(main) {
  const draw = async () => {
    const d = await getJson('/api/qc/manual');
    main.innerHTML = `${pageHead('Test thủ công', 'flask', 'Ca QC chạy tay: ghi kết quả từng lần, cùng thống kê với test tự động.')}
      ${summaryHtml(d.summary)}
      <form class="panel fb-form manual-add" data-add>
        <h2>${icon('check', { size: 16 })} Thêm ca test</h2>
        <div class="form-row"><input name="title" required maxlength="200" placeholder="Tiêu đề, ví dụ: Đăng nhập sai mật khẩu hiện thông báo" aria-label="Tiêu đề mới"><input name="module" maxlength="80" placeholder="Module" aria-label="Module mới"><input name="owner" maxlength="80" placeholder="Người test" aria-label="Người test mới"></div>
        <label class="fb-field"><span>Các bước</span><textarea name="steps" rows="3" maxlength="4000" placeholder="1. Mở trang đăng nhập&#10;2. Nhập sai mật khẩu&#10;3. Bấm Đăng nhập"></textarea></label>
        <div class="form-row"><button type="submit" class="primary">${icon('check', { size: 14 })}Thêm</button></div>
      </form>
      ${d.items.length ? `<section class="panel"><div class="table-wrap"><table class="table manual-table"><thead><tr><th>Ca test</th><th>Module</th><th>Người test</th><th>Trạng thái</th><th>Ghi chú</th><th>Cập nhật</th><th></th></tr></thead><tbody>${d.items.map(rowHtml).join('')}</tbody></table></div></section>` : emptyBox('Chưa có ca test thủ công', 'Thêm ca ở trên. Mỗi lần đổi trạng thái được ghi lịch sử.')}`;
    main.querySelector('[data-add]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      if (btn.disabled) return; // Enter hai lần không thêm hai ca giống nhau
      btn.disabled = true;
      const f = new FormData(e.target);
      try {
        await postJson('/api/qc/manual', { title: f.get('title'), module: f.get('module'), owner: f.get('owner'), steps: f.get('steps') });
        toast('Đã thêm ca test');
        await draw();
      } catch (x) {
        btn.disabled = false;
        toast(x.message.replace(/^\d{3}: /, ''), 'bad');
      }
    });
    main.querySelectorAll('tr[data-id]').forEach((tr) => {
      tr.addEventListener('change', async (e) => {
        const f = e.target.dataset.f;
        if (!f) return;
        const value = e.target.value;
        try {
          await postJson('/api/qc/manual', { id: tr.dataset.id, [f]: value });
          if (f === 'status') {
            e.target.className = `tone-${TONE[value]}`;
            toast(`Đã đặt: ${LABEL[value]}`);
          }
        } catch (x) {
          toast(x.message.replace(/^\d{3}: /, ''), 'bad');
        }
      });
      tr.querySelector('[data-del]').addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Xoá ca test', message: 'Xoá ca test này? Lịch sử trạng thái cũng mất.', confirmLabel: 'Xoá' }))) return;
        await postJson('/api/qc/manual', { delete: tr.dataset.id });
        toast('Đã xoá');
        await draw();
      });
    });
  };
  await draw();
}
