import { postJson } from '../api.js';
import { pageHead } from '../analysis.js';
import { toast } from '../toast.js';
import { icon } from '../icons.js';

// Form góp ý / báo lỗi về chính dashboard. Gửi = tạo issue công khai trên GitHub của dự án, nên cần tick xác nhận.
const TYPES = [['bug', 'Báo lỗi'], ['idea', 'Ý tưởng'], ['question', 'Câu hỏi']];

export async function renderFeedback(main) {
  main.innerHTML = `${pageHead('Gửi phản hồi', 'send', 'Góp ý hoặc báo lỗi về e2e-dashboard. Nội dung được đăng thành một issue trên GitHub của dự án.')}
    <div class="fb-layout">
      <form class="panel fb-form" data-fb>
        <div class="form-row"><span class="form-label">Loại</span>
          <div class="opt-group" role="radiogroup" aria-label="Loại phản hồi">${TYPES.map(([v, t], i) => `<label class="opt"><input type="radio" name="type" value="${v}"${i ? '' : ' checked'}><span>${t}</span></label>`).join('')}</div></div>
        <label class="fb-field"><span>Tiêu đề</span><input name="title" maxlength="120" required placeholder="Ví dụ: Trang Tests không lọc được theo tag"></label>
        <label class="fb-field"><span>Chi tiết</span><textarea name="body" rows="9" maxlength="4000" required placeholder="Bạn làm gì, mong đợi gì, thực tế thế nào. Không dán token, mật khẩu hay API key."></textarea>
          <small class="muted" data-count>0 / 4000</small></label>
        <label class="switch"><input type="checkbox" name="includeEnv" checked><span class="track"></span><span>Kèm phiên bản dashboard, Node.js và hệ điều hành</span></label>
        <label class="switch fb-confirm"><input type="checkbox" name="confirm"><span class="track"></span><span>Tôi hiểu nội dung này sẽ được đăng <strong>công khai</strong> thành issue trên GitHub của dự án</span></label>
        <div class="form-row"><button type="submit" class="primary">${icon('send', { size: 14 })}Gửi lên GitHub</button><span class="muted small" data-status role="status"></span></div>
      </form>
      <section class="panel fb-preview"><h2>${icon('file', { size: 16 })} Xem trước</h2><p class="muted small">Đây chính là nội dung issue sẽ được tạo:</p><pre data-preview></pre></section>
    </div>`;
  const form = main.querySelector('[data-fb]');
  const pre = main.querySelector('[data-preview]');
  const status = main.querySelector('[data-status]');
  const preview = () => {
    const f = new FormData(form);
    const type = TYPES.find(([v]) => v === f.get('type'))?.[1] ?? '';
    const env = f.get('includeEnv') === 'on' ? '\n---\nDashboard · Node · OS (đính kèm khi gửi)' : '\n---';
    pre.textContent = `[${type}] ${String(f.get('title') || '(chưa có tiêu đề)')}\n\n${String(f.get('body') || '(chưa có nội dung)')}${env}`;
    main.querySelector('[data-count]').textContent = `${String(f.get('body') ?? '').length} / 4000`;
  };
  form.addEventListener('input', preview);
  form.addEventListener('change', preview);
  preview();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    if (f.get('confirm') !== 'on') {
      toast('Tick xác nhận trước khi gửi', 'bad');
      return;
    }
    const btn = form.querySelector('button[type="submit"]');
    btn.setAttribute('aria-busy', 'true');
    status.textContent = '';
    try {
      const r = await postJson('/api/feedback', { type: f.get('type'), title: f.get('title'), body: f.get('body'), includeEnv: f.get('includeEnv') === 'on', confirm: true });
      status.replaceChildren();
      const a = document.createElement('a');
      a.href = r.url;
      a.target = '_blank';
      a.rel = 'noreferrer';
      a.textContent = 'Đã tạo issue, xem trên GitHub';
      status.append(a);
      form.reset();
      preview();
    } catch (x) {
      status.textContent = x.message.replace(/^\d{3}: /, '');
      status.className = 'small tone-bad';
    } finally {
      btn.removeAttribute('aria-busy');
    }
  });
}
