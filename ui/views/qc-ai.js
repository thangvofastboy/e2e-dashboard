import { pageHead } from '../analysis.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';
import { toast } from '../toast.js';
import { openAiPanel } from './ai-panel.js';

// AI hỗ trợ QC: mỗi công cụ một ô nhập + nút, kết quả mở trong AI panel (action ở server/app.mjs, prompt ở server/ai.mjs)
const TOOLS = [
  { action: 'req-coverage', title: 'Độ phủ theo yêu cầu', icon: 'check', hint: 'Dán yêu cầu / acceptance criteria của ticket: AI chỉ ra tiêu chí nào đã có test, tiêu chí nào còn thiếu.', placeholder: 'Là người dùng, tôi muốn… \nAC1: … \nAC2: …' },
  { action: 'explore-charter', title: 'Charter test khám phá', icon: 'crosshair', hint: 'AI đọc thay đổi code so với nhánh gốc, soạn charter cho phiên test khám phá kèm checklist edge case.', base: true },
  { action: 'test-data', title: 'Sinh dữ liệu test', icon: 'list', hint: 'Mô tả form / field / API: AI đề xuất giá trị hợp lệ, giá trị biên và không hợp lệ kèm kết quả mong đợi.', placeholder: 'Form đăng ký: email (bắt buộc), mật khẩu 8–64 ký tự, số điện thoại VN…' },
  { action: 'bug-dupe', title: 'Kiểm tra bug trùng', icon: 'layers', hint: 'Trước khi log bug: dán mô tả / thông báo lỗi, AI so với các nhóm lỗi đã gặp trong lịch sử test.', placeholder: 'Bấm Thanh toán báo lỗi 500 "payment_intent missing"…' },
];

const toolHtml = (t) => `<section class="panel qc-ai-tool"><h2>${icon(t.icon, { size: 16 })} ${escapeHtml(t.title)}</h2>
  <p class="muted small">${escapeHtml(t.hint)}</p>
  <form data-qc-ai="${t.action}" class="qc-ai-form">${t.base
    ? '<label class="fb-field"><span>So với nhánh</span><input name="base" value="main" maxlength="100" autocomplete="off" spellcheck="false"></label>'
    : `<textarea name="text" rows="5" maxlength="8000" placeholder="${escapeHtml(t.placeholder)}" aria-label="${escapeHtml(t.title)}"></textarea>`}
    <div class="form-row"><button type="submit" class="btn-ai">${icon('yinyang', { size: 14 })}${escapeHtml(t.title)}</button></div></form></section>`;

export function renderQcAi(main) {
  main.innerHTML = `${pageHead('AI hỗ trợ QC', 'yinyang', 'Các công cụ AI giúp QC: đối chiếu yêu cầu với test, soạn charter khám phá, sinh dữ liệu test, kiểm tra bug trùng. AI dùng prompt / quy tắc của project (Projects → Sửa project).')}
    <div class="qc-ai-grid">${TOOLS.map(toolHtml).join('')}</div>`;
  main.querySelectorAll('[data-qc-ai]').forEach((f) =>
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const t = TOOLS.find((x) => x.action === f.dataset.qcAi);
      const extra = t.base ? { base: f.base.value.trim() || 'main' } : { text: f.text.value };
      if (!t.base && extra.text.trim().length < 10) return toast('Nhập ít nhất 10 ký tự', 'warn');
      openAiPanel({ action: t.action, runId: null, title: t.title, extra });
    }));
}
