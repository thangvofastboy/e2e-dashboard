import { getJson, liveStream, postJson } from '../api.js';
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

export async function renderLive(main) {
  const info = await getJson('/api/info');
  let snap = null;
  let selectedKey = null;
  let fresh = false; // a snapshot arrived since the last draw: the heartbeat flashes
  let stopping = false; // survives the 1 s redraw, so the button stays disabled and the note stays
  let stopNote = '';

  function draw() {
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
    // Làn theo trục ngang (mỗi làn một cột), thời gian chạy từ trên xuống: chiều cao cố định dù có bao nhiêu làn.
    const lanes = byLane.map((blocks, i) =>
      `<div class="lane"><div class="lane-track">${blocks
        .map((b) => `<button class="block s-${escapeHtml(b.status)}" data-key="${escapeHtml(b.key)}" style="top:${b.left}%;height:${b.width}%" data-tip="${escapeHtml(`làn ${i + 1} · ${b.title} · ${fmtDuration(b.durationMs)}`)}" aria-label="${escapeHtml(b.title)}"></button>`)
        .join('')}</div><span class="lane-label">${i + 1}</span></div>`).join('');
    const running = snap.tests.filter((t) => t.status === 'running');
    // mặc định: test đang chạy, xong rồi thì test fail đầu tiên (để thấy lỗi ngay), cuối cùng là test sau cùng
    const sel = snap.tests.find((t) => t.key === selectedKey) ?? running.at(-1) ?? snap.tests.find((t) => t.status === 'failed') ?? snap.tests.at(-1);
    const steps = sel
      ? `<h2>${escapeHtml(sel.title)} ${statusBadge(sel.status)}${sel.activity ? ` <span class="muted">● ${escapeHtml(sel.activity)}</span>` : ''}</h2>
         ${sel.error ? `<div class="err">${sel.error.code ? `<code>${escapeHtml(sel.error.code)}</code> ` : ''}${escapeHtml(sel.error.message)}</div>` : ''}
         <ol class="timeline">${sel.steps
           .map((s) => `<li class="step">${statusBadge(s.status)} <code>${escapeHtml(s.api)}</code> ${escapeHtml(s.label ?? '')} <span class="muted">${fmtDuration(s.durationMs)}</span>${s.error ? `<div class="err">${escapeHtml(s.error.message ?? '')}</div>` : ''}</li>`)
           .join('') || '<li class="muted">Chưa có step.</li>'}</ol>`
      : '';
    // mới nhất lên đầu: 50 dòng cuối, đảo thứ tự (mỗi phần tử là một dòng output)
    const out = snap.output.slice(-50).reverse().map((o) => escapeHtml(stripAnsi(o.text))).join('');
    main.style.setProperty('--phase', `-${Math.round(performance.now() % 2400)}ms`); // rebuilt nodes resume their loops (2.4 s = lcm of 0.8 s / 1.2 s)
    const beat = snap.status === 'running' ? `<span class="beat${fresh ? '' : ' idle'}" title="Đang nhận dữ liệu live" aria-hidden="true"></span>` : '';
    fresh = false;
    main.innerHTML = `<h1>Live ${beat}${statusBadge(snap.status === 'finished' ? snap.runStatus ?? 'finished' : snap.status)}</h1>
      ${snap.disconnected ? LOST_BANNER : ''}
      ${snap.status === 'running' && !snap.disconnected ? `<p><button type="button" class="btn-stop" data-stop${stopping ? ' disabled' : ''}>${icon('square', { size: 14 })}Dừng run</button> <span class="muted small" data-stop-note>${escapeHtml(stopNote)}</span></p>` : ''}
      <div class="progress${snap.status === 'running' ? ' running' : ''}"><div class="bar" style="width:${pct}%"></div></div>
      <p class="muted">${escapeHtml(snap.done)}/${escapeHtml(snap.total)} test${eta}${tally(snap.tests, snap.lanes)}</p>
      ${snap.status !== 'running' ? `<p class="row-actions"><a class="button" href="#/runs">${icon('list', { size: 14 })}Xem ở Runs</a> <button type="button" data-run-all>${icon('play', { size: 14 })}Chạy lại toàn bộ suite</button></p>` : ''}
      ${snap.error ? `<div class="err">${escapeHtml(snap.error.message ?? '')}</div>` : ''}
      <section class="panel gantt"><div class="gantt-body"><div class="gantt-axis" aria-hidden="true"><span>0s</span><span>${fmtDuration(spanMs)}</span></div><div class="gantt-lanes">${lanes}</div></div>
        <p class="muted small">Mỗi cột là một làn, thời gian chạy từ trên xuống. Làn được xếp theo thời gian chạy chồng nhau, không phải số worker thật.</p></section>
      <section class="panel">${steps}</section>
      ${out ? `<section><h2>Output</h2><pre class="log">${out}</pre></section>` : ''}`;
  }

  // one delegated listener for the whole page: draw() rebuilds the DOM every second
  const onClick = async (e) => {
    if (e.target.closest('[data-run-all]') && snap?.status && snap.status !== 'idle') return openRunDialog({ tests: [], title: 'Chạy toàn bộ suite' });
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
    }
    snap = s;
    fresh = true;
    draw();
  });
  const tick = setInterval(() => snap?.status === 'running' && draw(), 1000); // grow running blocks
  draw();
  return () => {
    stop();
    clearInterval(tick);
    main.removeEventListener('click', onClick);
  };
}
