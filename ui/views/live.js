import { getJson, liveStream, postJson, isExport } from '../api.js';
import { confirmDialog } from '../confirm.js';
import { renderMarkdown } from '../markdown.js';
import { isFailed, flattenResults } from '../model.js';
import { openRunDialog } from './run-dialog.js';
import { openAiPanel } from './ai-panel.js';
import { openLinearDialog } from './linear.js';
import { openBisectDialog } from './actions.js';
import { copyToClipboard } from '../analysis.js';
import { toast } from '../toast.js';
import { icon } from '../icons.js';
import { fmtDuration, statusBadge, escapeHtml } from '../format.js';

// Output terminal mang mã màu ANSI và ký tự điều khiển: bỏ đi để <pre> không hiện ô vuông / "[1m[41m".
export function stripAnsi(s) {
  return String(s ?? '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC, vd. link terminal ESC]8;;url BEL
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '') // CSI: màu, con trỏ
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

// " · 2 pass · 35 fail · 137 skip" sau thanh tiến độ: run fail trong vài giây vẫn thấy ngay kết quả
// peak = làn đã dùng cao nhất (số worker thật đã chạy song song); running = test đang chạy lúc này
export function tally(tests = [], peak = 0) {
  const n = (s) => tests.filter((t) => t.status === s).length;
  const running = n('running');
  const parts = [[n('passed'), 'pass', 'tone-good'], [n('failed'), 'fail', 'tone-bad'], [n('flaky'), 'flaky', 'tone-warn'], [n('skipped'), 'skip', '']]
    .filter(([c]) => c)
    .map(([c, label, cls]) => `<span class="${cls}">${c} ${label}</span>`);
  if (running) parts.unshift(`<span class="tone-info">${running} worker đang chạy${peak > running ? ` (tối đa ${peak})` : ''}</span>`);
  else if (peak) parts.unshift(`<span class="muted">tối đa ${peak} worker</span>`);
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}

// Lỗi gốc cần báo ngay, không bắt người dùng bấm từng test: setup fail (chặn các test phụ thuộc)
// và lỗi lặp ở ≥3 test (thường do môi trường: thiếu file auth, thiếu .env, sai URL…). Gom theo message.
export function blockers(tests = []) {
  const groups = new Map();
  for (const t of tests) {
    if (t.status !== 'failed' || !t.error?.message) continue;
    const g = groups.get(t.error.message) ?? { message: t.error.message, setups: [], count: 0 };
    g.count += 1;
    if (/\.setup\./.test(t.file ?? '') || String(t.key ?? '').startsWith('setup::')) g.setups.push(t.title);
    groups.set(t.error.message, g);
  }
  return [...groups.values()].filter((g) => g.setups.length || g.count >= 3).sort((a, b) => b.setups.length - a.setups.length || b.count - a.count).slice(0, 3);
}

function blockersHtml(tests) {
  return blockers(tests)
    .map((g) => {
      const what = g.setups.length ? `Setup <b>${escapeHtml(g.setups.join(', '))}</b> fail — các test phụ thuộc sẽ fail theo` : `${g.count} test fail cùng một lỗi`;
      return `<div class="banner tone-bad">${icon('alert', { size: 14 })}<span>${what}. Sửa lỗi này trước rồi chạy lại:</span><code>${escapeHtml(stripAnsi(g.message).slice(0, 300))}</code></div>`;
    })
    .join('');
}

const LOST = 'Mất kết nối với dashboard (có thể vừa khởi động lại sau khi cập nhật) — mở lại link từ /e2e-dashboard để xem và dừng run.';
// banner: lệnh trong <code> để boldNumbers (app.js) không tô đậm chữ số trong "e2e"
const LOST_BANNER = `<div class="banner tone-bad">${icon('alert', { size: 14 })}Mất kết nối với dashboard (có thể vừa khởi động lại sau khi cập nhật) — mở lại link từ <code>/e2e-dashboard</code> để xem và dừng run.</div>`;

export function ganttBlocks(snapshot, now = Date.now()) {
  const t0 = Date.parse(snapshot.startedAt);
  if (Number.isNaN(t0) || !snapshot.tests?.length) return [];
  const end = snapshot.finishedAt ? Date.parse(snapshot.finishedAt) : now;
  const span = Math.max(1, end - t0);
  return snapshot.tests.map((t) => {
    const s = Date.parse(t.startedAt);
    const e = t.finishedAt ? Date.parse(t.finishedAt) : end;
    return {
      key: t.key,
      lane: t.lane,
      left: Math.round(((s - t0) / span) * 1000) / 10,
      width: Math.max(0.5, Math.round(((e - s) / span) * 1000) / 10),
      status: t.status,
      title: t.title,
      durationMs: e - s,
    };
  });
}

// Vạch chia trục thời gian: bước "đẹp" nhỏ nhất cho ≤6 vạch; trả về vị trí % và nhãn.
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600].map((s) => s * 1000);
const tickLabel = (ms) => (ms < 60_000 ? `${ms / 1000}s` : ms < 3_600_000 ? `${ms / 60_000}m` : `${ms / 3_600_000}h`); // bước tròn: không cần số lẻ
export function axisTicks(spanMs) {
  if (!(spanMs > 0)) return [{ pct: 0, label: '0s' }];
  const step = STEPS.find((s) => spanMs / s <= 6) ?? Math.ceil(spanMs / 6 / 3_600_000) * 3_600_000;
  const out = [];
  for (let t = 0; t <= spanMs; t += step) out.push({ pct: Math.round((t / spanMs) * 1000) / 10, label: tickLabel(t) });
  return out;
}

// Danh sách test fail dưới gantt: chỉ fail thật (bỏ interrupted = bị dừng giữa chừng, không phải lỗi test)
const FAILED = ['failed', 'timed-out', 'error'];
export const failedRows = (tests = []) => (tests ?? []).filter((t) => FAILED.includes(t.status));

// key live = testId|target|agent|repeat (server/live.mjs keyOf) → result trong báo cáo; trùng thì lấy cái đầu
export function matchResultId(t, report) {
  if (!report?.run?.results) return null;
  return flattenResults(report).find((r) => r.testId === t.testId && r.target === t.target && r.agent === (t.agent ?? 'default') && r.repeat === (t.repeat ?? 0)) ?? null;
}

export const runsHref = (runId) => (runId ? `#/run/${encodeURIComponent(runId)}` : '#/runs');

// ctx: { runId, finished, results: { [liveKey]: { id, file, line } } } — results chỉ có khi đã lấy báo cáo
export function failedHtml(tests, { runId = null, finished = false, results = {} } = {}) {
  const rows = failedRows(tests);
  if (!rows.length) return '';
  const items = rows.map((t) => {
    const r = results[t.key];
    const where = r?.line ? `${r.file}:${r.line}` : t.line ? `${t.file}:${t.line}` : t.file ?? '';
    const first = stripAnsi(t.error?.message ?? '').split('\n').find((l) => l.trim()) ?? '';
    const k = escapeHtml(t.key);
    const id = r ? escapeHtml(r.id) : '';
    const more = r && runId
      ? `<button type="button" class="small-btn btn-ai" data-live-ai="analyze-failure" data-result="${id}" data-title="${escapeHtml(t.title)}">${icon('sparkles', { size: 13 })}Phân tích lỗi</button><button type="button" class="small-btn btn-ai" data-live-ai="repro-steps" data-result="${id}" data-title="${escapeHtml(t.title)}">${icon('list', { size: 13 })}Bước tái hiện</button><button type="button" class="small-btn" data-live-linear="${id}">${icon('ticket', { size: 13 })}Gửi Linear</button><button type="button" class="small-btn" data-live-bisect="${id}">${icon('commit', { size: 13 })}Tìm commit gây lỗi</button><button type="button" class="small-btn" data-live-fix="${id}" title="Copy lệnh để Claude Code đọc lỗi, sửa và chạy lại test">${icon('bolt', { size: 13 })}Sửa bằng Claude Code</button>`
      : finished && !runId ? '<span class="muted small">chưa có báo cáo để phân tích</span>' : '';
    return `<li class="failed-row"><div><strong>${escapeHtml(t.title)}</strong> ${statusBadge(t.status)} <span class="muted small"><code>${escapeHtml(where)}</code> · ${escapeHtml(t.target)}</span></div>
      ${first ? `<div class="err">${t.error?.code ? `<code>${escapeHtml(t.error.code)}</code> ` : ''}${escapeHtml(first.slice(0, 300))}</div>` : ''}
      <div class="row-actions"><button type="button" class="small-btn" data-view-steps="${k}">${icon('list', { size: 13 })}Xem bước</button><button type="button" class="small-btn" data-rerun-one="${k}">${icon('play', { size: 13 })}Chạy lại</button>${more}</div></li>`;
  });
  return `<h2>Test fail <strong>${rows.length}</strong></h2><ul class="failed-list">${items.join('')}</ul>`;
}

// thanh tài nguyên trong head (GET /api/resources); thiếu dữ liệu thì trả '' để không hiện gì
export function formatResources(res) {
  const m = res?.machine;
  if (!m) return '';
  const gb = (mb) => (mb / 1024).toFixed(1);
  const parts = [];
  if (m.cpuPct != null) parts.push(`CPU máy ${Math.round(m.cpuPct)}%`);
  if (m.memTotalMb) parts.push(`RAM ${gb(m.memTotalMb - (m.memFreeMb ?? 0))}/${gb(m.memTotalMb)} GB`);
  if (m.diskFreeGb != null) parts.push(`Disk trống ${Math.round(m.diskFreeGb)} GB`);
  const r = res.app?.runner;
  if (r) parts.push(`App: ${Math.round(r.rssMb)} MB · ${Math.round(r.cpuPct)}% CPU · ${r.procs} tiến trình`);
  return parts.length ? `<p class="muted small live-res">${parts.map(escapeHtml).join(' · ')}</p>` : '';
}

const LEGEND = [['passed', 'Pass'], ['failed', 'Fail'], ['flaky', 'Flaky'], ['skipped', 'Skip'], ['running', 'Đang chạy'], ['interrupted', 'Dừng giữa chừng']];

export async function renderLive(main) {
  const info = await getJson('/api/info');
  let snap = null;
  let selectedKey = null;
  let onlyFailed = false; // gantt chỉ hiện block của test fail
  let fresh = false; // a snapshot arrived since the last draw: the heartbeat flashes
  let stopping = false; // survives the 1 s redraw, so the button stays disabled and the note stays
  let stopNote = '';
  // frame chỉ mang step của test đang chạy: step của test đã xong lấy khi cần (bấm vào / tự chọn test fail)
  const stepCache = new Map(); // key -> steps, null = đang tải
  let alive = true; // fetch step trả về sau khi đã rời trang Live: không vẽ đè lên trang khác
  // tóm tắt AI do server tự tạo khi run có test fail xong (aiextra.mjs): hỏi lại vài giây một lần tới khi có
  let aiSum = { runId: null, md: null, state: null, tries: 0, timer: null };
  // báo cáo của run vừa xong: lấy một lần để có resultId cho các nút như ở Runs
  let rep = { runId: null, results: {} };
  function watchReport() {
    if (!snap || snap.status !== 'finished' || !snap.runId || rep.runId === snap.runId || isExport()) return;
    const runId = snap.runId;
    rep = { runId, results: {} };
    getJson(`/api/runs/${encodeURIComponent(runId)}`)
      .then((data) => {
        if (rep.runId !== runId) return;
        for (const t of failedRows(snap.tests)) {
          const r = matchResultId(t, data.report);
          if (r) rep.results[t.key] = { id: r.id, file: r.file, line: r.line };
        }
        draw();
      })
      .catch(() => setTimeout(() => rep.runId === runId && (rep.runId = null), 5000)); // báo cáo có thể chưa ghi xong: thử lại sau
  }
  // tài nguyên máy / app: hỏi 2 giây một lần khi trang Live đang mở; endpoint không có (404) thì thôi hẳn
  let resHtml = '';
  const pollRes = () => {
    if (document.hidden) return;
    getJson('/api/resources')
      .then((r) => (resHtml = formatResources(r)))
      .catch((e) => {
        resHtml = '';
        if (String(e.message).startsWith('404')) clearInterval(resTick);
      })
      .finally(draw);
  };
  const resTick = isExport() ? null : setInterval(pollRes, 2000);

  function watchSummary() {
    if (!snap || snap.status !== 'finished' || snap.runStatus === 'passed' || !snap.runId || isExport()) return;
    if (aiSum.runId !== snap.runId) {
      clearTimeout(aiSum.timer);
      aiSum = { runId: snap.runId, md: null, state: 'pending', tries: 0, timer: null };
    }
    if (aiSum.tries > 45 && aiSum.state === 'pending') aiSum.state = null; // thôi chờ
    if (aiSum.md || aiSum.timer || aiSum.tries > 45) return;
    const runId = aiSum.runId;
    aiSum.timer = setTimeout(async () => {
      aiSum.timer = null;
      aiSum.tries++;
      const r = await getJson(`/api/ai/summary?runId=${encodeURIComponent(runId)}`).catch(() => null);
      if (!alive || aiSum.runId !== runId) return;
      if (r?.saved?.markdown) aiSum.md = r.saved.markdown;
      aiSum.state = r?.saved ? 'done' : r?.state ?? (aiSum.tries > 3 ? null : 'pending');
      draw();
    }, aiSum.tries ? 4000 : 800);
  }


  function stepsOf(t) {
    if (t.steps) {
      stepCache.delete(t.key); // đang chạy (hoặc chạy lại): step mới nhất đi kèm snapshot
      return t.steps;
    }
    if (!t.stepCount) return [];
    if (!stepCache.has(t.key)) {
      stepCache.set(t.key, null);
      getJson(`/api/live/test?key=${encodeURIComponent(t.key)}`)
        .then((r) => stepCache.set(t.key, r.steps ?? []))
        .catch(() => {
          stepCache.set(t.key, []); // lỗi (vd. 401 sau khi dashboard khởi động lại): không tải lại liên tục,
          setTimeout(() => stepCache.delete(t.key), 10_000); // thử lại sau 10 giây
        })
        .finally(draw);
    }
    return stepCache.get(t.key);
  }

  const gantt = (spanMs) => {
    const ticks = axisTicks(spanMs);
    return { axis: ticks.map((t) => `<span style="left:${t.pct}%">${t.label}</span>`).join(''), grid: ticks.map((t) => `<span style="left:${t.pct}%"></span>`).join('') };
  };
  // mỗi giây khi đang chạy: chỉ co giãn block và trục, không dựng lại cả trang
  function grow() {
    if (snap?.status !== 'running' || document.hidden) return;
    const els = new Map([...main.querySelectorAll('.block')].map((el) => [el.dataset.key, el]));
    for (const b of ganttBlocks(snap)) {
      const el = els.get(b.key);
      if (el) Object.assign(el.style, { left: `${b.left}%`, width: `${b.width}%` });
    }
    const g = gantt(Date.now() - Date.parse(snap.startedAt));
    const part = main.querySelector(':scope > [data-part="gantt"]');
    if (part && part._axis !== g.axis) {
      // mỗi lần ghi là một mutation → enhance() quét cả trang: chỉ ghi khi vạch chia thực sự đổi
      part.querySelector('.gantt-axis').innerHTML = g.axis;
      part.querySelector('.gantt-grid').innerHTML = g.grid;
      part._axis = g.axis;
    }
  }

  function draw() {
    if (!alive) return;
    if (!snap || snap.status === 'idle') {
      main.innerHTML = `<h1>Live</h1>${snap?.disconnected ? LOST_BANNER : ''}<div class="empty-state"><h2>Chưa có run nào đang chạy</h2>
        <p>Chạy <code>npx e2e run</code> hoặc bấm nút dưới — tiến độ sẽ hiện ở đây.</p>
        <p><button type="button" class="primary" data-run-all>${icon('play', { size: 14 })}Chạy toàn bộ suite</button></p>
        ${info.reporter.installed ? '' : '<p class="hint">Cần reporter để xem live: chạy <code>/e2e-dashboard setup</code>.</p>'}</div>`;
      main.querySelector('[data-run-all]')?.addEventListener('click', () => openRunDialog({ tests: [], title: 'Chạy toàn bộ suite' }));
      return;
    }
    if (snap.status !== 'running') snap = { ...snap, tests: snap.tests.map((t) => (t.status === 'running' ? { ...t, status: 'interrupted', steps: t.steps.map((s) => (s.status === 'running' ? { ...s, status: 'interrupted' } : s)) } : t)) };
    const pct = snap.total ? Math.round((snap.done / snap.total) * 100) : 0;
    const eta = snap.status === 'running' && snap.etaMs != null ? ` · còn khoảng ${fmtDuration(snap.etaMs)}` : '';
    const byLane = Array.from({ length: Math.max(snap.lanes, 1) }, () => []);
    for (const b of ganttBlocks(snap)) byLane[b.lane]?.push(b); // one pass, not one filter per lane
    const spanMs = Math.max(0, (snap.finishedAt ? Date.parse(snap.finishedAt) : Date.now()) - Date.parse(snap.startedAt));
    const present = new Set(snap.tests.map((t) => t.status));
    const nFail = snap.tests.filter((t) => isFailed(t.status)).length;
    const legend = `<button type="button" class="small-btn only-failed" data-only-failed aria-pressed="${onlyFailed}"${nFail || onlyFailed ? '' : ' disabled'}>${icon('x', { size: 13 })}Chỉ test fail <strong>${nFail}</strong></button>${LEGEND.filter(([s]) => present.has(s)).map(([s, label]) => `<span><i class="swatch s-${s}"></i>${label}</span>`).join('')}<span class="gantt-note">Mỗi hàng là một làn chạy song song (xếp theo thời gian chồng nhau, không phải số worker thật).</span>`;
    const running = snap.tests.filter((t) => t.status === 'running');
    // mặc định: test đang chạy, xong rồi thì test fail đầu tiên (để thấy lỗi ngay), cuối cùng là test sau cùng
    const firstFail = snap.tests.find((t) => isFailed(t.status));
    const sel = snap.tests.find((t) => t.key === selectedKey) ?? (onlyFailed ? firstFail : null) ?? running.at(-1) ?? firstFail ?? snap.tests.at(-1);
    const steps = sel
      ? `<h2>${escapeHtml(sel.title)} ${statusBadge(sel.status)}${sel.activity ? ` <span class="muted">● ${escapeHtml(sel.activity)}</span>` : ''}</h2>
         ${sel.error ? `<div class="err">${sel.error.code ? `<code>${escapeHtml(sel.error.code)}</code> ` : ''}${escapeHtml(sel.error.message)}</div>` : ''}
         <ol class="timeline">${stepsOf(sel) === null ? '<li class="muted">Đang tải step…</li>' : stepsOf(sel)
           .map((s) => `<li class="step">${statusBadge(s.status)} <code>${escapeHtml(s.api)}</code> ${escapeHtml(s.label ?? '')} <span class="muted">${fmtDuration(s.durationMs)}</span>${s.error ? `<div class="err">${escapeHtml(s.error.message ?? '')}</div>` : ''}</li>`)
           .join('') || '<li class="muted">Chưa có step.</li>'}</ol>`
      : '';
    // mới nhất lên đầu: 50 dòng cuối, đảo thứ tự (mỗi phần tử là một dòng output)
    const out = snap.output.slice(-50).reverse().map((o) => escapeHtml(stripAnsi(o.text))).join('');
    main.style.setProperty('--phase', `-${Math.round(performance.now() % 2400)}ms`); // rebuilt nodes resume their loops (2.4 s = lcm of 0.8 s / 1.2 s)
    const beat = snap.status === 'running' ? '<span class="beat" title="Đang nhận dữ liệu live" aria-hidden="true"></span>' : '';
    const pulse = fresh;
    fresh = false;
    // Trang chia phần: phần nào HTML không đổi thì giữ nguyên DOM (hover, focus, vị trí cuộn, chọn chữ trong log);
    // gantt cập nhật từng block theo key. Trước đây mỗi snapshot (≤ 4 lần/giây) dựng lại cả trang.
    if (!main.querySelector(':scope > [data-part="head"]')) {
      main.innerHTML = '<div data-part="head"></div><section class="panel ai-summary" data-part="ai"></section><section class="panel gantt" data-part="gantt"></section><section class="panel live-failed" data-part="failed"></section><section class="panel fill-me" data-part="steps"></section><section data-part="out"></section>';
    }
    const parts = {
      head: `<h1>Live ${beat}${statusBadge(snap.status === 'finished' ? snap.runStatus ?? 'finished' : snap.status)}</h1>
        ${snap.disconnected ? LOST_BANNER : ''}
        ${snap.status === 'running' && !snap.disconnected ? `<p><button type="button" class="btn-stop" data-stop${stopping ? ' disabled' : ''}>${icon('square', { size: 14 })}Dừng run</button> <span class="muted small" data-stop-note>${escapeHtml(stopNote)}</span></p>` : ''}
        <div class="progress${snap.status === 'running' ? ' running' : ''}"><div class="bar" style="width:${pct}%"></div></div>
        <p class="muted">${escapeHtml(snap.done)}/${escapeHtml(snap.total)} test${eta}${tally(snap.tests, snap.lanes)}</p>
        ${resHtml}
        ${snap.status !== 'running' ? `<p class="row-actions"><a class="button" href="${runsHref(snap.runId)}">${icon('list', { size: 14 })}Xem ở Runs</a> <button type="button" data-run-all>${icon('play', { size: 14 })}Chạy lại toàn bộ suite</button></p>` : ''}
        ${snap.error ? `<div class="err">${escapeHtml(snap.error.message ?? '')}</div>` : ''}
        ${snap.stopped ? `<div class="banner tone-warn">${icon('alert', { size: 14 })}Run dừng sớm: đã chạm <code>--max-failures</code> (${escapeHtml(snap.stopped.failures)}/${escapeHtml(snap.stopped.limit)} test fail), các test còn lại không chạy.</div>` : ''}
        ${(snap.notices ?? []).map((n) => `<div class="banner tone-info">${icon('info', { size: 14 })}${n.target ? `<strong>${escapeHtml(n.target)}</strong>: ` : ''}${escapeHtml(n.message)}</div>`).join('')}
        ${blockersHtml(snap.tests)}`,
      ai: aiSum.runId === snap.runId && aiSum.md
        ? `<h2>${icon('sparkles', { size: 15 })} Tóm tắt AI</h2><div class="md">${renderMarkdown(aiSum.md)}</div>`
        : aiSum.runId === snap.runId && aiSum.state === 'pending' ? `<p class="muted small">${icon('sparkles', { size: 13 })} AI đang tóm tắt run…</p>` : '',
      failed: failedHtml(snap.tests, { runId: snap.runId, finished: snap.status !== 'running', results: rep.runId === snap.runId ? rep.results : {} }),
      steps,
      out: out ? `<h2>Output</h2><pre class="log">${out}</pre>` : '',
    };
    for (const [k, html] of Object.entries(parts)) {
      const el = main.querySelector(`:scope > [data-part="${k}"]`);
      if (el._html === html) continue;
      const scroller = el.querySelector('.timeline, .log');
      const top = scroller?.scrollTop ?? 0;
      el.innerHTML = html;
      el._html = html;
      const again = el.querySelector('.timeline, .log');
      if (again) again.scrollTop = top;
    }
    syncGantt(main.querySelector(':scope > [data-part="gantt"]'), byLane, gantt(spanMs), legend);
    main.querySelector('.beat')?.classList.toggle('idle', !pulse);
    watchSummary();
    watchReport();
  }

  // gantt theo key: block mới thêm vào, block cũ đổi vị trí / trạng thái tại chỗ, block không còn thì bỏ
  function syncGantt(el, byLane, g, legend) {
    if (el._lanes !== byLane.length) {
      const lanes = byLane.map((_, i) => `<div class="lane"><span class="lane-label">W${i + 1}</span><div class="lane-track"></div></div>`).join('');
      el.innerHTML = `<div class="gantt-axis" aria-hidden="true"></div><div class="gantt-lanes"><div class="gantt-grid" aria-hidden="true"></div>${lanes}</div><div class="gantt-legend muted small"></div>`;
      el._lanes = byLane.length;
      el._axis = el._legend = null;
    }
    if (el._axis !== g.axis) {
      el.querySelector('.gantt-axis').innerHTML = g.axis;
      el.querySelector('.gantt-grid').innerHTML = g.grid;
      el._axis = g.axis;
    }
    if (el._legend !== legend) {
      el.querySelector('.gantt-legend').innerHTML = legend;
      el._legend = legend;
    }
    const tracks = el.querySelectorAll('.lane-track');
    const have = new Map([...el.querySelectorAll('.block')].map((x) => [x.dataset.key, x]));
    byLane.forEach((blocks, i) => {
      for (const b of blocks) {
        let x = have.get(b.key);
        have.delete(b.key);
        if (!x) {
          x = document.createElement('button');
          x.type = 'button';
          x.dataset.key = b.key;
        }
        if (x.parentElement !== tracks[i]) tracks[i].append(x);
        const cls = `block s-${b.status}`;
        if (x.className !== cls) x.className = cls;
        x.style.left = `${b.left}%`;
        x.style.width = `${b.width}%`;
        const tip = `W${i + 1} · ${b.title} · ${fmtDuration(b.durationMs)}`;
        if (x.dataset.tip !== tip) x.dataset.tip = tip;
        x.setAttribute('aria-label', `${b.title}: ${b.status}`);
        x.hidden = onlyFailed && !isFailed(b.status);
      }
    });
    for (const x of have.values()) x.remove();
  }

  // one delegated listener for the whole page: draw() rebuilds the DOM on every snapshot
  const onClick = async (e) => {
    if (e.target.closest('[data-run-all]') && snap?.status && snap.status !== 'idle') return openRunDialog({ tests: [], title: 'Chạy toàn bộ suite' });
    if (e.target.closest('[data-only-failed]')) {
      onlyFailed = !onlyFailed;
      draw();
      return;
    }
    // nút của danh sách test fail
    const b = e.target.closest('[data-view-steps], [data-rerun-one], [data-live-ai], [data-live-linear], [data-live-bisect], [data-live-fix]');
    if (b && snap) {
      const runId = snap.runId;
      const d = b.dataset;
      if (d.viewSteps) {
        selectedKey = d.viewSteps; // như bấm block trong gantt
        draw();
        main.querySelector(':scope > [data-part="steps"]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      if (d.rerunOne) {
        const t = snap.tests.find((x) => x.key === d.rerunOne);
        if (!t) return;
        const r = rep.runId === runId ? rep.results[t.key] : null;
        // event live không có số dòng: chưa có báo cáo thì tra danh mục test theo testId; không thấy mới chạy lại cả file
        const line = r?.line ?? (await getJson('/api/tests').then((rows) => rows.find((x) => x.testId === t.testId)?.line, () => null));
        const spec = line ? `${r?.file ?? t.file}:${line}` : t.file;
        return openRunDialog({ tests: [spec], targets: [t.target], agents: [t.agent], rerunOf: runId, title: `Chạy lại ${t.title}` });
      }
      if (d.liveAi) return openAiPanel({ action: d.liveAi, runId, resultId: d.result, title: `${d.liveAi === 'repro-steps' ? 'Bước tái hiện' : 'Phân tích lỗi'} · ${d.title ?? ''}` });
      if (d.liveLinear) return openLinearDialog({ runId, resultId: d.liveLinear });
      if (d.liveBisect) return openBisectDialog({ runId, resultId: d.liveBisect });
      if (d.liveFix) {
        const cmd = `/e2e-dashboard:e2e-dashboard fix ${runId} ${d.liveFix}`;
        const ok = await copyToClipboard(cmd);
        toast(ok ? 'Đã copy lệnh: dán vào Claude Code để Claude sửa và chạy lại test' : cmd, ok ? 'good' : 'info', 6000);
        return;
      }
    }
    const block = e.target.closest('.block');
    if (block) {
      selectedKey = block.dataset.key;
      draw();
      return;
    }
    if (!e.target.closest('[data-stop]') || stopping) return;
    if (!(await confirmDialog({ title: 'Dừng run', message: 'Dừng run đang chạy? Test đang chạy bị ngắt và kết quả run sẽ không đầy đủ.', confirmLabel: 'Dừng run' }))) return;
    stopping = true;
    draw();
    const r = await postJson('/api/run/stop', {}).catch((x) => ({ error: x.message }));
    if (r.error) {
      stopping = false;
      stopNote = r.error.startsWith('401') ? LOST : `Không dừng được: ${r.error}`;
    } else if (!r.stopped) {
      stopping = false;
      stopNote = 'Không còn run nào đang chạy — run đã kết thúc.';
    } else if (r.external) {
      stopNote = 'Run này chạy từ terminal: dashboard đã đánh dấu dừng nhưng process vẫn chạy — nhấn Ctrl-C ở terminal đó.';
    }
    draw();
  };
  main.addEventListener('click', onClick);

  const stop = liveStream((s) => {
    if (s?.startedAt !== snap?.startedAt) {
      stopping = false; // a new run gets a fresh Stop button
      stopNote = '';
      stepCache.clear();
    }
    snap = s;
    fresh = true;
    draw();
  });
  const tick = setInterval(grow, 1000); // grow running blocks
  draw();
  if (resTick) pollRes();
  return () => {
    alive = false;
    clearInterval(resTick);
    clearTimeout(aiSum.timer);
    stop();
    clearInterval(tick);
    main.removeEventListener('click', onClick);
  };
}
