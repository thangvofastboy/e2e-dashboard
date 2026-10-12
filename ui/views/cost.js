import { getJson, postJson, isExport } from '../api.js';
import { confirmDialog } from '../confirm.js';
import { toast } from '../toast.js';
import { lineChart, shareBar, hbarChart, stackedBarChart } from '../charts.js';
import { runCountPicker, analysisCount, pageHead, emptyBox, fmtPct, fmtUsd } from '../analysis.js';
import { escapeHtml, fmtDuration, fmtTokens, fmtRelative } from '../format.js';
import { icon } from '../icons.js';

const PHASES = [['setup', 'Setup'], ['beforeEach', 'beforeEach'], ['afterEach', 'afterEach'], ['body', 'Thân test']];
const CACHE_SEGMENTS = [['replayed', 'Chạy lại từ cache', 'good'], ['handedOff', 'Agent tiếp quản', 'warn'], ['missed', 'Không có cache', 'bad'], ['off', 'Tắt cache', 'muted']];

function costKpi(ic, label, value, sub = '', tone = 'info') {
  return `<div class="kpi tone-${tone}"><div class="kpi-top"><span class="kpi-ic">${icon(ic, { size: 17 })}</span></div><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${escapeHtml(value)}</div><div class="kpi-sub">${sub}</div></div>`;
}

const fmtCacheSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// What `e2e cache ls|stats` shows, per test, with the same clean-up as `e2e cache clear` (stale / orphan / one test / all).
function cachePanel(c) {
  if (!c || (!c.entries.length && !c.unreadable)) return '';
  const stale = c.entries.filter((e) => e.stale).length;
  const orphan = c.entries.filter((e) => e.orphan).length;
  const rows = c.tests.map((t) => `<tr><td><code>${escapeHtml(t.testId ?? '-')}</code>${t.orphan ? ' <span class="tag err-class" title="Test không còn trong run gần nhất">mồ côi</span>' : ''}</td><td>${escapeHtml(t.targetId ?? '-')}</td><td class="num">${t.entries}</td><td class="num">${t.actions}</td><td class="num">${fmtCacheSize(t.bytes)}</td><td title="${escapeHtml(t.newest)}">${escapeHtml(fmtRelative(t.newest))}${t.stale ? ` · <span class="tone-warn">${t.stale} cũ</span>` : ''}</td>${isExport() ? '' : `<td><button type="button" data-cache-clear-test="${escapeHtml(t.testId ?? '')}" title="Xoá cache của test này (lần chạy sau ghi lại)">${icon('x', { size: 13 })}Xoá</button></td>`}</tr>`).join('');
  return `<section class="panel replay-cache"><h2>${icon('recycle', { size: 16 })} Replay cache <span class="muted small"><code>${escapeHtml(c.dir ?? '')}</code> · ${c.entries.length} bản ghi · ${fmtCacheSize(c.bytes)}${c.unreadable ? ` · ${c.unreadable} file không đọc được (<code>e2e cache clear</code>)` : ''}</span></h2>
    ${stale ? `<p class="small tone-warn">${icon('alert', { size: 14 })}${stale} bản ghi cũ hơn 30 ngày — app có thể đã đổi, replay dễ trượt (<code>REPLAY_STALE</code>).</p>` : ''}
    <div class="table-wrap"><table class="table compact"><thead><tr><th>Test</th><th>Target</th><th class="num">Bản ghi</th><th class="num">Action</th><th class="num">Dung lượng</th><th>Mới nhất</th>${isExport() ? '' : '<th></th>'}</tr></thead><tbody>${rows}</tbody></table></div>
    ${isExport() ? '' : `<div class="actions">${orphan ? `<button type="button" data-cache-clear="orphans">${icon('x', { size: 14 })}Xoá ${orphan} bản ghi mồ côi</button>` : ''}<button type="button" data-cache-clear="all">${icon('x', { size: 14 })}Xoá toàn bộ cache</button></div>`}</section>`;
}

export async function renderCost(main) {
  const picker = runCountPicker(() => renderCost(main));
  const [c, timing, cache] = await Promise.all([getJson(`/api/cost?n=${analysisCount()}`), getJson(`/api/timing?n=${analysisCount()}`).catch(() => null), isExport() ? null : getJson('/api/cache').catch(() => null)]);
  const head = pageHead('Chi phí & cache', 'coins', 'Token, chi phí ước tính và hiệu quả replay cache của các step agent.', picker.html);
  if (!c.runs.length) {
    main.innerHTML = `${head}${emptyBox('Chưa có run nào')}`;
    picker.bind(main);
    return;
  }
  const chron = [...c.runs].reverse();
  const when = (r) => new Date(r.startedAt).toLocaleString('vi-VN');
  const acts = c.cache.replayed + c.cache.handedOff + c.cache.missed;
  const replayShare = acts ? c.cache.replayed / acts : null;
  const hasCost = c.runs.some((r) => r.costUsd != null);
  const estimated = c.runs.some((r) => r.estimated);
  const budget = c.budget?.over?.length
    ? `<div class="banner tone-bad">${icon('alert', { size: 15 })}Run gần nhất vượt ngân sách: ${c.budget.over.map((o) => (o.key === 'tokensPerRun' ? `${fmtTokens(o.value)} / ${fmtTokens(o.limit)} token` : `${fmtUsd(o.value)} / ${fmtUsd(o.limit)}`)).join(' · ')}</div>`
    : c.budget ? `<div class="banner tone-good">${icon('check', { size: 15 })}Run gần nhất trong ngân sách${c.budget.tokensPerRun ? ` (${fmtTokens(c.budget.tokensPerRun)} token/run)` : ''}${c.budget.costPerRun ? ` (${fmtUsd(c.budget.costPerRun)}/run)` : ''}.</div>` : '';
  main.innerHTML = `${head}${budget}
    <section class="kpis">
      ${costKpi('coins', 'Token / run (TB)', fmtTokens(c.totals.avgTokens), `${escapeHtml(fmtTokens(c.totals.tokens))} tổng · ${escapeHtml(c.runs.length)} run`)}
      ${costKpi('bolt', 'Model call', String(c.totals.modelCalls), 'Tổng trong các run đã chọn')}
      ${costKpi('gauge', 'Chi phí / run (TB)', hasCost ? fmtUsd(c.totals.avgCostUsd) : '—', hasCost ? `${escapeHtml(fmtUsd(c.totals.costUsd))} tổng${estimated ? ' · ước tính theo "pricing"' : ''}` : 'thêm <code>"pricing"</code> vào config để ước tính', 'info')}
      ${costKpi('recycle', 'Replay cache', fmtPct(replayShare), acts ? `${escapeHtml(c.cache.replayed)}/${escapeHtml(acts)} step agent.act` : 'Chưa có step agent.act', replayShare == null ? 'muted' : replayShare >= 0.8 ? 'good' : replayShare >= 0.5 ? 'warn' : 'bad')}
    </section>
    <section class="charts">
      <figure><figcaption>${icon('coins')}Token theo run</figcaption>${lineChart({ points: chron.map((r) => ({ label: when(r), value: r.total, tip: `${when(r)}: ${fmtTokens(r.tokens.input)} vào / ${fmtTokens(r.tokens.output)} ra` })), yFormat: fmtTokens, ariaLabel: 'Token theo run', area: true })}</figure>
      ${hasCost ? `<figure><figcaption>${icon('gauge')}Chi phí theo run</figcaption>${lineChart({ points: chron.map((r) => ({ label: when(r), value: r.costUsd })), yFormat: fmtUsd, ariaLabel: 'Chi phí theo run', area: true })}</figure>` : ''}
      <figure><figcaption>${icon('recycle')}Kết quả cache của agent.act</figcaption><div class="share-wrap">${shareBar({ segments: CACHE_SEGMENTS.map(([k, label]) => ({ key: k, label, value: c.cache[k] })), center: fmtPct(replayShare), centerLabel: 'Replay', ariaLabel: 'Kết quả cache' })}
        <div class="legend">${CACHE_SEGMENTS.filter(([k]) => c.cache[k]).map(([k, label, tone]) => `<span class="tone-${tone}"><i class="swatch s-${k}"></i>${escapeHtml(label)}: ${escapeHtml(c.cache[k])}</span>`).join('')}</div></div></figure>
      <figure><figcaption>${icon('alert')}Vì sao không replay được</figcaption>${hbarChart({ items: c.missReasons.slice(0, 8).map((r) => ({ label: r.reason, value: r.count, tone: 'warn' })), format: String })}</figure>
      <figure><figcaption>${icon('flask')}Test tốn token nhất (TB / run)</figcaption>${hbarChart({ items: c.tests.filter((t) => t.avgTokens).slice(0, 8).map((t) => ({ label: t.title, value: t.avgTokens, tone: 'info' })), format: fmtTokens })}</figure>
      <figure><figcaption>${icon('bulb')}Token theo vai trò model</figcaption>${hbarChart({ items: c.roles.slice(0, 6).map((r) => ({ label: r.role, value: r.tokens, tone: 'info' })), format: fmtTokens })}</figure>
      ${timing?.share ? `<figure><figcaption>${icon('clock')}Thời gian theo giai đoạn</figcaption><div class="share-wrap">${shareBar({ segments: PHASES.map(([k, label]) => ({ key: k, label, value: Math.round(timing.share[k] * 1000) })), center: '', ariaLabel: 'Thời gian theo giai đoạn' })}
        <div class="legend">${PHASES.map(([k, label]) => `<span><i class="swatch s-${k}"></i>${escapeHtml(label)}: ${escapeHtml(fmtPct(timing.share[k]))}</span>`).join('')}</div></div>
        ${timing.setups.length ? `<p class="muted small">Setup chậm nhất: ${timing.setups.slice(0, 3).map((x) => `${escapeHtml(x.name)} (${escapeHtml(fmtDuration(x.avgMs))})`).join(', ')}</p>` : ''}</figure>
      <figure><figcaption>${icon('clock')}Setup + hook theo run</figcaption>${stackedBarChart({ bars: [...timing.runs].reverse().map((r) => ({ label: when(r), segments: { setup: r.setup, beforeEach: r.beforeEach, afterEach: r.afterEach }, tip: `${when(r)}: setup ${fmtDuration(r.setup)}, beforeEach ${fmtDuration(r.beforeEach)}, afterEach ${fmtDuration(r.afterEach)}, thân test ${fmtDuration(r.body)}` })), keys: ['setup', 'beforeEach', 'afterEach'], yFormat: fmtDuration, ariaLabel: 'Setup và hook theo run' })}</figure>` : ''}
      <figure class="wide"><figcaption>${icon('timer')}Step chậm nhất (trung bình)</figcaption>${hbarChart({ items: c.slowSteps.slice(0, 10).map((s) => ({ label: `${s.title} › ${s.api} ${s.label}`, value: s.avgMs, tone: 'info', tip: `${s.title} › ${s.api} ${s.label}: TB ${fmtDuration(s.avgMs)}, tối đa ${fmtDuration(s.maxMs)} (${s.samples} lần)` })), format: fmtDuration })}</figure>
    </section>
    ${cachePanel(cache)}
    <p class="muted small">Ngân sách và đơn giá: <code>"budget": { "tokensPerRun": 200000, "costPerRun": 0.5 }</code>, <code>"pricing": { "inputPerMTok": 3, "outputPerMTok": 15 }</code> trong <code>.e2e-dashboard/config.json</code>. Report có <code>usage.estimatedCostUsd</code> thì dùng số đó.</p>`;
  picker.bind(main);
  main.querySelectorAll('[data-cache-clear], [data-cache-clear-test]').forEach((b) =>
    b.addEventListener('click', async () => {
      const test = b.dataset.cacheClearTest;
      const kind = b.dataset.cacheClear;
      if (!(await confirmDialog({ title: 'Xoá replay cache', message: test != null ? `Xoá cache của ${test || 'test này'}? Lần chạy sau sẽ gọi model để ghi lại.` : kind === 'all' ? 'Xoá toàn bộ replay cache? Mọi agent step sẽ gọi model ở lần chạy sau.' : 'Xoá các bản ghi của test không còn tồn tại?', confirmLabel: 'Xoá cache' }))) return;
      try {
        const { removed } = await postJson('/api/cache/clear', test != null ? { testId: test } : kind === 'all' ? { all: true } : { orphans: true });
        toast(`Đã xoá ${removed} bản ghi cache`);
        renderCost(main);
      } catch (e) {
        toast(`Không xoá được: ${e.message}`, 'bad');
      }
    }));
}
