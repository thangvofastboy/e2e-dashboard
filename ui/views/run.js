import { getJson, postJson, fileUrl, isExport } from '../api.js';
import { flattenResults, facets, applyFilters, matrix, isFailure, stepVideoOffset } from '../model.js';
import { fmtDuration, fmtTokens, statusBadge, countChips, escapeHtml } from '../format.js';
import { renderMarkdown } from '../markdown.js';
import { runHref } from '../router.js';
import { icon } from '../icons.js';
import { donutChart, legend } from '../charts.js';
import { passRate } from '../health.js';

// View state survives re-renders of the same run (filters, matrix toggle, chosen attempt, tab).
const ui = { runId: null, data: null, filters: {}, matrix: false, attempt: new Map(), tab: 'media' };
const TABS = [['media', 'Video & ảnh', 'video'], ['log', 'Log', 'terminal'], ['trace', 'Trace', 'route'], ['source', 'Source', 'code']];
const FILTERS = [['statuses', 'Status'], ['targets', 'Target'], ['agents', 'Agent'], ['tags', 'Tag'], ['files', 'File']];

export function artifactsOf(attempt) {
  const all = [...(attempt?.artifacts ?? []), ...(attempt?.steps ?? []).flatMap((s) => s.artifacts ?? [])];
  const videos = all.filter((a) => a.kind === 'video');
  return {
    video: videos.find((v) => v.path) ?? videos.find((v) => v.url) ?? null,
    screenshots: all.filter((a) => a.kind === 'screenshot' && (a.path || a.url)),
  };
}

export function mediaSrc(runId, artifact) {
  if (artifact?.path) return fileUrl(runId, `artifacts/${artifact.path}`);
  const url = artifact?.url;
  return typeof url === 'string' && /^https?:\/\//i.test(url) && !/[\u0000-\u0020\u007f]/.test(url) ? url : null;
}

export function eventLine(e) {
  const dur = e.durationMs ? ` <span class="muted">${fmtDuration(e.durationMs)}</span>` : '';
  const line = (cls, ic, body) => `<li class="${cls}">${icon(ic, { size: 14 })}<span>${body}${dur}</span></li>`;
  if (e.kind === 'model')
    return line('ev-model', 'bulb', `${escapeHtml(e.reasoning ?? e.name ?? 'model')} <span class="muted">(${escapeHtml(e.inputTokens ?? 0)}/${escapeHtml(e.outputTokens ?? 0)} tok)</span>`);
  if (e.kind === 'engine') return line('ev-engine', 'bolt', escapeHtml(e.detail ?? e.name));
  if (e.kind === 'navigation') return line('ev-nav', 'arrow', escapeHtml(e.detail));
  if (e.kind === 'poll') return line('ev-poll', 'eye', escapeHtml(e.detail ?? e.name));
  return line('ev-other', 'info', `${escapeHtml(e.kind)} ${escapeHtml(e.detail ?? e.name ?? '')}`);
}

export function cacheText(cache) {
  if (!cache) return '';
  return `cache ${cache.mode}${cache.reason ? ` (${cache.reason})` : ''} · replay ${cache.replayedActions ?? 0}/${cache.totalActions ?? 0}`;
}

function errorBox(err) {
  if (!err) return '';
  const d = err.details ?? {};
  const rows = [['Locator', d.locator], ['Mong đợi', d.expected], ['Thực tế', d.observed]]
    .filter(([, v]) => v != null)
    .map(([k, v]) => `<div><span class="muted">${k}:</span> <code>${escapeHtml(v)}</code></div>`)
    .join('');
  const src = err.source ? `<div class="muted">${escapeHtml(err.source.file)}:${escapeHtml(err.source.line)}</div>` : '';
  return `<div class="err"><strong>${escapeHtml(err.code ?? 'Lỗi')}</strong> ${escapeHtml(err.message)}${rows}${src}</div>`;
}

function header(meta, report) {
  const s = meta.summary ?? {};
  const tokens = (meta.tokens?.input ?? 0) + (meta.tokens?.output ?? 0);
  const replay = meta.replay?.total ? `<span class="m-replay">${icon('recycle', { size: 14 })}${Math.round((meta.replay.replayed / meta.replay.total) * 100)}% replay</span>` : '';
  const git = meta.git?.commit ? `<span class="m-git">${icon('branch', { size: 14 })}${escapeHtml(meta.git.branch ?? '?')}@${escapeHtml(String(meta.git.commit).slice(0, 7))}${meta.git.dirty ? ' (dirty)' : ''}</span>` : '';
  const actions = isExport()
    ? ''
    : `<button class="btn-pin" data-flag="pin">${icon('pin', { size: 15 })}${meta.pinned ? 'Bỏ ghim' : 'Ghim'}</button>
       <button class="btn-star" data-flag="baseline">${icon('star', { size: 15 })}${meta.baseline ? 'Bỏ baseline' : 'Baseline'}</button>
       <a class="button btn-export" href="/api/runs/${encodeURIComponent(meta.runId)}/export" download>${icon('download', { size: 15 })}Export HTML</a>`;
  const runErrors = (report.run.errors ?? []).map(errorBox).join('');
  const rate = passRate(meta);
  const keys = ['passed', 'flaky', 'failed', 'interrupted', 'skipped'];
  return `<div class="run-head">
      <div><h1>Run ${escapeHtml(meta.runId.slice(-8))} ${statusBadge(meta.status)}</h1>
        <div class="run-meta"><span class="m-time">${icon('clock', { size: 14 })}${new Date(meta.startedAt).toLocaleString('vi-VN')} · ${fmtDuration(meta.durationMs)}</span><span class="m-tok">${icon('coins', { size: 14 })}${fmtTokens(tokens)} tok</span>${replay}${git}</div></div>
      <div class="actions">${actions}</div>
    </div>
    <section class="panel run-summary">${donutChart({ segments: keys.map((k) => ({ key: k, value: s[k] ?? 0 })), center: rate == null ? '—' : `${Math.round(rate * 100)}%`, ariaLabel: 'Kết quả run' })}
      <div><div>${countChips(s)}</div>${legend(keys.filter((k) => s[k]))}</div></section>${runErrors}`;
}

function filterBar(all) {
  const f = facets(all);
  const selects = FILTERS.filter(([k]) => f[k].length > 1 || ui.filters[k]?.length)
    .map(([k, label]) => `<label>${label} <select name="${k}" data-filter="${k}"><option value="">Tất cả</option>${f[k]
      .map((v) => `<option ${ui.filters[k]?.[0] === v ? 'selected' : ''}>${escapeHtml(v)}</option>`)
      .join('')}</select></label>`)
    .join('');
  return `<div class="filters">${selects}<button class="btn-matrix" data-toggle="matrix" aria-pressed="${ui.matrix}">${icon('table', { size: 15 })}Ma trận</button></div>`;
}

function testList(rows, runId, selectedId) {
  if (!rows.length) return '<p class="muted">Không có test nào khớp bộ lọc.</p>';
  return `<ul class="test-list">${rows
    .map((r) => `<li><a class="${r.id === selectedId ? 'selected' : ''}" href="${runHref(runId, r.id)}">
      ${statusBadge(r.status)} <span class="title">${escapeHtml(r.title)}</span>
      <span class="muted">[${escapeHtml(r.target)}${r.agent !== 'default' ? ` · ${escapeHtml(r.agent)}` : ''}] ${fmtDuration(r.durationMs)}</span></a></li>`)
    .join('')}</ul>`;
}

function matrixTable(rows, runId) {
  const m = matrix(rows);
  const head = m.targets.map((t) => `<th>${escapeHtml(t)}</th>`).join('');
  const body = m.rows
    .map((r) => `<tr><td>${escapeHtml(r.title)}</td>${m.targets
      .map((t) => (r.cells[t] ? `<td><a href="${runHref(runId, r.cells[t].id)}">${statusBadge(r.cells[t].status)}</a></td>` : '<td class="muted">—</td>'))
      .join('')}</tr>`)
    .join('');
  return `<table class="table matrix"><thead><tr><th>Test</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function stepItem(step, video, attempt) {
  const off = video ? stepVideoOffset(step, video, attempt) : null;
  const meta = [fmtDuration(step.durationMs), step.metrics?.modelCalls ? `${step.metrics.modelCalls} model call` : '', cacheText(step.cache)]
    .filter(Boolean)
    .join(' · ');
  const events = (step.events ?? []).map(eventLine).join('');
  return `<li class="step"><details ${step.status !== 'passed' ? 'open' : ''}>
      <summary ${off != null ? `data-offset="${off}" title="Tua video đến step này"` : ''}>${statusBadge(step.status)} <code>${escapeHtml(step.api)}</code> ${escapeHtml(step.label ?? '')} <span class="muted">${escapeHtml(meta)}</span></summary>
      ${events ? `<ul class="events">${events}</ul>` : ''}
      ${step.explanation ? `<p class="muted">${escapeHtml(step.explanation)}</p>` : ''}
      ${errorBox(step.error)}
    </details></li>`;
}

function mediaTab(row, attempt, runId) {
  if (row.status === 'passed') return '<p class="muted">Artifact chỉ được lưu cho test không pass.</p>';
  const { video, screenshots } = artifactsOf(attempt);
  const failShot = attempt.failure?.screen;
  const v = video && mediaSrc(runId, video);
  const vid = v ? `<video id="run-video" controls preload="metadata" src="${escapeHtml(v)}"></video>` : '<p class="muted">Không có video.</p>';
  const shots = screenshots
    .map((s) => {
      const src = mediaSrc(runId, s);
      return src ? `<a href="${escapeHtml(src)}" target="_blank" rel="noopener"><img loading="lazy" src="${escapeHtml(src)}" alt="screenshot${s.id === failShot ? ' lúc fail' : ''}"${s.id === failShot ? ' class="fail-shot"' : ''}></a>` : '';
    })
    .join('');
  return `${vid}${shots ? `<div class="shots">${shots}</div>` : ''}`;
}

function logTab(attempt) {
  const lines = attempt.appLog ?? [];
  if (!lines.length) return '<p class="muted">Không có log.</p>';
  return `<pre class="log">${lines.map((l) => `[${escapeHtml(l.level ?? '')}] ${escapeHtml(l.source ?? '')} ${escapeHtml(l.text)}`).join('\n')}</pre>`;
}

function sourceTab(row, attempt) {
  const srcs = new Set([`${row.file}:${row.line}`]);
  if (attempt.error?.source) srcs.add(`${attempt.error.source.file}:${attempt.error.source.line}`);
  for (const s of attempt.steps ?? []) if (s.source) srcs.add(`${s.source.file}:${s.source.line}`);
  return `<ul>${[...srcs].map((s) => `<li><code>${escapeHtml(s)}</code></li>`).join('')}</ul><p class="muted">Mở các vị trí này trong editor.</p>`;
}

function detail(row, meta, runId) {
  const idx = Math.min(ui.attempt.get(row.id) ?? row.attempts.length - 1, row.attempts.length - 1);
  const attempt = row.attempts[idx];
  const pills = row.attempts.length > 1
    ? `<div class="attempts">${row.attempts
      .map((a, i) => `<button data-attempt="${i}" aria-pressed="${i === idx}">Attempt ${i + 1} ${statusBadge(a.status)}</button>`)
      .join('')}</div>`
    : '';
  const head = `<h2>${escapeHtml(row.title)} ${statusBadge(row.status)}</h2>
    <div class="muted"><code>${escapeHtml(row.file)}:${escapeHtml(row.line)}</code> · ${escapeHtml(row.target)} · ${escapeHtml(row.agent)}${row.tags.map((t) => ` <span class="tag">${escapeHtml(t)}</span>`).join('')}</div>`;
  if (!attempt) return `${head}<p class="muted">Test không có attempt nào${row.status === 'skipped' ? ' (bị skip)' : ''}.</p>`;
  const { video } = artifactsOf(attempt);
  const skip = attempt.skip?.reason ? `<p class="muted">Skip: ${escapeHtml(attempt.skip.reason)}</p>` : '';
  const steps = (attempt.steps ?? []).map((s) => stepItem(s, video, attempt)).join('');
  const tabs = TABS.filter(([k]) => k !== 'trace' || meta.traces?.[row.id])
    .map(([k, label, ic]) => `<button data-tab="${k}" aria-pressed="${ui.tab === k}">${icon(ic, { size: 15 })}${label}</button>`)
    .join('');
  const body = { media: () => mediaTab(row, attempt, runId), log: () => logTab(attempt), trace: () => '<div id="trace" class="md">Đang tải trace…</div>', source: () => sourceTab(row, attempt) }[ui.tab]();
  return `${head}${pills}${skip}${errorBox(attempt.error)}
    <ol class="timeline">${steps || '<li class="muted">Không có step.</li>'}</ol>
    <div class="tabs">${tabs}</div><div class="tab-body">${body}</div>`;
}

export async function renderRun(main, route) {
  const { runId, resultId } = route;
  if (ui.runId !== runId || !ui.data) {
    Object.assign(ui, { runId, filters: {}, matrix: false, attempt: new Map(), tab: 'media' });
    ui.data = await getJson(`/api/runs/${encodeURIComponent(runId)}`);
  }
  const { meta, report } = ui.data;
  const all = flattenResults(report);
  const rows = applyFilters(all, ui.filters);
  const selected = all.find((r) => r.id === resultId) ?? rows.find((r) => isFailure(r.status)) ?? rows[0];
  if (ui.tab === 'trace' && !meta.traces?.[selected?.id]) ui.tab = 'media';
  main.innerHTML = `${header(meta, report)}${filterBar(all)}
    <div class="run-body">
      <div class="run-list">${ui.matrix ? matrixTable(rows, runId) : testList(rows, runId, selected?.id)}</div>
      <div class="run-detail panel">${selected ? detail(selected, meta, runId) : '<p class="muted">Không có test.</p>'}</div>
    </div>`;

  const rerender = () => renderRun(main, route);
  main.querySelectorAll('[data-filter]').forEach((el) =>
    el.addEventListener('change', () => {
      ui.filters[el.dataset.filter] = el.value ? [el.value] : [];
      rerender();
    }));
  main.querySelector('[data-toggle="matrix"]')?.addEventListener('click', () => {
    ui.matrix = !ui.matrix;
    rerender();
  });
  main.querySelectorAll('[data-flag]').forEach((el) =>
    el.addEventListener('click', async () => {
      const flag = el.dataset.flag;
      const meta2 = await postJson(`/api/runs/${encodeURIComponent(runId)}/${flag}`, { value: !(flag === 'pin' ? meta.pinned : meta.baseline) });
      ui.data = { ...ui.data, meta: meta2 };
      rerender();
    }));
  main.querySelectorAll('[data-attempt]').forEach((el) =>
    el.addEventListener('click', () => {
      ui.attempt.set(selected.id, Number(el.dataset.attempt));
      rerender();
    }));
  main.querySelectorAll('[data-tab]').forEach((el) =>
    el.addEventListener('click', () => {
      ui.tab = el.dataset.tab;
      rerender();
    }));
  main.querySelectorAll('summary[data-offset]').forEach((el) =>
    el.addEventListener('click', () => {
      const v = main.querySelector('#run-video');
      if (v) v.currentTime = Number(el.dataset.offset);
    }));
  const trace = main.querySelector('#trace');
  if (trace && selected) {
    fetch(fileUrl(runId, meta.traces[selected.id]))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((md) => (trace.innerHTML = renderMarkdown(md)))
      .catch((e) => (trace.textContent = `Không tải được trace: ${e.message}`));
  }
  return () => {
    // leaving the run page drops cached data so the next visit refetches
    if (!location.hash.startsWith(`#/run/${encodeURIComponent(runId)}`)) ui.data = null;
  };
}
