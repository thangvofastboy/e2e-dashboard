import { getJson, liveStream, postJson, isExport } from '../api.js';
import { confirmDialog } from '../confirm.js';
import { renderMarkdown } from '../markdown.js';
import { isFailed, flattenResults } from '../model.js';
import { openRunDialog } from './run-dialog.js';
import { openAiPanel, thinkingHtml } from './ai-panel.js';
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

// số liệu đầu trang Live: fail gồm cả timed-out / error; còn lại = chưa bắt đầu (không âm)
export function liveCounts(snap) {
  const tests = snap.tests ?? [];
  const n = (st) => tests.filter((t) => t.status === st).length;
  const total = snap.total ?? 0;
  const done = snap.done ?? 0;
  const running = n('running');
  return { total, done, passed: n('passed'), failed: tests.filter((t) => FAILED.includes(t.status)).length, flaky: n('flaky'), skipped: n('skipped'), running, remaining: Math.max(0, total - done - running), pct: total ? Math.round((done / total) * 100) : 0 };
}

// đồng hồ m:ss / h:mm:ss cho thời gian đã chạy (dễ đọc hơn 42.0s khi nhảy mỗi giây)
export function fmtClock(ms) {
  if (!Number.isFinite(ms)) return '—'; // startedAt thiếu / sai dạng
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

// điền / cập nhật mọi đồng hồ trong root: [data-since] (test đang chạy), [data-elapsed] (cả run, dừng ở data-until nếu có)
export function tickClocks(root, now = Date.now()) {
  for (const el of root.querySelectorAll('[data-elapsed], [data-since]')) {
    const from = Date.parse(el.dataset.elapsed ?? el.dataset.since);
    const to = el.dataset.until ? Date.parse(el.dataset.until) : now;
    const t = Number.isNaN(from) ? '' : fmtClock(to - from);
    // sửa chữ của Text node có sẵn = characterData, MutationObserver (childList) của app.js không quét lại cả trang mỗi giây
    if (el.firstChild?.nodeType === 3) {
      if (el.firstChild.data !== t) el.firstChild.data = t;
    } else if (el.textContent !== t) el.textContent = t;
  }
}

// ô đếm gọn trên một hàng; run xong thì bỏ "Đang chạy", "Còn lại" thành "Không chạy" (chỉ khi > 0)
export function kpiHtml(c, running = true) {
  const tile = (tone, ic, label, value, extra = '') => `<div class="kpi-live kpi-${tone}"><span class="kpi-ic">${icon(ic, { size: 14 })}</span><span class="kpi-num">${value}</span><span class="kpi-lbl">${label}${extra}</span></div>`;
  const more = [c.flaky ? `${c.flaky} flaky` : '', c.skipped ? `${c.skipped} skip` : ''].filter(Boolean).join(' · ');
  return `<div class="kpi-row">${tile('good', 'check', 'Pass', c.passed, more ? ` <span class="muted">· ${more}</span>` : '')}${tile('bad', 'x', 'Fail', c.failed)}${running ? tile(c.running ? 'info' : 'muted', 'loader', 'Đang chạy', c.running) : ''}${running ? tile('muted', 'clock', 'Còn lại', c.remaining) : c.remaining ? tile('muted', 'skip', 'Không chạy', c.remaining) : ''}</div>`;
}

// thanh tiến độ chia đoạn theo kết quả (tính trên tổng số test của run); đoạn 0% không vẽ
export function progressHtml(c, running) {
  const w = (n) => (c.total ? Math.round((n / c.total) * 1000) / 10 : 0);
  const segs = [['passed', c.passed], ['flaky', c.flaky], ['failed', c.failed], ['skipped', c.skipped], ['running', c.running]]
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `<span class="seg-${k}" style="width:${w(n)}%"></span>`).join('');
  return `<div class="live-progress"><div class="progress-segs${running ? ' running' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="${c.total}" aria-valuenow="${c.done}">${segs}</div><span class="progress-lbl">${c.done}/${c.total} · ${c.pct}%</span></div>`;
}

// cột "Đang chạy": theo làn (W1, W2…), đồng hồ đã chạy, việc đang làm. Chữ của đồng hồ không nằm trong HTML
// (tickClocks điền và cập nhật mỗi giây): HTML chỉ đổi khi danh sách / việc đang làm đổi, không bị dựng lại mỗi snapshot
export function runningHtml(tests = []) {
  const rows = tests.filter((t) => t.status === 'running').sort((a, b) => (a.lane ?? 0) - (b.lane ?? 0));
  const items = rows.map((t) => {
    const last = t.steps?.at(-1);
    const doing = t.activity ?? (last ? `${last.api} ${last.label ?? ''}`.trim() : '');
    const since = t.startedAt ? `<span class="run-clock" data-since="${escapeHtml(t.startedAt)}"></span>` : '';
    return `<li><button type="button" class="run-item" data-view-steps="${escapeHtml(t.key)}"><span class="lane-chip">W${(t.lane ?? 0) + 1}</span><span class="run-name"><strong>${escapeHtml(t.title)}</strong>${doing ? `<span class="run-doing">↳ ${escapeHtml(doing)}</span>` : ''}</span>${since}</button></li>`;
  });
  return `<h2>${icon('loader', { size: 15 })} Đang chạy <strong>${rows.length}</strong></h2>${items.length ? `<ul class="running-list">${items.join('')}</ul>` : '<p class="muted small">Không có test nào đang chạy.</p>'}`;
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
// run hỏng hàng loạt (vài trăm test fail): chỉ vẽ FAILED_MAX dòng đầu, phần còn lại xem ở Runs khi run xong
export const FAILED_MAX = 50;
export function failedHtml(tests, { runId = null, finished = false, results = {} } = {}) {
  const rows = failedRows(tests);
  if (!rows.length) return '';
  const items = rows.slice(0, FAILED_MAX).map((t) => {
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
  const more = rows.length > FAILED_MAX ? `<p class="muted small">Còn ${rows.length - FAILED_MAX} test fail nữa: xem đầy đủ ở <a href="${runsHref(runId)}">Runs</a>.</p>` : '';
  return `<h2>Test fail <strong>${rows.length}</strong></h2><ul class="failed-list">${items.join('')}</ul>${more}`;
}

// dải tài nguyên đầu trang Live (GET /api/resources mỗi giây): mỗi chỉ số một thẻ màu riêng, giá trị đổi màu theo ngưỡng,
// sparkline của RES_MAX mẫu gần nhất. hist = các response, cũ → mới; thiếu dữ liệu máy thì trả '' để không hiện gì
export const RES_MAX = 60;
export const pushSample = (hist, s, max = RES_MAX) => [...hist, s].slice(-max);
const SPARK_W = 120;
const SPARK_H = 32;
// giá trị 0..100 → điểm polyline trải hết chiều ngang; một mẫu thì vẽ đoạn ngắn ở mép phải
export function sparkPoints(values) {
  const y = (v) => +(SPARK_H - (Math.min(100, Math.max(0, v)) / 100) * SPARK_H).toFixed(1);
  if (values.length < 2) return values.length ? `${SPARK_W - 2},${y(values[0])} ${SPARK_W},${y(values[0])}` : '';
  return values.map((v, i) => `${+((i * SPARK_W) / (values.length - 1)).toFixed(1)},${y(v)}`).join(' ');
}
const toneOf = (pct) => (pct >= 85 ? 'bad' : pct >= 60 ? 'warn' : 'good');
const spark = (values) => {
  const pts = sparkPoints(values);
  return pts ? `<svg class="spark" viewBox="0 0 ${SPARK_W} ${SPARK_H}" preserveAspectRatio="none" aria-hidden="true"><polygon points="${pts.split(' ')[0].split(',')[0]},${SPARK_H} ${pts} ${SPARK_W},${SPARK_H}"/><polyline points="${pts}"/></svg>` : '';
};
const card = ({ hue, ic, name, value, pct, sub, values, bar }) => `<div class="res-card" style="--hue:var(${hue})" role="group" aria-label="${escapeHtml(name)}: ${escapeHtml(value)}" title="${escapeHtml(name)}: ${escapeHtml(value)}${sub ? ` · ${escapeHtml(sub)}` : ''}">
    <div class="res-top"><span class="res-ic">${icon(ic, { size: 14 })}</span><span class="res-name">${escapeHtml(name)}</span><span class="res-val${pct == null ? '' : ` tone-${toneOf(pct)}`}">${escapeHtml(value)}</span></div>
    ${bar ? `<div class="res-bar" aria-hidden="true"><span style="width:${Math.round(Math.min(100, pct ?? 0))}%"></span></div>` : spark(values ?? [])}
    <div class="res-sub">${escapeHtml(sub ?? '')}</div></div>`;

export function resourcesHtml(hist) {
  const last = hist.at(-1);
  const m = last?.machine;
  if (!m) return '';
  const gb = (mb) => (mb / 1024).toFixed(1);
  const memPct = (x) => (x.machine?.memTotalMb ? ((x.machine.memTotalMb - (x.machine.memFreeMb ?? 0)) / x.machine.memTotalMb) * 100 : 0);
  const cores = m.cores || 1;
  const cards = [];
  if (m.cpuPct != null) cards.push(card({ hue: '--series-1', ic: 'cpu', name: 'CPU máy', value: `${Math.round(m.cpuPct)}%`, pct: m.cpuPct, sub: `${cores} nhân${m.loadavg ? ` · load ${m.loadavg[0]}` : ''}`, values: hist.map((x) => x.machine?.cpuPct ?? 0) }));
  if (m.memTotalMb) cards.push(card({ hue: '--violet', ic: 'layers', name: 'RAM máy', value: `${Math.round(memPct(last))}%`, pct: memPct(last), sub: `${gb(m.memTotalMb - (m.memFreeMb ?? 0))}/${gb(m.memTotalMb)} GB`, values: hist.map(memPct) }));
  // runner có thể dùng nhiều nhân (150% = 1,5 nhân): chia số nhân để ra % của cả máy
  const r = last.app?.runner;
  const runOk = (x) => x.app?.runner && !x.app.runner.unavailable;
  if (r?.unavailable) cards.push(card({ hue: '--orange', ic: 'zap', name: 'Test đang chạy', value: '—', sub: r.unavailable, values: [] }));
  else if (r) {
    cards.push(card({ hue: '--orange', ic: 'zap', name: 'CPU test', value: `${Math.round(r.cpuPct / cores)}%`, pct: r.cpuPct / cores, sub: `${r.procs} tiến trình · ${(r.cpuPct / 100).toFixed(1)} nhân`, values: hist.map((x) => (runOk(x) ? x.app.runner.cpuPct / cores : 0)) }));
    cards.push(card({ hue: '--teal', ic: 'activity', name: 'RAM test', value: `${Math.round(r.rssMb)} MB`, pct: (r.rssMb / m.memTotalMb) * 100, sub: 'trình duyệt + runner', values: hist.map((x) => (runOk(x) && x.machine?.memTotalMb ? (x.app.runner.rssMb / x.machine.memTotalMb) * 100 : 0)) }));
  } else cards.push(card({ hue: '--orange', ic: 'zap', name: 'Test đang chạy', value: 'Chưa chạy', sub: 'CPU / RAM của runner hiện khi có run', values: [] }));
  if (m.diskFreeGb != null) {
    const used = m.diskTotalGb ? ((m.diskTotalGb - m.diskFreeGb) / m.diskTotalGb) * 100 : null;
    cards.push(card({ hue: '--pink', ic: 'folder', name: 'Disk trống', value: `${Math.round(m.diskFreeGb)} GB`, pct: used, sub: m.diskTotalGb ? `${Math.round(used)}% của ${Math.round(m.diskTotalGb)} GB` : '', bar: true }));
  }
  return `<div class="res-strip" aria-label="Tài nguyên đang dùng">${cards.join('')}</div>`;
}

const LEGEND = [['passed', 'Pass'], ['failed', 'Fail'], ['flaky', 'Flaky'], ['skipped', 'Skip'], ['running', 'Đang chạy'], ['interrupted', 'Dừng giữa chừng']];

export async function renderLive(main) {
  const info = await getJson('/api/info');
  let snap = null;
  let selectedKey = null;
  let outOpen = false; // khung Output đang mở (người dùng bấm), giữ qua các lần vẽ
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
      .catch(() => setTimeout(() => {
        if (rep.runId !== runId) return;
        rep.runId = null;
        draw(); // không còn snapshot nào tới thì không ai vẽ lại: tự gọi để thử lấy báo cáo lần nữa
      }, 5000)); // báo cáo có thể chưa ghi xong: thử lại sau
  }
  // tài nguyên máy / app: hỏi mỗi giây khi trang Live đang mở (vẽ sparkline); endpoint không có (404) thì thôi hẳn
  // chỉ ghi vào ô tài nguyên riêng ([data-res]), không vẽ lại cả trang: CPU % đổi mỗi lần hỏi, vẽ lại sẽ mất focus / tooltip của nút
  let resHtml = '';
  let resHist = [];
  const setRes = () => {
    const el = main.querySelector('[data-res]'); // trang trống: con trực tiếp của main; đang có run: trong .live-top
    if (el && el._html !== resHtml) {
      el.innerHTML = resHtml;
      el._html = resHtml;
    }
  };
  const pollRes = () => {
    if (document.hidden) return;
    getJson('/api/resources')
      .then((r) => {
        resHist = pushSample(resHist, r);
        resHtml = resourcesHtml(resHist);
      })
      .catch((e) => {
        resHtml = '';
        if (String(e.message).startsWith('404')) clearInterval(resTick);
      })
      .finally(setRes);
  };
  const resTick = isExport() ? null : setInterval(pollRes, 1000);

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
    tickClocks(main); // đồng hồ của run và của từng test đang chạy: chỉ đổi chữ, không vẽ lại phần nào
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
      // chưa có run vẫn hiện tài nguyên máy; chỉ vẽ lại khi nội dung đổi (poll mỗi giây không làm mất focus nút)
      const idle = `<h1>Live</h1><div data-res></div>${snap?.disconnected ? LOST_BANNER : ''}<div class="empty-state"><h2>Chưa có run nào đang chạy</h2>
        <p>Chạy <code>npx e2e run</code> hoặc bấm nút dưới — tiến độ sẽ hiện ở đây.</p>
        <p><button type="button" class="primary" data-run-all>${icon('play', { size: 14 })}Chạy toàn bộ suite</button></p>
        ${info.reporter.installed ? '' : '<p class="hint">Cần reporter để xem live: chạy <code>/e2e-dashboard setup</code>.</p>'}</div>`;
      if (main.dataset.liveIdle === idle && main.querySelector(':scope > .empty-state')) return; // <main> dùng chung giữa các trang: chỉ bỏ qua khi đang hiện đúng màn này
      main.dataset.liveIdle = idle;
      main.innerHTML = idle;
      setRes();
      main.querySelector('[data-run-all]')?.addEventListener('click', () => openRunDialog({ tests: [], title: 'Chạy toàn bộ suite' }));
      return;
    }
    if (snap.status !== 'running') snap = { ...snap, tests: snap.tests.map((t) => (t.status === 'running' ? { ...t, status: 'interrupted', steps: t.steps.map((s) => (s.status === 'running' ? { ...s, status: 'interrupted' } : s)) } : t)) };
    const counts = liveCounts(snap);
    const isRunning = snap.status === 'running';
    const byLane = Array.from({ length: Math.max(snap.lanes, 1) }, () => []);
    for (const b of ganttBlocks(snap)) byLane[b.lane]?.push(b); // one pass, not one filter per lane
    const spanMs = Math.max(0, (snap.finishedAt ? Date.parse(snap.finishedAt) : Date.now()) - Date.parse(snap.startedAt));
    const present = new Set(snap.tests.map((t) => t.status));
    const nFail = failedRows(snap.tests).length; // cùng định nghĩa với ô Fail và danh sách test fail
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
      main.innerHTML = '<div class="live-top"><div data-part="title"></div><div data-part="res" data-res></div><div data-part="actions"></div></div><div data-part="head"></div><section class="panel ai-summary" data-part="ai"></section><div class="live-cols"><section class="panel live-running" data-part="running"></section><section class="panel live-failed" data-part="failed"></section></div><section class="panel gantt" data-part="gantt"></section><section class="panel live-steps" data-part="steps"></section><details class="panel live-out" data-part="out"></details>';
    }
    const parts = {
      // thanh trạng thái: tiêu đề + đồng hồ + ETA + nút Dừng trên một hàng; .page-head p để app.js không chèn mô tả trang
      // (mô tả vẫn mở được ở nút ⓘ cạnh tiêu đề). Dải tài nguyên ([data-res]) gọn, cùng hàng (.live-top)
      title: `<div class="page-head run-bar"><h1>Live ${beat}${statusBadge(snap.status === 'finished' ? snap.runStatus ?? 'finished' : snap.status)}</h1>
        <p class="run-meta">${icon('timer', { size: 15 })}<span data-elapsed="${escapeHtml(snap.startedAt)}"${snap.finishedAt ? ` data-until="${escapeHtml(snap.finishedAt)}"` : ''}></span>${isRunning && snap.etaMs != null ? `<span class="muted">· còn khoảng ${escapeHtml(fmtDuration(snap.etaMs))}</span>` : ''}${snap.lanes ? `<span class="muted">· tối đa ${escapeHtml(snap.lanes)} worker</span>` : ''}</p>
        </div>`,
      // nút Dừng / Xem ở Runs tách khỏi title để dải tài nguyên nằm giữa (sau "tối đa x worker")
      actions: `${isRunning && !snap.disconnected ? `<p class="run-stop"><span class="muted small" data-stop-note>${escapeHtml(stopNote)}</span><button type="button" class="btn-stop" data-stop${stopping ? ' disabled' : ''}>${icon('square', { size: 14 })}Dừng run</button></p>` : ''}
        ${!isRunning ? `<p class="run-stop"><a class="button" href="${runsHref(snap.runId)}">${icon('list', { size: 14 })}Xem ở Runs</a><button type="button" data-run-all>${icon('play', { size: 14 })}Chạy lại toàn bộ suite</button></p>` : ''}`,
      head: `${snap.disconnected ? LOST_BANNER : ''}
        ${kpiHtml(counts, isRunning)}
        ${progressHtml(counts, isRunning)}
        ${snap.error ? `<div class="err">${escapeHtml(snap.error.message ?? '')}</div>` : ''}
        ${snap.stopped ? `<div class="banner tone-warn">${icon('alert', { size: 14 })}Run dừng sớm: đã chạm <code>--max-failures</code> (${escapeHtml(snap.stopped.failures)}/${escapeHtml(snap.stopped.limit)} test fail), các test còn lại không chạy.</div>` : ''}
        ${(snap.notices ?? []).map((n) => `<div class="banner tone-info">${icon('info', { size: 14 })}${n.target ? `<strong>${escapeHtml(n.target)}</strong>: ` : ''}${escapeHtml(n.message)}</div>`).join('')}
        ${blockersHtml(snap.tests)}`,
      ai: aiSum.runId === snap.runId && aiSum.md
        ? `<h2>${icon('sparkles', { size: 15 })} Tóm tắt AI</h2><div class="md">${renderMarkdown(aiSum.md)}</div>`
        : aiSum.runId === snap.runId && aiSum.state === 'pending' ? `<p class="small">${thinkingHtml('AI đang tóm tắt run')}</p>` : '',
      res: resHtml,
      running: isRunning ? runningHtml(snap.tests) : '', // run xong: bỏ cột, cột fail rộng hết hàng
      failed: failedHtml(snap.tests, { runId: snap.runId, finished: !isRunning, results: rep.runId === snap.runId ? rep.results : {} }) || `<h2>${icon('x', { size: 15 })} Test fail <strong>0</strong></h2><p class="muted small tone-good">${icon('check', { size: 13 })} Chưa có test nào fail.</p>`,
      steps,
      // thu gọn mặc định; trạng thái mở/đóng giữ qua các lần vẽ (outOpen, sự kiện toggle)
      out: out ? `<summary>${icon('terminal', { size: 14 })} Output <span class="muted small">${snap.output.length} dòng · mới nhất ở trên</span></summary><pre class="log">${out}</pre>` : '',
    };
    for (const [k, html] of Object.entries(parts)) {
      const el = main.querySelector(`[data-part="${k}"]`); // running / failed nằm trong .live-cols
      if (el._html === html) continue;
      const scroller = el.querySelector('.timeline, .log');
      const top = scroller?.scrollTop ?? 0;
      el.innerHTML = html;
      el._html = html;
      const again = el.querySelector('.timeline, .log');
      if (again) again.scrollTop = top;
    }
    tickClocks(main); // phần vừa vẽ lại có đồng hồ rỗng: điền ngay, không chờ nhịp grow()
    const outEl = main.querySelector('[data-part="out"]');
    outEl.open = outOpen;
    outEl.hidden = !out;
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
  const onToggle = (e) => {
    if (e.target.matches?.('[data-part="out"]')) outOpen = e.target.open;
  };
  main.addEventListener('toggle', onToggle, true); // toggle không nổi bọt: bắt ở pha capture

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
    main.removeEventListener('toggle', onToggle, true);
  };
}
