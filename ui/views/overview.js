import { getJson, isExport } from '../api.js';
import { openImportDialog } from './actions.js';
import { sloPanel } from './quality.js';
import { lineChart, stackedBarChart, legend, shareBar, sparkline, heatmap, hbarChart } from '../charts.js';
import { fmtDuration, fmtTokens, fmtRelative, statusBadge, countChips, escapeHtml, STATUS, cap } from '../format.js';
import { runHref, compareHref } from '../router.js';
import { passRate, kpis, mergeThresholds } from '../health.js';
import { icon } from '../icons.js';

const RUN_KEYS = ['passed', 'flaky', 'failed', 'interrupted', 'skipped'];
const EMPTY_RUNS = '<div class="empty-state"><h2>Chưa có run nào</h2><p>Chạy <code>npx e2e run</code> (hoặc nhờ Claude chạy) — run sẽ tự xuất hiện ở đây.</p></div>';
const HEALTH = {
  good: { label: 'Tốt', icon: 'check' },
  warn: { label: 'Cần chú ý', icon: 'alert' },
  bad: { label: 'Có vấn đề', icon: 'x' },
  muted: { label: 'Chưa đủ dữ liệu', icon: 'info' },
};

function gitCell(git) {
  if (!git?.commit) return '—';
  return `<span class="git">${icon('branch', { size: 13 })}${escapeHtml(git.branch ?? '?')}@${escapeHtml(String(git.commit).slice(0, 7))}${git.dirty ? ' <span title="có thay đổi chưa commit">•</span>' : ''}</span>`;
}

export function runTable(metas, { selectable = false, selected = new Set() } = {}) {
  if (!metas.length) return EMPTY_RUNS;
  const rows = metas
    .map((m) => `<tr>
      ${selectable ? `<td><input type="checkbox" class="sel" data-cmp="${escapeHtml(m.runId)}" ${selected.has(m.runId) ? 'checked' : ''} aria-label="Chọn để so sánh"></td>` : ''}
      <td><a href="${runHref(m.runId)}">${statusBadge(m.status)}</a></td>
      <td><a href="${runHref(m.runId)}" title="${escapeHtml(m.startedAt)}">${escapeHtml(fmtRelative(m.startedAt))}</a>${m.kind === 'explore' ? ' <span class="tag">explore</span>' : ''}</td>
      <td>${countChips(m.summary)}</td>
      <td class="num">${fmtDuration(m.durationMs)}</td>
      <td class="num">${fmtTokens((m.tokens?.input ?? 0) + (m.tokens?.output ?? 0))}</td>
      <td>${gitCell(m.git)}</td>
      <td class="muted">${escapeHtml(cap(m.source))}</td>
      <td>${m.pinned ? `<span class="btn-pin">${icon('pin', { size: 14, label: 'Đã ghim' })}</span>` : ''}${m.baseline ? `<span class="btn-star">${icon('star', { size: 14, label: 'baseline' })}</span>` : ''}</td>
    </tr>`)
    .join('');
  return `<table class="table"><thead><tr>${selectable ? '<th><span class="sr-only">Chọn</span></th>' : ''}<th>Status</th><th>Bắt đầu</th><th>Kết quả</th><th class="num">Thời gian</th><th class="num">Token</th><th>Git</th><th>Nguồn</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

const pct = (v) => `${Math.round(v)}%`;
const signedPct = (d) => `${d > 0 ? '+' : ''}${Math.round(d * 100)}%`;

function trend(delta, text) {
  if (delta == null) return '';
  return `${icon(delta > 0 ? 'up' : 'down', { size: 13 })}${escapeHtml(text)}`;
}

// What each card shows; values and health come from kpis() in health.js.
function cardView(c) {
  const s = c.summary ?? {};
  switch (c.key) {
    case 'passRate':
      return { icon: 'gauge', label: 'Pass rate', value: c.value == null ? '—' : pct(c.value * 100), sub: trend(c.delta, `${Math.abs(Math.round(c.delta * 100))} điểm so với run trước`), bar: c.value };
    case 'lastRun': {
      const n = (v) => Number(v) || 0; // report.json is untrusted: counts may not be numbers
      const ok = n(s.passed) + n(s.flaky);
      const failed = n(s.failed) + n(s.interrupted);
      const total = ok + failed;
      return { icon: STATUS[c.value]?.icon ?? 'info', label: 'Run gần nhất', value: failed ? `${failed} fail` : STATUS[c.value]?.label ?? String(c.value), sub: escapeHtml(`${ok}/${total} pass`), bar: total ? ok / total : null };
    }
    case 'duration':
      return { icon: 'clock', label: 'Thời gian chạy', value: fmtDuration(c.value), sub: trend(c.delta, `${signedPct(c.delta ?? 0)} so với TB 10 run`), spark: c.series };
    case 'tokens':
      return { icon: 'coins', label: 'Token / run', value: fmtTokens(c.value), sub: trend(c.delta, `${signedPct(c.delta ?? 0)} so với TB 10 run`), spark: c.series };
    default:
      return { icon: 'recycle', label: 'Replay cache', value: c.value == null ? '—' : pct(c.value * 100), sub: c.value == null ? 'Chưa có agent step' : c.health === 'good' ? 'Ít gọi model, chạy nhanh' : 'Nhiều step phải gọi model', bar: c.value };
  }
}

export function kpiCard(c) {
  const v = cardView(c);
  const h = HEALTH[c.health];
  return `<div class="kpi tone-${c.health}">
    <div class="kpi-top"><span class="kpi-ic">${icon(v.icon, { size: 17 })}</span>
      <button type="button" class="chip tone-${c.health}" data-th aria-controls="thresholds" title="Cách tính trạng thái">${icon(h.icon, { size: 12 })}${h.label}</button></div>
    <div class="kpi-label">${v.label}</div>
    <div class="kpi-value">${escapeHtml(v.value)}</div>
    <div class="kpi-sub">${v.sub}</div>
    ${v.bar != null ? `<div class="kpi-bar"><i style="width:${Math.round(Math.max(0, Math.min(1, v.bar)) * 100)}%"></i></div>` : ''}
    ${v.spark ? sparkline(v.spark) : ''}
  </div>`;
}

export function thresholdsPanel(cards, t) {
  const by = Object.fromEntries(cards.map((c) => [c.key, c]));
  const p = (x) => pct(x * 100);
  const rows = [
    ['passRate', 'gauge', 'Pass rate', [`≥ ${p(t.passRate.good)}`, `${p(t.passRate.warn)}–${p(t.passRate.good)}`, `< ${p(t.passRate.warn)}`]],
    ['lastRun', 'check', 'Run gần nhất', ['passed', 'flaky / blocked', 'failed / interrupted / error']],
    ['duration', 'clock', 'Thời gian chạy', [`≤ +${p(t.duration.good)}`, `+${p(t.duration.good)} → +${p(t.duration.warn)}`, `> +${p(t.duration.warn)}`]],
    ['tokens', 'coins', 'Token / run', [`≤ +${p(t.tokens.good)}`, `+${p(t.tokens.good)} → +${p(t.tokens.warn)}`, `> +${p(t.tokens.warn)}`]],
    ['replay', 'recycle', 'Replay cache', [`≥ ${p(t.replay.good)}`, `${p(t.replay.warn)}–${p(t.replay.good)}`, `< ${p(t.replay.warn)}`]],
  ];
  const levels = ['good', 'warn', 'bad'];
  const now = (key) => {
    const c = by[key];
    const v = cardView(c);
    return key === 'duration' || key === 'tokens' ? (c.delta == null ? '' : signedPct(c.delta)) : key === 'lastRun' ? v.value : v.value;
  };
  const body = rows
    .map(([key, ic, label, cells]) => `<div class="th-name"><span class="mi tone-${by[key].health}">${icon(ic, { size: 13 })}</span>${label}</div>${cells
      .map((txt, i) => `<div class="th-cell tone-${levels[i]}${by[key].health === levels[i] ? ' now' : ''}">${escapeHtml(txt)}${by[key].health === levels[i] && now(key) ? ` · ${escapeHtml(now(key))}` : ''}</div>`)
      .join('')}`)
    .join('');
  return `<section id="thresholds" class="panel th" hidden>
    <div class="th-head"><span class="mi tone-info">${icon('gauge', { size: 13 })}</span><strong>Cách tính trạng thái</strong><span class="note">so với 10 run gần nhất</span></div>
    <div class="th-grid"><div></div>${levels.map((l) => `<div class="th-col tone-${l}">${icon(HEALTH[l].icon, { size: 12 })}${HEALTH[l].label}</div>`).join('')}${body}</div>
    <div class="th-foot">Chỉnh ngưỡng trong <code>.e2e-dashboard/config.json</code> → <code>"thresholds"</code>.</div>
  </section>`;
}

const PART_FORMAT = {
  passRate: (v) => pct(v * 100),
  stability: (v) => `${pct(v * 100)} flaky`,
  speed: (v) => signedPct(v),
  cost: (v) => signedPct(v),
  cache: (v) => pct(v * 100),
};

export function healthPanel(h) {
  if (!h) return '';
  const C = 2 * Math.PI * 40;
  const parts = h.parts
    .map((p) => `<li class="${p.score == null ? 'muted' : ''}"><span class="hp-label">${escapeHtml(p.label)}</span>
      <span class="meter tone-${p.score == null ? 'muted' : p.score >= 0.85 ? 'good' : p.score >= 0.6 ? 'warn' : 'bad'}"><i style="width:${Math.round((p.score ?? 0) * 100)}%"></i></span>
      <span class="hp-val">${p.value == null ? '—' : escapeHtml(PART_FORMAT[p.key](p.value))}</span><span class="muted small">×${p.weight}</span></li>`)
    .join('');
  return `<section class="panel health-score tone-${h.health}" aria-label="Health score">
    <svg viewBox="0 0 100 100" class="hs-ring" role="img" aria-label="Health score ${h.score}/100"><circle class="hs-track" cx="50" cy="50" r="40"/><circle class="hs-val" cx="50" cy="50" r="40" stroke-dasharray="${((h.score / 100) * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 50 50)"/><text x="50" y="57" text-anchor="middle">${escapeHtml(h.score)}</text></svg>
    <div class="hs-body"><h2>${icon('heart', { size: 15 })}Health score <span class="chip tone-${h.health}">${icon(HEALTH[h.health].icon, { size: 12 })}${HEALTH[h.health].label}</span></h2>
      <ul class="hs-parts">${parts}</ul><p class="muted small">Điểm 0–100 từ 10 run gần nhất; phần nào chưa có dữ liệu thì không tính.</p></div>
  </section>`;
}

function testsHeatmap(tests) {
  const rows = [...tests]
    .map((t) => ({ t, fails: t.history.filter((h) => h.status !== 'passed' && h.status !== 'skipped').length }))
    .sort((a, b) => b.fails - a.fails)
    .slice(0, 12)
    .map(({ t }) => ({
      label: t.title,
      cells: [...t.history].reverse().map((h) => ({ status: h.status, href: runHref(h.runId, null), tip: `${t.title}: ${STATUS[h.status]?.label ?? h.status}` })),
    }));
  return heatmap({ rows, cols: 10 });
}

// Timeline events (M7) → the first run at or after each, for markers on the per-run charts.
export function runMarkers(chron, events) {
  const out = [];
  for (const e of events) {
    const t = Date.parse(e.at);
    const i = chron.findIndex((m) => Date.parse(m.startedAt) >= t);
    if (i > 0) out.push({ index: i, kind: e.kind, label: `${new Date(e.at).toLocaleString('vi-VN')} · ${e.label}` });
  }
  return out;
}

export async function renderOverview(main) {
  // một đợt: mọi request chạy song song (trước là hai đợt, đợt sau chờ đợt đầu); slo đã có trong /api/gate
  const live = !isExport();
  const [allMetas, info, tests, health, anomalies, gate, alerts, timeline, triage] = await Promise.all([
    getJson('/api/runs'),
    getJson('/api/info').catch(() => null),
    getJson('/api/tests').catch(() => []),
    live ? getJson('/api/health').then((r) => r.health).catch(() => null) : null,
    live ? getJson('/api/anomalies').then((r) => r.anomalies).catch(() => []) : [],
    live ? getJson('/api/gate').catch(() => null) : null,
    live ? getJson('/api/alerts').catch(() => null) : null,
    live ? getJson('/api/timeline?days=60').catch(() => null) : null,
    live ? getJson('/api/triage').catch(() => null) : null,
  ]);
  const slo = gate?.slo ?? null;
  // explore runs have no tests: they would read as "0/0 pass" in the KPIs and charts
  const metas = allMetas.filter((m) => m.kind !== 'explore');
  if (!metas.length) {
    main.innerHTML = EMPTY_RUNS;
    return;
  }
  const t = mergeThresholds(info?.thresholds);
  const cards = kpis(metas, t);
  const chron = metas.slice(0, 50).reverse();
  const when = (m) => new Date(m.startedAt).toLocaleString('vi-VN');
  const tokens = (m) => (m.tokens?.input ?? 0) + (m.tokens?.output ?? 0);
  const latest = metas[0];
  const rate = passRate(latest);
  const slow = tests.filter((x) => x.avgDurationMs).sort((a, b) => b.avgDurationMs - a.avgDurationMs).slice(0, 6);
  main.innerHTML = `
    <h1>Overview</h1>
    ${alerts?.active?.length ? `<a class="banner tone-bad" href="#/settings">${icon('bolt', { size: 15 })}<strong>${alerts.active.length} cảnh báo đang bật:</strong> ${escapeHtml(alerts.active.slice(0, 2).map((x) => x.title).join(' · '))}${alerts.active.length > 2 ? '…' : ''}</a>` : ''}
    ${triage?.untriaged ? `<a class="banner tone-warn" href="#/triage">${icon('ticket', { size: 15 })}${escapeHtml(triage.untriaged)} test fail chưa ai nhận: mở Triage</a>` : ''}
    ${sloPanel(slo, gate)}
    ${anomalies.length ? `<section class="panel anomalies"><strong>${icon('zap', { size: 15 })} Run gần nhất có ${anomalies.length} bất thường</strong> <span class="muted small">chậm hoặc tốn hơn hẳn lịch sử của chính test (TB + 2σ)</span><ul>${anomalies.slice(0, 5).map((a) => `<li><a href="${runHref(a.runId, a.resultId)}">${escapeHtml(a.title)}</a>: ${escapeHtml(a.label)} ${escapeHtml(a.metric === 'durationMs' ? fmtDuration(a.value) : a.metric === 'tokens' ? fmtTokens(a.value) : a.value)} <span class="muted">(TB ${escapeHtml(a.metric === 'durationMs' ? fmtDuration(a.mean) : a.metric === 'tokens' ? fmtTokens(a.mean) : a.mean)})</span></li>`).join('')}</ul></section>` : ''}
    <div class="ov-top">${healthPanel(health)}<section class="kpis">${cards.map(kpiCard).join('')}</section></div>
    ${thresholdsPanel(cards, t)}
    <section class="charts">
      <figure><figcaption>${icon('activity')}Pass rate theo run</figcaption>
        ${lineChart({ points: chron.map((m) => ({ label: when(m), value: passRate(m) == null ? null : passRate(m) * 100 })), yMax: 100, yFormat: pct, ariaLabel: 'Pass rate theo run', area: true, markers: runMarkers(chron, timeline?.events ?? []) })}</figure>
      <figure><figcaption>${icon('gauge')}Run gần nhất</figcaption>
        <div class="share-wrap">${shareBar({ segments: RUN_KEYS.map((k) => ({ key: k, value: latest.summary?.[k] ?? 0 })), center: rate == null ? '—' : pct(rate * 100), centerLabel: 'Pass rate', ariaLabel: 'Kết quả run gần nhất' })}
        <div>${statusBadge(latest.status)}<p class="muted small">${escapeHtml(fmtRelative(latest.startedAt))} · ${fmtDuration(latest.durationMs)}</p>${legend(RUN_KEYS.filter((k) => latest.summary?.[k]))}</div></div></figure>
      <figure><figcaption>${icon('table')}Kết quả theo run</figcaption>
        ${stackedBarChart({ bars: chron.map((m) => ({ label: when(m), segments: m.summary ?? {} })), keys: RUN_KEYS, ariaLabel: 'Kết quả theo run' })}
        ${legend(RUN_KEYS)}</figure>
      <figure><figcaption>${icon('clock')}Thời gian chạy</figcaption>
        ${lineChart({ points: chron.map((m) => ({ label: when(m), value: m.durationMs })), yFormat: fmtDuration, ariaLabel: 'Thời gian chạy theo run', area: true })}</figure>
      <figure><figcaption>${icon('coins')}Token theo run</figcaption>
        ${lineChart({ points: chron.map((m) => ({ label: when(m), value: tokens(m) })), yFormat: fmtTokens, ariaLabel: 'Token theo run', area: true })}</figure>
      <figure><figcaption>${icon('timer')}Test chậm nhất (trung bình)</figcaption>
        ${hbarChart({ items: slow.map((x) => ({ label: x.title, value: x.avgDurationMs, tone: 'info' })), format: fmtDuration })}</figure>
      ${tests.length ? `<figure class="wide"><figcaption>${icon('grid')}Test × 10 run gần nhất (cũ → mới)</figcaption>${testsHeatmap(tests)}${legend(['passed', 'flaky', 'failed', 'skipped'])}</figure>` : ''}
    </section>
    <section class="fill-me"><div class="section-head"><h2>Run gần đây</h2><a href="#/runs">Xem tất cả →</a></div>${runTable(metas.slice(0, 30))}</section>`;
  const panel = main.querySelector('#thresholds');
  main.querySelectorAll('[data-th]').forEach((b) =>
    b.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      main.querySelectorAll('[data-th]').forEach((x) => x.setAttribute('aria-expanded', String(!panel.hidden)));
      if (!panel.hidden) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }));
}

const compareSel = new Set();
let runSource = '';
let runLimit = 50;

export async function renderRunsPage(main) {
  const metas = await getJson('/api/runs');
  for (const id of compareSel) if (!metas.some((m) => m.runId === id)) compareSel.delete(id);
  const selectable = !isExport() && metas.length > 1;
  const sources = [...new Set(metas.map((m) => m.source).filter(Boolean))].sort();
  const draw = () => {
    const filtered = metas.filter((m) => !runSource || m.source === runSource);
    const shown = filtered.slice(0, runLimit);
    const srcSel = sources.length > 1 ? `<label>Nguồn <select data-src><option value="">Tất cả</option>${sources.map((x) => `<option ${x === runSource ? 'selected' : ''}>${escapeHtml(x)}</option>`).join('')}</select></label>` : '';
    const tools = isExport() ? '' : `<div class="filters">${selectable ? `<button type="button" class="primary" data-compare ${compareSel.size === 2 ? '' : 'disabled'}>${icon('columns', { size: 14 })}So sánh 2 run</button><span class="muted small">${compareSel.size === 2 ? 'Run cũ hơn là A.' : 'Chọn đúng 2 run để so sánh.'}</span>` : ''}${srcSel}<button type="button" data-import>${icon('upload', { size: 14 })}Nhập từ GitHub Actions</button><a class="button" href="/api/export/runs.csv" download>${icon('download', { size: 14 })}CSV</a></div>`;
    main.innerHTML = `<h1>Runs</h1><p class="muted">Bảng này cũng là dạng bảng số liệu của các biểu đồ ở Overview.</p>${tools}${runTable(shown, { selectable, selected: compareSel })}${filtered.length > shown.length ? `<p class="load-more"><button type="button" data-more>Xem thêm ${Math.min(50, filtered.length - shown.length)} run (còn ${filtered.length - shown.length})</button></p>` : ''}`;
    main.querySelector('[data-more]')?.addEventListener('click', () => {
      runLimit += 50;
      draw();
    });
    main.querySelector('[data-src]')?.addEventListener('change', (e) => {
      runSource = e.target.value;
      draw();
    });
    main.querySelector('[data-import]')?.addEventListener('click', () => openImportDialog(() => renderRunsPage(main)));
    main.querySelectorAll('[data-cmp]').forEach((el) =>
      el.addEventListener('change', () => {
        if (el.checked) {
          compareSel.add(el.dataset.cmp);
          while (compareSel.size > 2) compareSel.delete(compareSel.values().next().value); // keep the last two picked
        } else compareSel.delete(el.dataset.cmp);
        draw();
      }));
    main.querySelector('[data-compare]')?.addEventListener('click', () => {
      const [x, y] = metas.filter((m) => compareSel.has(m.runId)); // newest first
      location.hash = compareHref(y.runId, x.runId);
    });
  };
  draw();
}
