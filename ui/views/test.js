import { getJson, fileUrl, isExport } from '../api.js';
import { openRunDialog } from './run-dialog.js';
import { openAiPanel } from './ai-panel.js';
import { lineChart } from '../charts.js';
import { historyCells } from './tests.js';
import { emptyBox, meter, fmtPct, toneFor } from '../analysis.js';
import { escapeHtml, fmtDuration, fmtTokens, fmtRelative, statusBadge } from '../format.js';
import { runHref } from '../router.js';
import { icon } from '../icons.js';

const FAILING = new Set(['failed', 'timed-out', 'interrupted']);

export function testFailuresHtml(runs, limit = 12) {
  const fails = runs.filter((r) => FAILING.has(r.status) || r.status === 'flaky').slice(0, limit);
  if (!fails.length) return '<p class="muted">Không có lần fail nào trong lịch sử.</p>';
  return `<ul class="fail-list">${fails.map((r) => `<li><a href="${runHref(r.runId, r.resultId)}">${statusBadge(r.status)}</a>
    <span class="muted small">${escapeHtml(fmtRelative(r.startedAt))} · ${escapeHtml(r.branch ?? '?')}@${escapeHtml(String(r.commit ?? '').slice(0, 7))}</span>
    ${r.error ? `<div><code>${escapeHtml(r.error.code ?? '')}</code> ${escapeHtml(r.error.message)}</div>` : ''}${r.failUrl ? `<div class="muted small">tại ${escapeHtml(r.failUrl)}</div>` : ''}</li>`).join('')}</ul>`;
}

export async function renderTest(main, route) {
  let t;
  try {
    t = await getJson(`/api/test?key=${encodeURIComponent(route.key)}`);
  } catch {
    main.innerHTML = emptyBox('Không tìm thấy test', 'Test này không có trong 60 run gần nhất.');
    return;
  }
  const chron = [...t.runs].reverse();
  const done = t.runs.filter((r) => r.status !== 'skipped');
  const rate = done.length ? done.filter((r) => !FAILING.has(r.status)).length / done.length : null;
  const avg = done.length ? Math.round(done.reduce((s, r) => s + r.durationMs, 0) / done.length) : null;
  const when = (r) => new Date(r.startedAt).toLocaleString('vi-VN');
  const shots = t.runs.filter((r) => r.screenshot).slice(0, 6);
  const latest = t.runs[0];
  const spec = t.line ? `${t.file}:${t.line}` : t.file;
  const lastFail = t.runs.find((r) => FAILING.has(r.status));
  main.innerHTML = `
    <nav class="crumbs" aria-label="Vị trí"><a href="#/tests">Tests</a> › <span>${escapeHtml(t.title)}</span></nav>
    <div class="run-head"><div><h1>${escapeHtml(t.title)} ${latest ? statusBadge(latest.status) : ''}</h1>
      <div class="run-meta"><span><code>${escapeHtml(spec)}</code></span><span>${escapeHtml(t.target)}${t.agent !== 'default' ? ` · ${escapeHtml(t.agent)}` : ''}</span>${t.tags.map((g) => `<span class="tag">${escapeHtml(g)}</span>`).join('')}
        ${t.owners?.length ? `<span class="owners">${icon('users', { size: 13 })}${escapeHtml(t.owners.join(', '))}</span>` : ''}
        ${t.quarantine ? `<span class="lock-badge">${icon('lock', { size: 11 })}cách ly đến ${escapeHtml(t.quarantine.until.slice(0, 10))}</span>` : ''}</div></div>
      <div class="actions">${isExport() ? '' : `<button type="button" class="primary" data-run>${icon('play', { size: 14 })}Chạy test này</button>
        <button type="button" class="btn-ai" data-split title="AI đề xuất chia test này thành nhiều test case nhỏ, mỗi test kiểm tra một ý">${icon('sparkles', { size: 14 })}AI chia nhỏ test</button>
        ${t.flaky && lastFail ? `<button type="button" class="btn-ai" data-why>${icon('sparkles', { size: 14 })}Vì sao flaky?</button>` : ''}`}</div></div>
    <section class="kpis">
      <div class="kpi tone-${toneFor(rate)}"><div class="kpi-label">Pass rate (${escapeHtml(done.length)} run)</div><div class="kpi-value">${fmtPct(rate)}</div><div class="kpi-sub">${meter(rate, toneFor(rate), '')}</div></div>
      <div class="kpi tone-info"><div class="kpi-label">Thời gian TB</div><div class="kpi-value">${fmtDuration(avg)}</div><div class="kpi-sub">gần nhất ${escapeHtml(fmtDuration(latest?.durationMs))}</div></div>
      <div class="kpi tone-${t.flaky ? 'warn' : 'good'}"><div class="kpi-label">Flaky</div><div class="kpi-value">${t.flaky ? escapeHtml(Math.round(t.flaky.score * 100)) : '0'}</div><div class="kpi-sub">${t.flaky ? `${escapeHtml(t.flaky.flaky)} lần flaky · đổi kết quả ${escapeHtml(t.flaky.flips)} lần` : 'ổn định'}</div></div>
      <div class="kpi tone-info"><div class="kpi-label">Lịch sử (cũ → mới)</div><div class="kpi-value small-cells">${historyCells(t.runs, 20)}</div></div>
    </section>
    <section class="charts">
      <figure><figcaption>${icon('clock')}Thời gian theo run</figcaption>${lineChart({ points: chron.map((r) => ({ label: when(r), value: r.status === 'skipped' ? null : r.durationMs, tip: `${when(r)} · ${r.status} · ${fmtDuration(r.durationMs)}` })), yFormat: fmtDuration, ariaLabel: 'Thời gian theo run', area: true })}</figure>
      <figure><figcaption>${icon('coins')}Token theo run</figcaption>${lineChart({ points: chron.map((r) => ({ label: when(r), value: r.tokens })), yFormat: fmtTokens, ariaLabel: 'Token theo run', area: true })}</figure>
    </section>
    <div class="two-col">
      <section class="panel"><h2>${icon('x', { size: 15 })} Các lần fail</h2>${testFailuresHtml(t.runs)}</section>
      <section class="panel"><h2>${icon('list', { size: 15 })} Step ở run gần nhất</h2>${latest?.steps?.length ? `<ol class="timeline">${latest.steps.map((s) => `<li class="step">${statusBadge(s.status)} <code>${escapeHtml(s.api)}</code> ${escapeHtml(s.label)} <span class="muted small">${escapeHtml(fmtDuration(s.durationMs))}${s.cache ? ` · cache ${escapeHtml(s.cache)}` : ''}</span></li>`).join('')}</ol>` : '<p class="muted">Không có step.</p>'}</section>
    </div>
    ${shots.length ? `<section class="panel"><h2>${icon('image', { size: 15 })} Ảnh lúc fail theo thời gian</h2><div class="shots">${shots.map((r) => `<a href="${runHref(r.runId, r.resultId)}" title="${escapeHtml(when(r))}"><img loading="lazy" src="${escapeHtml(fileUrl(r.runId, `artifacts/${r.screenshot}`))}" alt="ảnh ${escapeHtml(when(r))}"></a>`).join('')}</div></section>` : ''}`;
  main.querySelector('[data-run]')?.addEventListener('click', () => openRunDialog({ tests: [spec], targets: [t.target], agents: [t.agent], title: `Chạy ${t.title}` }));
  main.querySelector('[data-split]')?.addEventListener('click', () => openAiPanel({ action: 'split-tests', runId: null, title: `Chia nhỏ · ${t.title}`, extra: { key: route.key } }));
  main.querySelector('[data-why]')?.addEventListener('click', () => openAiPanel({ action: 'why-flaky', runId: lastFail.runId, resultId: lastFail.resultId, title: `Vì sao flaky · ${t.title}` }));
}
