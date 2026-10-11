import { getJson } from '../api.js';
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
    <div class="report">${healthPanel(h.health)}${slo ? sloPanel(slo, gate) : ''}<article class="panel md digest">${renderMarkdown(d.markdown)}</article>
      <p class="muted small">Tạo lúc ${new Date().toLocaleString('vi-VN')} · e2e-dashboard</p></div>`;
  main.querySelector('[data-print]').addEventListener('click', () => window.print());
  main.querySelector('[data-days]').addEventListener('change', (e) => {
    reportDays = Number(e.target.value) || 30;
    renderReport(main);
  });
}
