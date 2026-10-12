import { getJson, postJson } from '../api.js';
import { confirmDialog } from '../confirm.js';
import { pageHead, emptyBox } from '../analysis.js';
import { toast } from '../toast.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';
import { runHref } from '../router.js';

// QC xác nhận: bug đã biết mà run mới nhất đã pass (chờ xác nhận đã sửa), waiver có hạn cho lỗi chưa sửa kịp, nhật ký thay đổi.
const VERIFY_FIELD = { note: 'Ghi chú', known: 'Known bug', waiver: 'Waiver', ack: 'Chưa sửa (đã xem run)' };
const vName = (key) => {
  const id = String(key).split('|')[0].replace(/^.*::/, '');
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
};
const vWhen = (iso) => escapeHtml(String(iso ?? '').slice(0, 16).replace('T', ' '));
const vFail = (x) => toast(x.message.replace(/^\d{3}: /, ''), 'bad');

function verifyQueueHtml(queue) {
  if (!queue.length) return emptyBox('Không có bug nào chờ xác nhận', 'Khi test có known bug pass ở run mới nhất, nó hiện ở đây để bạn xác nhận đã sửa hoặc báo chưa đúng.');
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Test</th><th>Known bug</th><th>Pass ở run</th><th>Lúc</th><th></th></tr></thead><tbody>${queue.map((q) => `<tr data-key="${escapeHtml(q.key)}" data-run="${escapeHtml(q.runId)}">
    <td>${escapeHtml(q.title)}${q.note ? `<div class="muted small">${escapeHtml(q.note)}</div>` : ''}</td><td><code>${escapeHtml(q.known)}</code></td>
    <td><a href="${runHref(q.runId)}"><code>${escapeHtml(q.runId.slice(0, 18))}</code></a></td><td class="muted small">${vWhen(q.startedAt)}</td>
    <td class="row-actions"><button type="button" class="small-btn primary" data-fixed>${icon('check', { size: 13 })}Đã sửa</button><button type="button" class="small-btn" data-notfixed>${icon('rerun', { size: 13 })}Chưa đúng</button></td></tr>`).join('')}</tbody></table></div>`;
}

function verifyWaiverHtml(d) {
  const inAWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const rows = d.waivers.map((w) => `<tr data-key="${escapeHtml(w.key)}"><td>${escapeHtml(vName(w.key))}</td><td class="${w.active ? '' : 'muted'}">${escapeHtml(w.until)}${w.active ? '' : ' (hết hạn)'}</td><td>${escapeHtml(w.reason)}</td><td><button type="button" class="small-btn" data-unwaive>${icon('close', { size: 13 })}Gỡ</button></td></tr>`).join('');
  return `<form class="fb-form" data-waive>
      <div class="form-row"><select name="key" required aria-label="Test đang fail">${d.failing.length ? d.failing.map((f) => `<option value="${escapeHtml(f.key)}">${escapeHtml(f.title)}</option>`).join('') : '<option value="">Run mới nhất không có test vFail</option>'}</select>
      <input name="until" type="date" value="${inAWeek}" required aria-label="Hết hạn"><input name="reason" required minlength="5" maxlength="300" placeholder="Lý do bỏ qua (bắt buộc)" aria-label="Lý do"><button type="submit" class="primary"${d.failing.length ? '' : ' disabled'}>${icon('check', { size: 14 })}Tạo waiver</button></div>
      <p class="muted small">Test có waiver còn hạn không bị tính là fail mới ở cổng chất lượng; hết hạn là tính lại.</p></form>
    ${d.waivers.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Test</th><th>Hết hạn</th><th>Lý do</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}`;
}

const verifyAuditHtml = (items) => (items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Lúc</th><th>Test</th><th>Mục</th><th>Từ</th><th>Thành</th></tr></thead><tbody>${items.map((a) => `<tr><td class="muted small">${vWhen(a.at)}</td><td>${escapeHtml(vName(a.key))}</td><td>${escapeHtml(VERIFY_FIELD[a.field] ?? a.field)}</td><td class="muted">${escapeHtml(a.from ?? '—')}</td><td>${escapeHtml(a.to ?? '—')}</td></tr>`).join('')}</tbody></table></div>` : emptyBox('Chưa có thay đổi nào', 'Mọi thay đổi ghi chú, known bug, waiver và xác nhận được ghi lại ở đây.'));

export async function renderVerify(main) {
  const draw = async () => {
    const [d, audit] = await Promise.all([getJson('/api/qc/verify'), getJson('/api/qc/audit')]);
    main.innerHTML = `${pageHead('QC xác nhận', 'check', 'Bug đã biết có vẻ đã sửa, waiver có hạn và nhật ký thay đổi.')}
      <section class="panel"><h2>${icon('check', { size: 16 })} Chờ xác nhận (${d.queue.length})</h2>${verifyQueueHtml(d.queue)}</section>
      <section class="panel"><h2>${icon('timer', { size: 16 })} Waiver có hạn</h2>${verifyWaiverHtml(d)}</section>
      <section class="panel"><h2>${icon('list', { size: 16 })} Nhật ký thay đổi</h2>${verifyAuditHtml(audit.items)}</section>`;
    const save = (key, body, msg) => postJson('/api/qc/notes', { key, ...body }).then(() => { toast(msg); return draw(); }).catch(vFail);
    for (const tr of main.querySelectorAll('tr[data-key][data-run]')) {
      tr.querySelector('[data-fixed]').addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Xác nhận đã sửa', message: `Gỡ known bug ${tr.querySelector('code').textContent} khỏi test này? Test vFail lại sẽ được tính là lỗi mới.`, confirmLabel: 'Đã sửa', danger: false }))) return;
        await save(tr.dataset.key, { known: '', ack: null }, 'Đã xác nhận sửa');
      });
      tr.querySelector('[data-notfixed]').addEventListener('click', () => save(tr.dataset.key, { ack: tr.dataset.run }, 'Giữ known bug, chờ run pass tiếp theo'));
    }
    main.querySelector('[data-waive]').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      if (f.get('key')) save(f.get('key'), { waiver: { until: f.get('until'), reason: f.get('reason') } }, 'Đã tạo waiver');
    });
    for (const tr of main.querySelectorAll('tr[data-key]:not([data-run])')) {
      tr.querySelector('[data-unwaive]')?.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Gỡ waiver', message: 'Gỡ waiver: test này fail sẽ được tính lại ở cổng chất lượng.', confirmLabel: 'Gỡ' }))) return;
        await save(tr.dataset.key, { waiver: null }, 'Đã gỡ waiver');
      });
    }
  };
  await draw();
}
