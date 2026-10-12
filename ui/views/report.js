import { getJson, postJson, isExport } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml } from '../format.js';
import { healthPanel } from './overview.js';
import { sloPanel } from './quality.js';
import { pageHead } from '../analysis.js';
import { renderMarkdown } from '../markdown.js';
import { icon } from '../icons.js';

let reportDays = 30;

// A printable report (browser "Save as PDF"): health, SLO, gate and the digest of the period.
export async function renderReport(main) {
  const [d, h, slo, gate] = await Promise.all([getJson(`/api/digest?days=${reportDays}`), getJson('/api/health').catch(() => ({})), getJson('/api/slo').catch(() => null), getJson('/api/gate').catch(() => null)]);
  main.innerHTML = `${pageHead('Báo cáo', 'newspaper', 'Bản in được của sức khoẻ bộ test: dùng “In / Lưu PDF” rồi chọn “Save as PDF”. Xuất số liệu thô bằng CSV.', `
      <label class="no-print">Khoảng <select data-days>${[7, 30, 90].map((n) => `<option value="${n}" ${n === reportDays ? 'selected' : ''}>${n} ngày</option>`).join('')}</select></label>
      <button type="button" class="primary no-print" data-print>${icon('download', { size: 14 })}In / Lưu PDF</button>
      <a class="button no-print" href="/api/export/runs.csv" download>CSV run</a><a class="button no-print" href="/api/export/tests.csv" download>CSV test</a><a class="button no-print" href="/api/export/flaky.csv" download>CSV flaky</a>`)}
    ${isExport() ? '' : await scheduledReportsHtml()}
    <div class="report fill-me">${healthPanel(h.health)}${slo ? sloPanel(slo, gate) : ''}<article class="panel md digest">${renderMarkdown(d.markdown)}</article>
      <p class="muted small">Tạo lúc ${new Date().toLocaleString('vi-VN')} · e2e-dashboard</p></div>`;
  main.querySelector('[data-print]').addEventListener('click', () => window.print());
  main.querySelectorAll('[data-send-report]').forEach((btn) => btn.addEventListener('click', async () => {
    btn.disabled = true;
    const r = await postJson('/api/reports/send', { kind: btn.dataset.sendReport }).catch((e) => ({ error: e.message }));
    btn.disabled = false;
    if (r.error) return toast(r.error, 'bad');
    toast(`Đã tạo báo cáo${r.webhooks?.length ? ` và gửi ${r.webhooks.filter((x) => x.ok).length}/${r.webhooks.length} webhook` : ''}${r.email ? (r.email.ok ? ', đã gửi email' : `, email lỗi: ${r.email.error}`) : ''}`, 'good', 6000);
    renderReport(main);
  }));
  main.querySelector('[data-publish]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; // e.target may be the inner <svg>; currentTarget is null after await
    btn.disabled = true;
    const r = await postJson('/api/publish', {}).catch((x) => ({ error: x.message }));
    btn.disabled = false;
    if (r.error) return toast(r.error, 'bad');
    toast(`Đã xuất trang tĩnh (${r.runs} run): ${r.index}`, 'good', 8000);
  });
  main.querySelector('[data-days]').addEventListener('change', (e) => {
    reportDays = Number(e.target.value) || 30;
    renderReport(main);
  });
}

const WEEKDAY_VI = { mon: 'Thứ 2', tue: 'Thứ 3', wed: 'Thứ 4', thu: 'Thứ 5', fri: 'Thứ 6', sat: 'Thứ 7', sun: 'Chủ nhật' };

export function scheduleText(spec, kind) {
  if (!spec) return 'Chưa đặt';
  const [a, t] = String(spec).trim().split(/\s+/);
  return kind === 'weekly' ? `${WEEKDAY_VI[a.toLowerCase()] ?? a} lúc ${t}` : `Ngày ${a} hằng tháng lúc ${t}`;
}

// Weekly / monthly reports sent automatically, plus the static site for the whole team (M7).
async function scheduledReportsHtml() {
  const r = await getJson('/api/reports').catch(() => null);
  if (!r) return '';
  const row = (kind, label, href) => `<tr><td><strong>${label}</strong></td><td>${escapeHtml(scheduleText(r.schedule[kind], kind))}${r.next[kind] ? `<div class="muted small">Lần tới ${escapeHtml(new Date(r.next[kind]).toLocaleString('vi-VN'))}</div>` : ''}</td>
    <td class="small">${r.sent[kind] ? escapeHtml(new Date(r.sent[kind]).toLocaleString('vi-VN')) : '—'}</td>
    <td class="no-wrap"><a class="button" href="${href}" target="_blank" rel="noopener">${icon('eye', { size: 14 })}Xem</a> <button type="button" data-send-report="${kind}">${icon('send', { size: 14 })}Gửi ngay</button></td></tr>`;
  return `<section class="panel no-print"><h2>${icon('clock', { size: 15 })} Báo cáo tự động</h2>
    <table class="table compact"><thead><tr><th></th><th>Lịch</th><th>Gửi lần cuối</th><th></th></tr></thead><tbody>${row('weekly', 'Tuần', '/api/reports/week.html')}${row('monthly', 'Tháng', '/api/reports/month.html')}</tbody></table>
    <p class="muted small">Gửi tới: ${r.webhooks.length ? `webhook ${r.webhooks.map((h) => `<code>${escapeHtml(h)}</code>`).join(', ')}` : 'Chưa có webhook nhận sự kiện <code>report</code>'}${r.email ? ` · email (${escapeHtml(r.email.to)} người nhận)` : ''}. Bản HTML lưu ở <code>.e2e-dashboard/reports/</code>.</p>
    <p class="muted small">Đặt lịch trong <code>.e2e-dashboard/config.json</code>: <code>"reports": { "weekly": "mon 09:00", "monthly": "1 09:00" }</code>. Email (qua <code>sendmail</code> trên máy) đặt trong <code>~/.e2e-dashboard/config.json</code>: <code>"email": { "to": ["qa@công-ty.com"] }</code>.</p>
    <h3>${icon('external', { size: 14 })} Trang báo cáo tĩnh cho cả team</h3>
    <p class="muted small">Xuất toàn bộ (90 ngày, lịch 12 tháng, 10 run gần nhất) thành thư mục HTML: <code>${escapeHtml(r.siteDir)}</code>. Đẩy lên GitHub Pages hoặc thư mục chung để PM/QA lead xem, không cần cài plugin. Lệnh: <code>/e2e-dashboard publish [thư mục]</code>.</p>
    <button type="button" data-publish>${icon('upload', { size: 14 })}Xuất trang tĩnh</button></section>`;
}
