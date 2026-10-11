import { getJson, postJson } from '../api.js';
import { openAiPanel } from './ai-panel.js';
import { openRunDialog } from './run-dialog.js';
import { historyCells } from './tests.js';
import { runCountPicker, analysisCount, pageHead, emptyBox, meter, fmtPct, copyToClipboard } from '../analysis.js';
import { escapeHtml } from '../format.js';
import { runHref, testHref } from '../router.js';
import { icon } from '../icons.js';

export function flakyRowHtml(t, locked = null) {
  const tone = t.score >= 0.5 ? 'bad' : t.score >= 0.2 ? 'warn' : 'info';
  const test = t.line ? `${t.file}:${t.line}` : t.file;
  return `<tr>
    <td><a href="${testHref(t.key)}"><strong>${escapeHtml(t.title)}</strong></a>${locked ? ` <span class="lock-badge" title="Cách ly đến ${escapeHtml(locked.until.slice(0, 10))}">${icon('lock', { size: 11 })}cách ly</span>` : ''}<div class="muted small"><code>${escapeHtml(test)}</code> · ${escapeHtml(t.target)}${t.agent !== 'default' ? ` · ${escapeHtml(t.agent)}` : ''}</div></td>
    <td>${meter(t.score, tone, `${Math.round(t.score * 100)}`)}</td>
    <td class="num">${escapeHtml(t.flaky)}</td>
    <td class="num">${escapeHtml(t.flips)}${t.sameCommitFlips ? ` <span class="muted small" title="đổi kết quả mà code không đổi">(${escapeHtml(t.sameCommitFlips)} cùng commit)</span>` : ''}</td>
    <td class="num">${fmtPct(t.failRate)}</td>
    <td>${historyCells(t.history, 12)}</td>
    <td><div class="actions-cell">${t.last ? `<a href="${runHref(t.last.runId, t.last.resultId)}">Lần gần nhất</a>` : ''}
      ${t.last ? `<button type="button" class="btn-ai" data-why="${escapeHtml(t.last.runId)}|${escapeHtml(t.last.resultId)}" title="Hỏi AI vì sao test này flaky">${icon('sparkles', { size: 13 })}Vì sao?</button>` : ''}
      ${locked ? `<button type="button" data-unlock="${escapeHtml(t.key)}">${icon('unlock', { size: 13 })}Gỡ</button>` : `<button type="button" data-lock="${escapeHtml(t.key)}" title="Bỏ test khỏi các run trong 14 ngày">${icon('lock', { size: 13 })}Cách ly</button>`}
      <button type="button" data-repeat="${escapeHtml(test)}" data-target="${escapeHtml(t.target)}" data-agent="${escapeHtml(t.agent)}" title="Chạy lặp để xác nhận">${icon('rerun', { size: 13 })}Chạy ×5</button></div></td>
  </tr>`;
}

export async function renderFlaky(main) {
  const picker = runCountPicker(() => renderFlaky(main));
  const [{ tests }, q] = await Promise.all([getJson(`/api/flaky?n=${analysisCount()}`), getJson('/api/quarantine').catch(() => ({ list: [], expired: [] }))]);
  const locks = new Map(q.list.map((x) => [x.key, x]));
  const qbox = q.list.length
    ? `<section class="panel quarantine-box"><strong>${icon('lock', { size: 14 })} ${q.list.length} test đang cách ly</strong>${q.expired.length ? ` <span class="chip tone-bad">${q.expired.length} quá hạn</span>` : ''}
        <ul>${q.list.map((x) => `<li>${escapeHtml(x.title)} <span class="muted small">đến ${escapeHtml(x.until.slice(0, 10))}${q.expired.includes(x.key) ? ' · quá hạn: sửa hoặc gỡ' : ''}</span> <button type="button" class="small-btn" data-unlock="${escapeHtml(x.key)}">Gỡ</button></li>`).join('')}</ul>
        ${q.command ? `<p class="muted small">Dashboard tự bỏ các test này khi bạn tick “Bỏ qua test đang cách ly” lúc chạy. Cho CI: <button type="button" class="small-btn" data-copy-q>${icon('copy', { size: 13 })}Copy lệnh</button> (hoặc <code>/e2e-dashboard quarantine</code>).</p>` : ''}</section>`
    : '';
  const head = pageHead('Flaky', 'shuffle', 'Test có lúc pass lúc fail: pass nhờ retry (flaky) hoặc đổi kết quả giữa các run. Điểm cao hơn khi đổi kết quả trên cùng một commit.', picker.html);
  main.innerHTML = tests.length
    ? `${head}${qbox}<table class="table"><thead><tr><th>Test</th><th>Điểm flaky</th><th class="num">Flaky</th><th class="num">Đổi kết quả</th><th class="num">Tỉ lệ fail</th><th>Lịch sử (cũ → mới)</th><th></th></tr></thead><tbody>${tests.map((t) => flakyRowHtml(t, locks.get(t.key))).join('')}</tbody></table>`
    : `${head}${qbox}${emptyBox('Không có test flaky', 'Trong các run đã chọn, không test nào pass nhờ retry hay đổi kết quả.')}`;
  picker.bind(main);
  main.querySelector('[data-copy-q]')?.addEventListener('click', (e) => copyToClipboard(q.command, e.currentTarget));
  main.querySelectorAll('[data-lock]').forEach((b) =>
    b.addEventListener('click', async () => {
      const t = tests.find((x) => x.key === b.dataset.lock);
      const reason = prompt(`Lý do cách ly "${t.title}" (14 ngày):`, `flaky: ${t.flaky} lần, đổi kết quả ${t.flips} lần`);
      if (reason === null) return;
      await postJson('/api/quarantine', { key: t.key, title: t.title, file: t.file, line: t.line, reason, days: 14 });
      renderFlaky(main);
    }));
  main.querySelectorAll('[data-unlock]').forEach((b) =>
    b.addEventListener('click', async () => {
      await postJson('/api/quarantine/remove', { key: b.dataset.unlock });
      renderFlaky(main);
    }));
  main.querySelectorAll('[data-why]').forEach((b) =>
    b.addEventListener('click', () => {
      const [runId, resultId] = b.dataset.why.split('|');
      const t = tests.find((x) => x.last?.resultId === resultId);
      openAiPanel({ action: 'why-flaky', runId, resultId, title: `Vì sao flaky · ${t?.title ?? ''}` });
    }));
  main.querySelectorAll('[data-repeat]').forEach((b) =>
    b.addEventListener('click', () => openRunDialog({ tests: [b.dataset.repeat], targets: [b.dataset.target], agents: [b.dataset.agent], repeatEach: 5, title: 'Chạy lặp để xác nhận flaky' })));
}
