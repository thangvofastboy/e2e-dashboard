import { getJson, postJson, fileUrl, isExport } from '../api.js';
import { confirmDialog } from '../confirm.js';
import { translate } from '../i18n.js';
import { flattenResults, facets, applyFilters, filterKnown, knownKey, matrix, isFailure, isFailed, stepVideoOffset, selectionToRun } from '../model.js';
import { openRunDialog } from './run-dialog.js';
import { openAiPanel } from './ai-panel.js';
import { openLinearDialog } from './linear.js';
import { openBisectDialog } from './actions.js';
import { errorGroupHtml } from './errors.js';
import { renderAiTrace } from './aitrace.js';
import { visualCompareHtml, attachVisualCompare, screenshotTriplets } from '../visual.js';
import { fmtDuration, fmtTokens, statusBadge, countChips, escapeHtml } from '../format.js';
import { renderMarkdown } from '../markdown.js';
import { runHref, compareHref, testHref, replaceParams } from '../router.js';
import { setPageKeys } from '../shortcuts.js';
import { toast } from '../toast.js';
import { copyToClipboard } from '../analysis.js';
import { icon } from '../icons.js';
import { shareBar, legend } from '../charts.js';
import { passRate, nonTestFailures } from '../health.js';

// View state survives re-renders of the same run (filters, matrix toggle, chosen attempt, tab).
const ui = { runId: null, data: null, notes: {}, known: '', filters: {}, matrix: false, attempt: new Map(), tab: 'media', selected: new Set(), saved: [], compareWith: null, groups: [], anomalies: [], owners: {} };
const TABS = [['media', 'Video & ảnh', 'video'], ['log', 'Log', 'terminal'], ['trace', 'Trace', 'route'], ['model', 'Model', 'cpu'], ['source', 'Source', 'code']];
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

const CLASS_LABEL = { configuration: 'Cấu hình', infrastructure: 'Hạ tầng', interrupted: 'Bị ngắt', internal: 'Nội bộ runner' };
const EXIT_TEXT = { 1: 'Có test fail', 2: 'Lỗi cấu hình / thu thập test', 3: 'Lỗi hạ tầng (engine, app, model provider, artifact)', 4: 'Lỗi nội bộ của runner', 130: 'Run bị ngắt' };

// e2e classes every error; only `test` ones say something about the app (the others stay out of the pass rate).
function classChip(err) {
  const label = CLASS_LABEL[err.category];
  return label ? `<span class="tag err-class err-class-${escapeHtml(err.category)}" title="Không tính vào pass rate: lỗi này không nói gì về app đang test">${label}</span> ` : '';
}

// Under the summary: failures that are not the app's fault, and what the exit code means.
function classNote(meta) {
  const c = meta.errorClasses ?? {};
  const n = nonTestFailures(meta);
  const parts = [];
  if (n) parts.push(`${n} kết quả fail do ${[c.infrastructure && 'hạ tầng', c.configuration && 'cấu hình'].filter(Boolean).join(' / ')} (không tính vào pass rate)`);
  if (meta.unredacted) parts.push(`${meta.unredacted} video / file tải về chưa che secret hoàn toàn (redaction: incomplete) — xem lại trước khi chia sẻ (Share, publish); Export HTML không chứa video`);
  if (meta.runErrors) parts.push(`${meta.runErrors} lỗi cấp run`);
  if (meta.exitCode > 1 && EXIT_TEXT[meta.exitCode]) parts.push(`exit ${meta.exitCode}: ${EXIT_TEXT[meta.exitCode]}`);
  return parts.length ? `<p class="small tone-warn class-note">${icon('alert', { size: 14 })}${escapeHtml(parts.join(' · '))}</p>` : '';
}

function errorBox(err) {
  if (!err) return '';
  const d = err.details ?? {};
  const rows = [['Locator', d.locator], ['Mong đợi', d.expected], ['Thực tế', d.observed]]
    .filter(([, v]) => v != null)
    .map(([k, v]) => `<div><span class="muted">${k}:</span> <code>${escapeHtml(v)}</code></div>`)
    .join('');
  const src = err.source ? `<div class="muted">${escapeHtml(err.source.file)}:${escapeHtml(err.source.line)}</div>` : '';
  return `<div class="err">${classChip(err)}<strong>${escapeHtml(err.code ?? 'Lỗi')}</strong> ${escapeHtml(err.message)}${rows}${src}</div>`;
}

function header(meta, report) {
  const s = meta.summary ?? {};
  const tokens = (meta.tokens?.input ?? 0) + (meta.tokens?.output ?? 0);
  const replay = meta.replay?.total ? `<span class="m-replay">${icon('recycle', { size: 14 })}${Math.round((meta.replay.replayed / meta.replay.total) * 100)}% replay</span>` : '';
  const browser = meta.browser ? `<span class="m-browser" title="Trình duyệt">${icon('eye', { size: 14 })}${escapeHtml(meta.browser)}</span>` : '';
  const git = meta.git?.commit ? `<span class="m-git">${icon('branch', { size: 14 })}${escapeHtml(meta.git.branch ?? '?')}@${escapeHtml(String(meta.git.commit).slice(0, 7))}${meta.git.dirty ? ' (dirty)' : ''}</span>` : '';
  const savedRun = ui.saved.find((e) => e.action === 'analyze-run');
  const actions = isExport()
    ? savedRun ? `<button class="btn-ai" data-ai="analyze-run">${icon('sparkles', { size: 15 })}Xem phân tích AI</button>` : ''
    : `<button class="btn-ai" data-ai="analyze-run">${icon('sparkles', { size: 15 })}Phân tích run</button>
       ${flattenResults(report).filter((r) => isFailure(r.status)).length >= 2 ? `<button class="btn-ai" data-ai="dedupe-failures" title="AI gom các test fail cùng nguyên nhân để chỉ tạo một issue cho mỗi nhóm">${icon('layers', { size: 15 })}Gom bug trùng</button>` : ''}
       <button class="btn-ai" data-ai="why-slow" title="So thời gian / token với lịch sử của chính từng test">${icon('timer', { size: 15 })}Vì sao chậm / tốn token?</button>
       ${ui.compareWith ? `<a class="button" href="${compareHref(ui.compareWith.runId, meta.runId)}" title="So với ${ui.compareWith.baseline ? 'baseline' : 'run trước'}">${icon('columns', { size: 15 })}So với ${ui.compareWith.baseline ? 'baseline' : 'run trước'}</a>` : ''}
       <button class="btn-pin${meta.pinned ? ' on' : ''}" data-flag="pin" aria-pressed="${Boolean(meta.pinned)}" title="${meta.pinned ? 'Bỏ ghim' : 'Ghim: không bao giờ bị xoá'}">${icon('pin', { size: 15 })}${meta.pinned ? 'Đã ghim' : 'Ghim'}</button>
       <details class="more"><summary class="button" aria-label="Thêm thao tác">${icon('list', { size: 15 })}Thêm</summary><div class="more-menu">
         <button class="btn-star" data-flag="baseline">${icon('star', { size: 15 })}${meta.baseline ? 'Bỏ baseline' : 'Đặt làm baseline'}</button>
         ${meta.git?.commit ? `<button type="button" data-gh-status title="Gắn ✓/✗ của run này lên commit trên GitHub (gh)">${icon('commit', { size: 15 })}Trạng thái lên GitHub</button>` : ''}
         <a class="button btn-export" href="/api/runs/${encodeURIComponent(meta.runId)}/export" download>${icon('download', { size: 15 })}Export HTML</a>
       </div></details>`;
  const runErrors = (report.run.errors ?? []).map(errorBox).join('');
  const rate = passRate(meta);
  const keys = ['passed', 'flaky', 'failed', 'interrupted', 'skipped'];
  const sum = ui.saved.find((e) => e.action === 'run-summary');
  const aiSummary = sum ? `<section class="panel ai-summary"><h2>${icon('sparkles', { size: 15 })} Tóm tắt AI <span class="muted small">Tự tạo khi run xong</span></h2><div class="md">${renderMarkdown(sum.markdown)}</div></section>` : '';
  return `<nav class="crumbs" aria-label="Vị trí"><a href="#/runs">Runs</a> › <span>${escapeHtml(meta.runId.slice(-8))}</span></nav><div class="run-head">
      <div><h1>Run ${escapeHtml(meta.runId.slice(-8))} ${statusBadge(meta.status)}</h1>
        <div class="run-meta"><span class="m-time">${icon('clock', { size: 14 })}${new Date(meta.startedAt).toLocaleString('vi-VN')} · ${fmtDuration(meta.durationMs)}</span><span class="m-tok">${icon('coins', { size: 14 })}${fmtTokens(tokens)} tok</span>${replay}${browser}${git}</div></div>
      <div class="actions">${actions}</div>
    </div>
    ${aiSummary}
    ${report.run.explore && !(report.run.results ?? []).length ? '' : `<section class="panel run-summary">${shareBar({ segments: keys.map((k) => ({ key: k, value: s[k] ?? 0 })), center: rate == null ? '—' : `${Math.round(rate * 100)}%`, centerLabel: 'Pass rate', ariaLabel: 'Kết quả run' })}
      <div><div>${countChips(s)}</div>${legend(keys.filter((k) => s[k]))}</div></section>`}${classNote(meta)}${runErrors}${explorePanel(report)}${anomaliesPanel()}${groupsPanel()}`;
}

// An `e2e explore` run: its goal, steps and findings (most severe first), and an AI draft of a test.
function explorePanel(report) {
  const e = report.run.explore;
  if (!e) return '';
  const findings = [...(e.findings ?? [])].sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0));
  const sev = (n) => (n >= 4 ? 'bad' : n >= 3 ? 'warn' : 'info');
  return `<section class="panel explore"><div class="section-head"><h2>${icon('route', { size: 15 })} Explore: ${escapeHtml(e.goal)}</h2>
      ${isExport() ? '' : `<button type="button" class="btn-ai" data-explore-test>${icon('sparkles', { size: 14 })}Viết test từ explore</button>`}</div>
    <p class="muted small">Kết thúc: ${escapeHtml(e.ended)} · ${escapeHtml((e.steps ?? []).length)} bước · ${escapeHtml(findings.length)} finding</p>
    ${e.summary ? `<div class="md">${renderMarkdown(e.summary)}</div>` : ''}
    ${findings.length ? `<ul class="findings">${findings.map((f) => `<li><span class="chip tone-${sev(f.severity)}">${escapeHtml(f.kind)} · ${escapeHtml(f.severity)}</span> <strong>${escapeHtml(f.title)}</strong>${f.path ? ` <code>${escapeHtml(f.path)}</code>` : ''}
      <div class="small"><span class="muted">Mong đợi:</span> ${escapeHtml(f.expected)}<br><span class="muted">Thực tế:</span> ${escapeHtml(f.actual)}</div>
      ${(f.reproduction ?? []).length ? `<ol class="small">${f.reproduction.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ol>` : ''}</li>`).join('')}</ul>` : ''}
    <details><summary>Các bước</summary><ol class="small">${(e.steps ?? []).map((x) => `<li>${statusBadge(x.status === 'exhausted' ? 'interrupted' : x.status)} <strong>${escapeHtml(x.title)}</strong> <span class="muted">${escapeHtml(x.instruction)}</span></li>`).join('')}</ol></details></section>`;
}

// Tests far slower or costlier than their own history.
function anomaliesPanel() {
  const a = ui.anomalies;
  if (!a.length) return '';
  const val = (x, v) => (x.metric === 'durationMs' ? fmtDuration(v) : x.metric === 'tokens' ? fmtTokens(v) : String(v));
  return `<section class="panel anomalies"><strong>${icon('zap', { size: 15 })} ${a.length} bất thường</strong> <span class="muted small">so với lịch sử của chính test đó (TB + 2σ)</span>
    <ul>${a.map((x) => `<li><a href="${runHref(x.runId, x.resultId)}">${escapeHtml(x.title)}</a> <span class="muted small">${escapeHtml(x.target)}</span>: ${escapeHtml(x.label)} ${escapeHtml(val(x, x.value))} <span class="muted">(TB ${escapeHtml(val(x, x.mean))}, ${escapeHtml(x.samples)} run)</span></li>`).join('')}</ul></section>`;
}

// Failures of this run grouped by error shape: one fix, several tests.
function groupsPanel() {
  const g = ui.groups;
  if (!g.length || g.reduce((n, x) => n + x.count, 0) < 2) return '';
  return `<details class="panel run-groups"${g.length < 4 ? ' open' : ''}><summary>${icon('layers', { size: 15 })}<strong>Nhóm lỗi</strong> <span class="muted">${g.length} nhóm cho ${g.reduce((n, x) => n + x.count, 0)} test fail</span></summary>
    <div class="err-groups">${g.map((x) => errorGroupHtml(x, { compact: true })).join('')}</div></details>`;
}

const knownOf = (r) => ui.notes?.[knownKey(r)]?.known ?? null;
const urlParams = () => ({ ...Object.fromEntries(Object.entries(ui.filters).map(([k, v]) => [k, v[0]])), failed: ui.onlyFailed ? '1' : undefined, known: ui.known || undefined });

function filterBar(all) {
  const f = facets(all);
  const selects = FILTERS.filter(([k]) => f[k].length > 1 || ui.filters[k]?.length)
    .map(([k, label]) => `<label>${label} <select name="${k}" data-filter="${k}"><option value="">Tất cả</option>${f[k]
      .map((v) => `<option ${ui.filters[k]?.[0] === v ? 'selected' : ''}>${escapeHtml(v)}</option>`)
      .join('')}</select></label>`)
    .join('');
  const nFail = all.filter((r) => isFailed(r.status)).length;
  const nKnown = all.filter((r) => knownOf(r)).length;
  const known = nKnown || ui.known ? `<label>Known bug <select data-known aria-label="Lọc known bug"><option value="">Tất cả</option><option value="only"${ui.known === 'only' ? ' selected' : ''}>Chỉ known bug (${nKnown})</option><option value="hide"${ui.known === 'hide' ? ' selected' : ''}>Ẩn known bug</option></select></label>` : '';
  return `<div class="filters"><button type="button" class="only-failed" data-only-failed aria-pressed="${Boolean(ui.onlyFailed)}"${nFail ? '' : ' disabled'}>${icon('x', { size: 14 })}Chỉ test fail <strong>${nFail}</strong></button>${selects}${known}<button class="btn-matrix" data-toggle="matrix" aria-pressed="${ui.matrix}">${icon('table', { size: 15 })}Ma trận</button></div>`;
}

function testList(rows, runId, selectedId) {
  if (!rows.length) return '<p class="muted">Không có test nào khớp bộ lọc.</p>';
  return `<ul class="test-list">${rows
    .map((r) => `<li>${isExport() ? '' : `<input type="checkbox" class="sel" data-sel="${escapeHtml(r.id)}" ${ui.selected.has(r.id) ? 'checked' : ''} aria-label="Chọn ${escapeHtml(r.title)}">`}<a class="${r.id === selectedId ? 'selected' : ''}" href="${runHref(runId, r.id)}">
      ${statusBadge(r.status)} <span class="title">${escapeHtml(r.title)}</span>${knownOf(r) ? ` <span class="chip tone-warn known-chip" title="Known bug: đã có ticket">KNOWN ${escapeHtml(knownOf(r))}</span>` : ''}
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
      ${step.api === 'agent.act' && step.cache && !isExport() && Number.isInteger(step.index) ? `<button type="button" class="btn-ai small-btn" data-locator="${escapeHtml(step.index)}" title="Đề xuất code locator thay cho bước agent này">${icon('crosshair', { size: 13 })}Chuyển thành locator</button>` : ''}
    </details></li>`;
}

// The export leaves videos out (size); say which file instead of a silent "no video".
export function videoNote(video, src) {
  if (src) return '';
  if (video?.path) return `<p class="muted">Video không được nhúng vào file export: <code>${escapeHtml(video.path.split('/').pop())}</code></p>`;
  return '<p class="muted">Không có video.</p>';
}

function mediaTab(row, attempt, runId) {
  if (row.status === 'passed') return '<p class="muted">Artifact chỉ được lưu cho test không pass.</p>';
  const { video, screenshots } = artifactsOf(attempt);
  const failShot = attempt.failure?.screen;
  const v = video && mediaSrc(runId, video);
  const vid = v ? `<video id="run-video" controls preload="metadata" src="${escapeHtml(v)}"></video>` : videoNote(video, v);
  const shots = screenshots
    .map((s) => {
      const src = mediaSrc(runId, s);
      // CSP img-src is 'self' data: — a remote (CI-hosted) screenshot can only be linked, not inlined
      if (src && !s.path) return `<a class="button ext-shot" href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer">${icon('external', { size: 14 })}Mở screenshot${s.id === failShot ? ' lúc fail' : ''}</a>`;
      return src ? `<a href="${escapeHtml(src)}" target="_blank" rel="noopener"><img loading="lazy" src="${escapeHtml(src)}" alt="screenshot${s.id === failShot ? ' lúc fail' : ''}"${s.id === failShot ? ' class="fail-shot"' : ''}></a>` : '';
    })
    .join('');
  const visual = screenshotTriplets(screenshots)
    .map((t) => `${visualCompareHtml({ left: mediaSrc(runId, t.expected), right: mediaSrc(runId, t.actual), diff: t.diff ? mediaSrc(runId, t.diff) : null, leftLabel: 'Ảnh mẫu (expected)', rightLabel: 'Thực tế (actual)', title: `toHaveScreenshot · ${t.name}` })}${isExport() ? '' : `<p class="visual-ai"><button type="button" class="btn-ai" data-ai-visual="${escapeHtml(row.id)}" data-name="${escapeHtml(t.name)}">${icon('sparkles', { size: 14 })}AI giải thích khác biệt</button> <button type="button" data-update-snapshot="${escapeHtml(row.id)}" title="Chạy lại test này với -u: ảnh mẫu được ghi đè bằng ảnh thực tế (commit file *-snapshots/ sau đó)">${icon('check', { size: 14 })}Chấp nhận ảnh mới (-u)</button> <span class="muted small">Lỗi thật hay thay đổi có chủ đích</span></p>`}`)
    .join('');
  return `${visual}${vid}${shots ? `<div class="shots">${shots}</div>` : ''}`;
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
  const head = `<h2>${isExport() ? escapeHtml(row.title) : `<a href="${testHref(`${row.testId}|${row.target}|${row.agent}`)}" title="Lịch sử của test này">${escapeHtml(row.title)}</a>`} ${statusBadge(row.status)}</h2>
    <div class="muted"><code>${escapeHtml(row.file)}:${escapeHtml(row.line)}</code> · ${escapeHtml(row.target)} · ${escapeHtml(row.agent)}${row.tags.map((t) => ` <span class="tag">${escapeHtml(t)}</span>`).join('')}${ui.owners[row.file]?.length ? ` · <span class="owners" title="CODEOWNERS">${icon('users', { size: 13 })}${escapeHtml(ui.owners[row.file].join(', '))}</span>` : ''}</div>`;
  if (!attempt) return `${head}<p class="muted">Test không có attempt nào${row.status === 'skipped' ? ' (bị skip)' : ''}.</p>`;
  const { video } = artifactsOf(attempt);
  const skip = attempt.skip?.reason ? `<p class="muted">Skip: ${escapeHtml(attempt.skip.reason)}</p>` : '';
  const steps = (attempt.steps ?? []).map((s) => stepItem(s, video, attempt)).join('');
  const tabs = TABS.filter(([k]) => (k !== 'trace' || meta.traces?.[row.id]) && (k !== 'model' || (meta.aiTrace && !isExport())))
    .map(([k, label, ic]) => `<button data-tab="${k}" aria-pressed="${ui.tab === k}">${icon(ic, { size: 15 })}${label}</button>`)
    .join('');
  const body = { media: () => mediaTab(row, attempt, runId), log: () => logTab(attempt), trace: () => '<div id="trace" class="md">Đang tải trace…</div>', model: () => '<div id="aitrace" class="ai-trace">Đang tải…</div>', source: () => sourceTab(row, attempt) }[ui.tab]();
  const savedFail = ui.saved.find((e) => e.action === 'analyze-failure' && e.resultId === row.id);
  const aiBtn = isFailure(row.status) && (!isExport() || savedFail)
    ? `<button type="button" class="btn-ai" data-ai="analyze-failure" data-result="${escapeHtml(row.id)}">${icon('sparkles', { size: 14 })}${isExport() ? 'Xem phân tích lỗi' : 'Phân tích lỗi'}</button>${isExport() ? '' : `<button type="button" class="btn-ai" data-ai="repro-steps" data-result="${escapeHtml(row.id)}" title="AI viết các bước tái hiện cho người không biết code">${icon('list', { size: 14 })}Bước tái hiện</button><button type="button" class="btn-ai" data-ai="severity" data-result="${escapeHtml(row.id)}" title="AI đề xuất mức độ nghiêm trọng để bạn duyệt">${icon('alert', { size: 14 })}Mức độ nghiêm trọng</button>`}`
    : '';
  const linearBtn = isFailure(row.status) && !isExport()
    ? `<button type="button" data-linear="${escapeHtml(row.id)}">${icon('ticket', { size: 14 })}Gửi Linear</button><button type="button" data-bisect="${escapeHtml(row.id)}">${icon('commit', { size: 14 })}Tìm commit gây lỗi</button><button type="button" data-fix="${escapeHtml(row.id)}" title="Copy lệnh để Claude Code đọc lỗi, sửa và chạy lại test">${icon('bolt', { size: 14 })}Sửa bằng Claude Code</button>`
    : '';
  const qc = isExport() ? '' : `<section class="qc-box" data-qc-key="${escapeHtml(`${row.testId}|${row.target}|${row.agent}`)}">
      <h3>${icon('ticket', { size: 14 })}Ghi chú QC</h3>
      <label class="fb-field"><span>Ghi chú</span><textarea data-qc-note rows="2" maxlength="2000" placeholder="Ví dụ: lỗi do data staging, đã báo dev"></textarea></label>
      <label class="fb-field"><span>Known bug (mã ticket)</span><input data-qc-known maxlength="40" placeholder="LIN-123"></label>
      <div class="form-row"><button type="button" data-qc-save>${icon('check', { size: 14 })}Lưu ghi chú</button><button type="button" data-qc-bug title="Chép nội dung bug report (Markdown) của attempt này">${icon('copy', { size: 14 })}Copy bug report</button></div>
      <div class="form-row"><input data-qc-attach maxlength="200" placeholder="Gắn issue Linear có sẵn: ENG-123 hoặc link" aria-label="Issue Linear có sẵn"><button type="button" data-qc-attach-go>${icon('ticket', { size: 14 })}Gắn issue</button><button type="button" data-qc-detach hidden title="Gỡ liên kết với issue Linear (issue trên Linear không bị xoá)">${icon('close', { size: 14 })}Gỡ issue</button><button type="button" data-qc-comment hidden title="Lỗi khác lỗi đã biết: comment nội dung lỗi này vào issue của known bug">${icon('send', { size: 14 })}Comment lỗi mới vào issue</button></div>
      <div class="form-row"><select data-qc-tpl aria-label="Mẫu prompt"></select><button type="button" data-qc-prompt title="Chép prompt đã điền dữ liệu để dán vào Claude">${icon('copy', { size: 14 })}Copy prompt</button><button type="button" class="btn-ai" data-qc-ai>${icon('sparkles', { size: 14 })}Để AI viết</button></div>
      <pre class="tpl-out" data-qc-out hidden></pre></section>`;
  return `${head}${pills}${skip}${errorBox(attempt.error)}${aiBtn}${linearBtn}${qc}
    <ol class="timeline">${steps || '<li class="muted">Không có step.</li>'}</ol>
    <div class="tabs">${tabs}</div><div class="tab-body">${body}</div>`;
}

const AI_TITLES = { 'analyze-run': 'Phân tích run', 'why-slow': 'Vì sao chậm / tốn token', 'dedupe-failures': 'Gom bug trùng', 'repro-steps': 'Bước tái hiện', severity: 'Mức độ nghiêm trọng' };

export async function renderRun(main, route) {
  const { runId, resultId } = route;
  if (ui.runId !== runId || !ui.data) {
    Object.assign(ui, { runId, onlyFailed: route.params?.failed === '1', filters: Object.fromEntries(Object.entries(route.params ?? {}).filter(([k]) => FILTERS.some(([f]) => f === k)).map(([k, v]) => [k, [v]])), matrix: false, attempt: new Map(), tab: 'media', selected: new Set(), saved: [] });
    ui.known = ['only', 'hide'].includes(route.params?.known) ? route.params.known : ''; // known bug: chỉ hiện / ẩn
    ui.notes = {};
    // a newer renderRun (the viewer clicked another run) owns `ui` now: a slow response must not land in it
    const stale = () => ui.runId !== runId || !main.isConnected;
    const data = await getJson(`/api/runs/${encodeURIComponent(runId)}`);
    const saved = (await getJson(`/api/runs/${encodeURIComponent(runId)}/ai`).catch(() => ({ entries: [] }))).entries ?? [];
    if (stale()) return;
    ui.data = data;
    ui.saved = saved;
    ui.compareWith = null;
    ui.groups = [];
    ui.anomalies = [];
    ui.owners = {};
    if (!isExport()) {
      const [metas, errs] = await Promise.all([getJson('/api/runs').catch(() => []), getJson(`/api/errors?runId=${encodeURIComponent(runId)}`).catch(() => ({ groups: [] }))]);
      if (stale()) return;
      const i = metas.findIndex((m) => m.runId === runId);
      const base = metas.find((m) => m.baseline && m.runId !== runId);
      ui.compareWith = base ?? (i >= 0 ? metas[i + 1] ?? null : null);
      ui.groups = errs.groups ?? [];
      const files = [...new Set(flattenResults(ui.data.report).map((r) => r.file).filter(Boolean))].slice(0, 200);
      const [an, own, notes] = await Promise.all([
        getJson(`/api/anomalies?runId=${encodeURIComponent(runId)}`).catch(() => ({ anomalies: [] })),
        getJson(`/api/owners?files=${encodeURIComponent(files.join(','))}`).catch(() => ({ owners: {} })),
        getJson('/api/qc/notes').catch(() => ({})),
      ]);
      if (stale()) return;
      ui.anomalies = an.anomalies ?? [];
      ui.owners = own.owners ?? {};
      ui.notes = notes ?? {};
    }
  }
  const { meta, report } = ui.data;
  const all = flattenResults(report);
  const rows = filterKnown(applyFilters(all, ui.filters).filter((r) => !ui.onlyFailed || isFailed(r.status)), ui.known, ui.notes);
  const selected = all.find((r) => r.id === resultId) ?? rows.find((r) => isFailure(r.status)) ?? rows[0];
  if (ui.tab === 'trace' && !meta.traces?.[selected?.id]) ui.tab = 'media';
  if (ui.tab === 'model' && !(meta.aiTrace && !isExport())) ui.tab = 'media';
  const exploreOnly = report.run.explore && !all.length;
  main.innerHTML = `${header(meta, report)}${exploreOnly ? '' : `${filterBar(all)}
    <div class="run-body">
      <div class="run-list">${isExport() || ui.matrix ? '' : `<div class="sel-bar"><button type="button" data-select-failed>${icon('x', { size: 14 })}Chọn tất cả fail</button><button type="button" class="primary" data-rerun ${ui.selected.size ? '' : 'disabled'}>${icon('rerun', { size: 14 })}Chạy lại (${ui.selected.size})</button></div>`}${ui.matrix ? matrixTable(rows, runId) : testList(rows, runId, selected?.id)}</div>
      <div class="run-detail panel">${selected ? detail(selected, meta, runId) : '<p class="muted">Không có test.</p>'}</div>
    </div>`}`;

  const rerender = () => renderRun(main, route);
  main.querySelectorAll('[data-filter]').forEach((el) =>
    el.addEventListener('change', () => {
      ui.filters[el.dataset.filter] = el.value ? [el.value] : [];
      replaceParams(urlParams());
      rerender();
    }));
  main.querySelector('[data-known]')?.addEventListener('change', (e) => {
    ui.known = e.target.value;
    replaceParams(urlParams());
    rerender();
  });
  main.querySelector('[data-only-failed]')?.addEventListener('click', () => {
    ui.onlyFailed = !ui.onlyFailed;
    replaceParams(urlParams());
    rerender();
  });
  main.querySelector('[data-toggle="matrix"]')?.addEventListener('click', () => {
    ui.matrix = !ui.matrix;
    rerender();
  });
  main.querySelectorAll('[data-flag]').forEach((el) =>
    el.addEventListener('click', async () => {
      const flag = el.dataset.flag;
      const meta2 = await postJson(`/api/runs/${encodeURIComponent(runId)}/${flag}`, { value: !(flag === 'pin' ? meta.pinned : meta.baseline) });
      ui.data = { ...ui.data, meta: meta2 };
      toast(flag === 'pin' ? (meta2.pinned ? 'Đã ghim run (không bị xoá)' : 'Đã bỏ ghim') : meta2.baseline ? 'Đã đặt làm baseline' : 'Đã bỏ baseline');
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
  main.querySelectorAll('[data-sel]').forEach((el) =>
    el.addEventListener('change', () => {
      if (el.checked) ui.selected.add(el.dataset.sel);
      else ui.selected.delete(el.dataset.sel);
      // update in place: a full re-render would reload the video and drop keyboard focus on every tick
      const btn = main.querySelector('[data-rerun]');
      if (btn) {
        btn.disabled = !ui.selected.size;
        btn.lastChild.textContent = translate(`Chạy lại (${ui.selected.size})`);
      }
    }));
  main.querySelector('[data-select-failed]')?.addEventListener('click', () => {
    ui.selected = new Set(all.filter((r) => isFailure(r.status)).map((r) => r.id));
    rerender();
  });
  main.querySelector('[data-rerun]')?.addEventListener('click', () => {
    const sel = selectionToRun(all, ui.selected);
    const f = facets(all);
    openRunDialog({ ...sel, allTargets: f.targets, allAgents: f.agents, rerunOf: runId, title: `Chạy lại ${sel.tests.length} test` });
  });
  main.querySelectorAll('[data-ai]').forEach((el) =>
    el.addEventListener('click', () => {
      const action = el.dataset.ai;
      const resultId = el.dataset.result ?? null;
      const saved = ui.saved.find((e) => e.action === action && (action === 'analyze-run' || action === 'why-slow' || action === 'dedupe-failures' || e.resultId === resultId));
      const row = all.find((r) => r.id === resultId);
      openAiPanel({ action, runId, resultId, saved, title: AI_TITLES[action] ? `${AI_TITLES[action]}${resultId ? ` · ${row?.title ?? ''}` : ''}` : `Phân tích lỗi · ${row?.title ?? ''}` });
    }));
  main.querySelectorAll('[data-fix]').forEach((el) =>
    el.addEventListener('click', async () => {
      const cmd = `/e2e-dashboard:e2e-dashboard fix ${runId} ${el.dataset.fix}`;
      const ok = await copyToClipboard(cmd);
      toast(ok ? 'Đã copy lệnh: dán vào Claude Code để Claude sửa và chạy lại test' : cmd, ok ? 'good' : 'info', 6000);
    }));
  main.querySelectorAll('[data-bisect]').forEach((el) => el.addEventListener('click', () => openBisectDialog({ runId, resultId: el.dataset.bisect })));
  main.querySelectorAll('[data-linear]').forEach((el) => el.addEventListener('click', () => openLinearDialog({ runId, resultId: el.dataset.linear })));
  main.querySelectorAll('[data-locator]').forEach((el) =>
    el.addEventListener('click', () => {
      const step = selected.attempts.flatMap((a) => a.steps ?? []).find((x) => x.index === Number(el.dataset.locator));
      openAiPanel({ action: 'suggest-locator', runId, resultId: selected.id, extra: { stepIndex: Number(el.dataset.locator) }, title: `Locator · ${step?.label ?? ''}` });
    }));
  attachVisualCompare(main);
  main.querySelector('[data-gh-status]')?.addEventListener('click', async () => {
    try {
      const r = await postJson('/api/github/status', { runId });
      toast(`Đã gắn trạng thái ${r.state} lên commit`);
    } catch (e) {
      toast(e.message.replace(/^\d+: /, ''), 'bad', 6000);
    }
  });
  main.querySelector('[data-explore-test]')?.addEventListener('click', () => openAiPanel({ action: 'explore-to-test', runId, title: 'Viết test từ explore' }));
  // j/k: next/previous test in the list; r: rerun it; a: AI analysis; l: Linear
  const idx = rows.findIndex((r) => r.id === selected?.id);
  const goTo = (i) => rows[i] && (location.hash = runHref(runId, rows[i].id));
  setPageKeys(isExport() ? {} : {
    j: { label: 'Test kế tiếp', run: () => goTo(idx + 1) },
    k: { label: 'Test trước', run: () => goTo(idx - 1) },
    r: { label: 'Chạy lại test đang xem', run: () => selected && openRunDialog({ ...selectionToRun(all, new Set([selected.id])), allTargets: facets(all).targets, allAgents: facets(all).agents, rerunOf: runId, title: `Chạy lại ${selected.title}` }) },
    a: { label: 'Phân tích lỗi bằng AI', run: () => main.querySelector('[data-ai="analyze-failure"]')?.click() },
    l: { label: 'Gửi Linear', run: () => main.querySelector('[data-linear]')?.click() },
  });
  main.querySelectorAll('summary[data-offset]').forEach((el) =>
    el.addEventListener('click', () => {
      const v = main.querySelector('#run-video');
      if (v) v.currentTime = Number(el.dataset.offset);
    }));
  main.querySelectorAll('[data-update-snapshot]').forEach((b) =>
    b.addEventListener('click', () => {
      const f = facets(all);
      openRunDialog({ ...selectionToRun(all, new Set([b.dataset.updateSnapshot])), allTargets: f.targets, allAgents: f.agents, rerunOf: runId, title: 'Cập nhật snapshot', preset: { updateSnapshots: true } });
    }));
  const qcEl = main.querySelector('.qc-box');
  if (qcEl && selected) bindQc(qcEl, runId, selected);
  const aiEl = main.querySelector('#aitrace');
  if (aiEl && selected) renderAiTrace(aiEl, runId, selected.testId);
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

// Danh sách mẫu prompt: giữ 20 giây để chuyển qua lại giữa các test không tải lại mỗi lần.
let tplCache = { at: 0, list: [] };
async function qcTemplates() {
  if (Date.now() - tplCache.at < 20_000) return tplCache.list;
  const list = await getJson('/api/qc/templates').then((r) => r.templates).catch(() => null);
  if (list) tplCache = { at: Date.now(), list };
  return list ?? tplCache.list;
}

// Ghi chú QC của một test (dùng chung cho mọi run) và bug report của một result.
async function bindQc(el, runId, row) {
  const key = el.dataset.qcKey;
  const note = el.querySelector('[data-qc-note]');
  const known = el.querySelector('[data-qc-known]');
  const all = ui.notes ?? {}; // đã tải cùng lúc với run
  note.value = all[key]?.note ?? '';
  known.value = all[key]?.known ?? '';
  const commentBtn = el.querySelector('[data-qc-comment]');
  const detachBtn = el.querySelector('[data-qc-detach]');
  const syncComment = () => {
    commentBtn.hidden = !(known.value.trim() && isFailure(row.status));
    detachBtn.hidden = !known.value.trim();
  };
  syncComment();
  known.addEventListener('input', syncComment);
  el.querySelector('[data-qc-attach-go]').addEventListener('click', async (e) => {
    const input = el.querySelector('[data-qc-attach]');
    if (!input.value.trim()) return;
    e.currentTarget.setAttribute('aria-busy', 'true');
    try {
      const r = await postJson('/api/linear/attach', { runId, resultId: row.id, ref: input.value });
      known.value = r.issue.identifier;
      ui.notes = { ...(ui.notes ?? {}), [key]: { note: note.value, known: r.issue.identifier } };
      input.value = '';
      syncComment();
      toast(`Đã gắn ${r.issue.identifier}${r.issue.title ? `: ${r.issue.title}` : ''}${r.verified ? '' : ' (chưa xác minh với Linear)'}`);
    } catch (x) {
      toast(x.message.replace(/^\d{3}: /, ''), 'bad');
    } finally {
      e.currentTarget.removeAttribute('aria-busy');
    }
  });
  const COMMENT_RESULT = {
    commented: (c) => `Đã comment lỗi mới vào ${c.issue}`,
    'same-bug': (c) => `Lỗi này đã được ghi nhận trên ${c.issue}: không comment lại`,
    'issue-closed': (c) => `${c.issue} đã đóng: dùng "Gửi Linear" để tạo issue mới`,
    'issue-missing': (c) => `Linear không còn issue ${c.issue}`,
    'not-known': () => 'Test này chưa gắn issue nào',
  };
  detachBtn.addEventListener('click', async (e) => {
    const id = known.value.trim();
    if (!(await confirmDialog({ title: 'Gỡ liên kết issue', message: `Gỡ liên kết ${id} khỏi bug này? Issue trên Linear không bị xoá.`, confirmLabel: 'Gỡ liên kết' }))) return;
    e.currentTarget.setAttribute('aria-busy', 'true');
    try {
      await postJson('/api/linear/detach', { runId, resultId: row.id });
      known.value = '';
      ui.notes = { ...(ui.notes ?? {}), [key]: { note: note.value, known: null } };
      syncComment();
      toast(`Đã gỡ ${id} khỏi bug`);
    } catch (x) {
      toast(x.message.replace(/^\d{3}: /, ''), 'bad');
    } finally {
      e.currentTarget.removeAttribute('aria-busy');
    }
  });
  commentBtn.addEventListener('click', async (e) => {
    e.currentTarget.setAttribute('aria-busy', 'true');
    try {
      const c = await postJson('/api/linear/comment-known', { runId, resultId: row.id });
      toast(COMMENT_RESULT[c.status]?.(c) ?? c.status, c.status === 'commented' || c.status === 'same-bug' ? 'good' : 'warn');
    } catch (x) {
      toast(x.message.replace(/^\d{3}: /, ''), 'bad');
    } finally {
      e.currentTarget.removeAttribute('aria-busy');
    }
  });
  el.querySelector('[data-qc-save]').addEventListener('click', async () => {
    try {
      await postJson('/api/qc/notes', { key, note: note.value, known: known.value.trim(), runId, resultId: row.id });
      ui.notes = { ...(ui.notes ?? {}), [key]: { note: note.value, known: known.value.trim() || null } };
      toast('Đã lưu ghi chú QC');
    } catch (x) {
      toast(x.message.replace(/^\d{3}: /, ''), 'bad');
    }
  });
  const tplSel = el.querySelector('[data-qc-tpl]');
  const tpls = await qcTemplates();
  tplSel.innerHTML = tpls.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');
  const useTpl = async (path, label) => {
    const out = el.querySelector('[data-qc-out]');
    try {
      const r = await postJson(path, { templateId: tplSel.value, runId, resultId: row.id });
      const text = r.prompt ?? r.text;
      if (path.endsWith('/render')) {
        await navigator.clipboard.writeText(text);
        toast('Đã chép prompt');
      } else {
        out.hidden = false;
        out.textContent = text;
        await navigator.clipboard.writeText(text);
        toast(`${label}: đã chép kết quả`);
      }
    } catch (x) {
      toast(x.message.replace(/^\d{3}: /, ''), 'bad');
    }
  };
  el.querySelector('[data-qc-prompt]').addEventListener('click', () => useTpl('/api/qc/render', 'Prompt'));
  el.querySelector('[data-qc-ai]').addEventListener('click', (e) => { e.currentTarget.setAttribute('aria-busy', 'true'); useTpl('/api/qc/generate', 'AI').finally(() => e.currentTarget.removeAttribute('aria-busy')); });
  el.querySelector('[data-qc-bug]').addEventListener('click', async () => {
    try {
      const md = await fetch(`/api/runs/${encodeURIComponent(runId)}/bug-report?resultId=${encodeURIComponent(row.id)}`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))));
      await navigator.clipboard.writeText(md);
      toast('Đã chép bug report (Markdown)');
    } catch (x) {
      toast(`Không chép được: ${x.message}`, 'bad');
    }
  });
}

// "AI giải thích khác biệt" ở khối so sánh ảnh: một listener cho mọi lần vẽ lại tab ảnh
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-ai-visual]');
    if (!b || !ui.runId) return;
    openAiPanel({ action: 'explain-visual', runId: ui.runId, resultId: b.dataset.aiVisual, title: `Khác biệt ảnh · ${b.dataset.name}`, extra: { name: b.dataset.name } });
  });
}
