import { getJson } from '../api.js';
import { pageHead, emptyBox } from '../analysis.js';
import { escapeHtml, statusBadge } from '../format.js';
import { icon } from '../icons.js';

// Ma trận build: một cột cho mỗi build (branch@commit), một hàng cho mỗi test. Hàng đổi kết quả giữa các build lên đầu.
export async function renderBuild(main) {
  const n = Number(new URLSearchParams(location.hash.split('?')[1] ?? '').get('builds')) || 8;
  const m = await getJson(`/api/build-matrix?builds=${n}`);
  const picker = `<label class="no-print">Số build <select data-builds>${[4, 8, 12].map((v) => `<option value="${v}"${v === n ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    <a class="button no-print" href="/api/export/bugs.csv" download>${icon('download', { size: 14 })}Xuất bug (CSV)</a>`;
  const head = pageHead('Ma trận build', 'grid', 'Cùng một test qua các build: thấy ngay build nào làm test đổi kết quả.', picker);
  if (!m.builds.length) {
    main.innerHTML = `${head}${emptyBox('Chưa có build nào', 'Cần ít nhất một run đã lưu.')}`;
  } else {
    const changed = m.rows.filter((r) => r.changed).length;
    main.innerHTML = `${head}
      <p class="muted small">${m.rows.length} test · ${changed} test đổi kết quả giữa các build</p>
      <section class="panel"><div class="table-wrap"><table class="table build-matrix">
        <thead><tr><th>Test</th>${m.builds.map((b) => `<th title="${escapeHtml(b.startedAt)}"><code>${escapeHtml(b.key)}</code><div>${statusBadge(b.status)}</div></th>`).join('')}</tr></thead>
        <tbody>${m.rows.map((r) => `<tr class="${r.changed ? 'bm-changed' : ''}"><td><strong>${escapeHtml(r.title)}</strong><div class="muted small">${escapeHtml(r.file ?? '')} · ${escapeHtml(r.target)}</div></td>${r.cells.map((c) => `<td class="bm-cell">${c ? statusBadge(c) : '<span class="muted">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div></section>`;
  }
  main.querySelector('[data-builds]')?.addEventListener('change', (e) => {
    location.hash = `#/build?builds=${e.target.value}`;
  });
}
