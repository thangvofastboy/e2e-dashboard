import { getJson } from '../api.js';
import { lineChart, stackedBarChart, legend } from '../charts.js';
import { fmtDuration, fmtTokens, fmtRelative, statusBadge, countChips, escapeHtml } from '../format.js';
import { runHref } from '../router.js';

const RUN_KEYS = ['passed', 'flaky', 'failed', 'interrupted', 'skipped'];
const EMPTY_RUNS = '<div class="empty-state"><h2>Chưa có run nào</h2><p>Chạy <code>npx e2e run</code> (hoặc nhờ Claude chạy) — run sẽ tự xuất hiện ở đây.</p></div>';

export function passRate(meta) {
  const s = meta.summary ?? {};
  const ok = (s.passed ?? 0) + (s.flaky ?? 0);
  const done = ok + (s.failed ?? 0) + (s.interrupted ?? 0);
  return done ? ok / done : null;
}

function gitCell(git) {
  if (!git?.commit) return '—';
  return `${escapeHtml(git.branch ?? '?')}@${escapeHtml(git.commit.slice(0, 7))}${git.dirty ? ' <span title="có thay đổi chưa commit">•</span>' : ''}`;
}

export function runTable(metas) {
  if (!metas.length) return EMPTY_RUNS;
  const rows = metas
    .map((m) => `<tr>
      <td><a href="${runHref(m.runId)}">${statusBadge(m.status)}</a></td>
      <td><a href="${runHref(m.runId)}" title="${escapeHtml(m.startedAt)}">${escapeHtml(fmtRelative(m.startedAt))}</a>${m.kind === 'explore' ? ' <span class="tag">explore</span>' : ''}</td>
      <td>${countChips(m.summary)}</td>
      <td class="num">${fmtDuration(m.durationMs)}</td>
      <td class="num">${fmtTokens((m.tokens?.input ?? 0) + (m.tokens?.output ?? 0))}</td>
      <td>${gitCell(m.git)}</td>
      <td class="muted">${escapeHtml(m.source)}</td>
      <td>${m.pinned ? '📌' : ''}${m.baseline ? '⭐' : ''}</td>
    </tr>`)
    .join('');
  return `<table class="table"><thead><tr><th>Status</th><th>Bắt đầu</th><th>Kết quả</th><th class="num">Thời gian</th><th class="num">Token</th><th>Git</th><th>Nguồn</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (v) => `${Math.round(v)}%`;

function kpi(label, value, sub = '') {
  return `<div class="kpi"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`;
}

export async function renderOverview(main) {
  const metas = await getJson('/api/runs');
  if (!metas.length) {
    main.innerHTML = EMPTY_RUNS;
    return;
  }
  const chron = metas.slice(0, 50).reverse();
  const label = (m) => new Date(m.startedAt).toLocaleString('vi-VN');
  const rate = passRate(metas[0]);
  const prev = metas[1] ? passRate(metas[1]) : null;
  const delta = rate != null && prev != null ? Math.round((rate - prev) * 100) : null;
  const tokens = (m) => (m.tokens?.input ?? 0) + (m.tokens?.output ?? 0);
  main.innerHTML = `
    <h1>Overview</h1>
    <section class="kpis">
      ${kpi('Pass rate (run mới nhất)', rate == null ? '—' : pct(rate * 100), delta == null ? '' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)} điểm so với run trước`)}
      ${kpi('Run gần nhất', statusBadge(metas[0].status), escapeHtml(fmtRelative(metas[0].startedAt)))}
      ${kpi('Thời gian TB', fmtDuration(avg(metas.map((m) => m.durationMs).filter((v) => v != null))), `${metas.length} run`)}
      ${kpi('Token / run', fmtTokens(Math.round(avg(metas.map(tokens)) ?? 0)), '')}
    </section>
    <section class="charts">
      <figure><figcaption>Pass rate theo run</figcaption>
        ${lineChart({ points: chron.map((m) => ({ label: label(m), value: passRate(m) == null ? null : passRate(m) * 100 })), yMax: 100, yFormat: pct, ariaLabel: 'Pass rate theo run' })}</figure>
      <figure><figcaption>Kết quả theo run</figcaption>
        ${stackedBarChart({ bars: chron.map((m) => ({ label: label(m), segments: m.summary ?? {} })), keys: RUN_KEYS, ariaLabel: 'Kết quả theo run' })}
        ${legend(RUN_KEYS)}</figure>
      <figure><figcaption>Thời gian chạy</figcaption>
        ${lineChart({ points: chron.map((m) => ({ label: label(m), value: m.durationMs })), yFormat: fmtDuration, ariaLabel: 'Thời gian chạy theo run' })}</figure>
      <figure><figcaption>Token theo run</figcaption>
        ${lineChart({ points: chron.map((m) => ({ label: label(m), value: tokens(m) })), yFormat: fmtTokens, ariaLabel: 'Token theo run' })}</figure>
    </section>
    <section><div class="section-head"><h2>Run gần đây</h2><a href="#/runs">Xem tất cả →</a></div>${runTable(metas.slice(0, 10))}</section>`;
}

export async function renderRunsPage(main) {
  const metas = await getJson('/api/runs');
  main.innerHTML = `<h1>Runs</h1><p class="muted">Bảng này cũng là dạng bảng số liệu của các biểu đồ ở Overview.</p>${runTable(metas)}`;
}
