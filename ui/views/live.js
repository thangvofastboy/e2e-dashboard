import { getJson, liveStream, postJson, isExport } from '../api.js';
import { renderMarkdown } from '../markdown.js';
import { isFailed } from '../model.js';
import { openRunDialog } from './run-dialog.js';
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
      main.innerHTML = '<div data-part="head"></div><section class="panel ai-summary" data-part="ai"></section><section class="panel gantt" data-part="gantt"></section><section class="panel fill-me" data-part="steps"></section><section data-part="out"></section>';
    }
    const parts = {
      head: `<h1>Live ${beat}${statusBadge(snap.status === 'finished' ? snap.runStatus ?? 'finished' : snap.status)}</h1>
        ${snap.disconnected ? LOST_BANNER : ''}
        ${snap.status === 'running' && !snap.disconnected ? `<p><button type="button" class="btn-stop" data-stop${stopping ? ' disabled' : ''}>${icon('square', { size: 14 })}Dừng run</button> <span class="muted small" data-stop-note>${escapeHtml(stopNote)}</span></p>` : ''}
        <div class="progress${snap.status === 'running' ? ' running' : ''}"><div class="bar" style="width:${pct}%"></div></div>
        <p class="muted">${escapeHtml(snap.done)}/${escapeHtml(snap.total)} test${eta}${tally(snap.tests, snap.lanes)}</p>
        ${snap.status !== 'running' ? `<p class="row-actions"><a class="button" href="#/runs">${icon('list', { size: 14 })}Xem ở Runs</a> <button type="button" data-run-all>${icon('play', { size: 14 })}Chạy lại toàn bộ suite</button></p>` : ''}
        ${snap.error ? `<div class="err">${escapeHtml(snap.error.message ?? '')}</div>` : ''}
        ${blockersHtml(snap.tests)}`,
      ai: aiSum.runId === snap.runId && aiSum.md
        ? `<h2>${icon('sparkles', { size: 15 })} Tóm tắt AI</h2><div class="md">${renderMarkdown(aiSum.md)}</div>`
        : aiSum.runId === snap.runId && aiSum.state === 'pending' ? `<p class="muted small">${icon('sparkles', { size: 13 })} AI đang tóm tắt run…</p>` : '',
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
    const block = e.target.closest('.block');
    if (block) {
      selectedKey = block.dataset.key;
      draw();
      return;
    }
    if (!e.target.closest('[data-stop]') || stopping) return;
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
  return () => {
    alive = false;
    clearTimeout(aiSum.timer);
    stop();
    clearInterval(tick);
    main.removeEventListener('click', onClick);
  };
}
