import { getJson } from '../api.js';
import { runCountPicker, analysisCount, pageHead, emptyBox, meter, fmtPct } from '../analysis.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';

const DIM_LABEL = { target: 'Target', os: 'Hệ điều hành', browser: 'Trình duyệt', runner: 'Phiên bản e2e', hour: 'Giờ chạy', branch: 'Branch', agent: 'Agent / persona', engine: 'Engine' };

export function envTableHtml(dim, rows, overall) {
  return `<section class="panel"><h2>${escapeHtml(DIM_LABEL[dim] ?? dim)}</h2><table class="table compact"><tbody>${rows.map((r) => `<tr><td>${escapeHtml(r.value)}</td>
    <td>${meter(r.failRate, r.lift >= 1.5 && r.fails >= 2 ? 'bad' : r.failRate > overall ? 'warn' : 'good', fmtPct(r.failRate))}</td><td class="num muted small">${escapeHtml(r.fails)}/${escapeHtml(r.results)}</td></tr>`).join('')}</tbody></table></section>`;
}

export async function renderEnvironment(main) {
  const picker = runCountPicker(() => renderEnvironment(main));
  const d = await getJson(`/api/environment?n=${analysisCount()}`);
  const head = pageHead('Lỗi theo môi trường', 'gauge', `Tỉ lệ fail theo target, hệ điều hành, trình duyệt, phiên bản e2e, giờ chạy, branch, agent và engine. Tỉ lệ chung: <strong>${escapeHtml(fmtPct(d.overall))}</strong> (${escapeHtml(d.fails)}/${escapeHtml(d.total)} kết quả).`, picker.html);
  const dims = Object.entries(d.dims);
  main.innerHTML = dims.length
    ? `${head}${d.hotspots.map((h) => `<div class="banner tone-bad">${icon('alert', { size: 15 })}Fail tập trung ở <strong>${escapeHtml(DIM_LABEL[h.dim] ?? h.dim)} = ${escapeHtml(h.value)}</strong>: ${escapeHtml(fmtPct(h.failRate))} (gấp ${escapeHtml(h.lift.toFixed(1))} lần tỉ lệ chung)</div>`).join('')}
      <div class="two-col">${dims.map(([dim, rows]) => envTableHtml(dim, rows, d.overall)).join('')}</div>`
    : `${head}${emptyBox('Chưa đủ dữ liệu', 'Cần ít nhất hai giá trị khác nhau của một chiều (vd. hai target) với ≥ 3 kết quả mỗi giá trị.')}`;
  picker.bind(main);
}
