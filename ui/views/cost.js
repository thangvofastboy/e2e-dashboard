import { getJson } from '../api.js';
import { lineChart, donutChart, hbarChart, stackedBarChart } from '../charts.js';
import { runCountPicker, analysisCount, pageHead, emptyBox, fmtPct, fmtUsd } from '../analysis.js';
import { escapeHtml, fmtDuration, fmtTokens } from '../format.js';
import { icon } from '../icons.js';

const PHASES = [['setup', 'setup'], ['beforeEach', 'beforeEach'], ['afterEach', 'afterEach'], ['body', 'thân test']];
const CACHE_SEGMENTS = [['replayed', 'chạy lại từ cache', 'good'], ['handedOff', 'agent tiếp quản', 'warn'], ['missed', 'không có cache', 'bad'], ['off', 'tắt cache', 'muted']];

function costKpi(ic, label, value, sub = '', tone = 'info') {
  return `<div class="kpi tone-${tone}"><div class="kpi-top"><span class="kpi-ic">${icon(ic, { size: 17 })}</span></div><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${escapeHtml(value)}</div><div class="kpi-sub">${sub}</div></div>`;
}

export async function renderCost(main) {
  const picker = runCountPicker(() => renderCost(main));
  const [c, timing] = await Promise.all([getJson(`/api/cost?n=${analysisCount()}`), getJson(`/api/timing?n=${analysisCount()}`).catch(() => null)]);
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
      ${costKpi('bolt', 'Model call', String(c.totals.modelCalls), 'tổng trong các run đã chọn')}
      ${costKpi('gauge', 'Chi phí / run (TB)', hasCost ? fmtUsd(c.totals.avgCostUsd) : '—', hasCost ? `${escapeHtml(fmtUsd(c.totals.costUsd))} tổng${estimated ? ' · ước tính theo "pricing"' : ''}` : 'thêm <code>"pricing"</code> vào config để ước tính', 'info')}
      ${costKpi('recycle', 'Replay cache', fmtPct(replayShare), acts ? `${escapeHtml(c.cache.replayed)}/${escapeHtml(acts)} step agent.act` : 'chưa có step agent.act', replayShare == null ? 'muted' : replayShare >= 0.8 ? 'good' : replayShare >= 0.5 ? 'warn' : 'bad')}
    </section>
    <section class="charts">
      <figure><figcaption>${icon('coins')}Token theo run</figcaption>${lineChart({ points: chron.map((r) => ({ label: when(r), value: r.total, tip: `${when(r)}: ${fmtTokens(r.tokens.input)} vào / ${fmtTokens(r.tokens.output)} ra` })), yFormat: fmtTokens, ariaLabel: 'Token theo run', area: true })}</figure>
      ${hasCost ? `<figure><figcaption>${icon('gauge')}Chi phí theo run</figcaption>${lineChart({ points: chron.map((r) => ({ label: when(r), value: r.costUsd })), yFormat: fmtUsd, ariaLabel: 'Chi phí theo run', area: true })}</figure>` : ''}
      <figure><figcaption>${icon('recycle')}Kết quả cache của agent.act</figcaption><div class="donut-wrap">${donutChart({ segments: CACHE_SEGMENTS.map(([k, label]) => ({ key: k, label, value: c.cache[k] })), center: fmtPct(replayShare), ariaLabel: 'Kết quả cache' })}
        <div class="legend">${CACHE_SEGMENTS.filter(([k]) => c.cache[k]).map(([k, label, tone]) => `<span class="tone-${tone}"><i class="swatch s-${k}"></i>${escapeHtml(label)}: ${escapeHtml(c.cache[k])}</span>`).join('')}</div></div></figure>
      <figure><figcaption>${icon('alert')}Vì sao không replay được</figcaption>${hbarChart({ items: c.missReasons.slice(0, 8).map((r) => ({ label: r.reason, value: r.count, tone: 'warn' })), format: String })}</figure>
      <figure><figcaption>${icon('flask')}Test tốn token nhất (TB / run)</figcaption>${hbarChart({ items: c.tests.filter((t) => t.avgTokens).slice(0, 8).map((t) => ({ label: t.title, value: t.avgTokens, tone: 'info' })), format: fmtTokens })}</figure>
      <figure><figcaption>${icon('bulb')}Token theo vai trò model</figcaption>${hbarChart({ items: c.roles.slice(0, 6).map((r) => ({ label: r.role, value: r.tokens, tone: 'info' })), format: fmtTokens })}</figure>
      ${timing?.share ? `<figure><figcaption>${icon('clock')}Thời gian theo giai đoạn</figcaption><div class="donut-wrap">${donutChart({ segments: PHASES.map(([k, label]) => ({ key: k, label, value: Math.round(timing.share[k] * 1000) })), center: '', ariaLabel: 'Thời gian theo giai đoạn' })}
        <div class="legend">${PHASES.map(([k, label]) => `<span><i class="swatch s-${k}"></i>${escapeHtml(label)}: ${escapeHtml(fmtPct(timing.share[k]))}</span>`).join('')}</div></div>
        ${timing.setups.length ? `<p class="muted small">Setup chậm nhất: ${timing.setups.slice(0, 3).map((x) => `${escapeHtml(x.name)} (${escapeHtml(fmtDuration(x.avgMs))})`).join(', ')}</p>` : ''}</figure>
      <figure><figcaption>${icon('clock')}Setup + hook theo run</figcaption>${stackedBarChart({ bars: [...timing.runs].reverse().map((r) => ({ label: when(r), segments: { setup: r.setup, beforeEach: r.beforeEach, afterEach: r.afterEach }, tip: `${when(r)}: setup ${fmtDuration(r.setup)}, beforeEach ${fmtDuration(r.beforeEach)}, afterEach ${fmtDuration(r.afterEach)}, thân test ${fmtDuration(r.body)}` })), keys: ['setup', 'beforeEach', 'afterEach'], ariaLabel: 'Setup và hook theo run' })}</figure>` : ''}
      <figure class="wide"><figcaption>${icon('timer')}Step chậm nhất (trung bình)</figcaption>${hbarChart({ items: c.slowSteps.slice(0, 10).map((s) => ({ label: `${s.title} › ${s.api} ${s.label}`, value: s.avgMs, tone: 'info', tip: `${s.title} › ${s.api} ${s.label}: TB ${fmtDuration(s.avgMs)}, tối đa ${fmtDuration(s.maxMs)} (${s.samples} lần)` })), format: fmtDuration })}</figure>
    </section>
    <p class="muted small">Ngân sách và đơn giá: <code>"budget": { "tokensPerRun": 200000, "costPerRun": 0.5 }</code>, <code>"pricing": { "inputPerMTok": 3, "outputPerMTok": 15 }</code> trong <code>.e2e-dashboard/config.json</code>. Report có <code>usage.estimatedCostUsd</code> thì dùng số đó.</p>`;
  picker.bind(main);
}
