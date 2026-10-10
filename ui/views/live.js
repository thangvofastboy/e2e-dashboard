import { getJson, liveStream, postJson } from '../api.js';
import { openRunDialog } from './run-dialog.js';
import { icon } from '../icons.js';
import { fmtDuration, statusBadge, escapeHtml } from '../format.js';

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

  function draw() {
    if (!snap || snap.status === 'idle') {
      main.innerHTML = `<h1>Live</h1><div class="empty-state"><h2>Chưa có run nào đang chạy</h2>
        <p>Chạy <code>npx e2e run</code> hoặc bấm nút dưới — tiến độ sẽ hiện ở đây.</p>
        <p><button type="button" class="primary" data-run-all>${icon('play', { size: 14 })}Chạy toàn bộ suite</button></p>
        ${info.reporter.installed ? '' : '<p class="hint">Cần reporter để xem live: chạy <code>/e2e-dashboard setup</code>.</p>'}</div>`;
      main.querySelector('[data-run-all]')?.addEventListener('click', () => openRunDialog({ tests: [], title: 'Chạy toàn bộ suite' }));
      return;
    }
    const pct = snap.total ? Math.round((snap.done / snap.total) * 100) : 0;
    const eta = snap.status === 'running' && snap.etaMs != null ? ` · còn khoảng ${fmtDuration(snap.etaMs)}` : '';
    const blocks = ganttBlocks(snap);
    const lanes = Array.from({ length: Math.max(snap.lanes, 1) }, (_, i) =>
      `<div class="lane"><span class="lane-label">làn ${i + 1}</span><div class="lane-track">${blocks
        .filter((b) => b.lane === i)
        .map((b) => `<button class="block s-${escapeHtml(b.status)}" data-key="${escapeHtml(b.key)}" style="left:${b.left}%;width:${b.width}%" data-tip="${escapeHtml(`${b.title} · ${fmtDuration(b.durationMs)}`)}" aria-label="${escapeHtml(b.title)}"></button>`)
        .join('')}</div></div>`).join('');
    const running = snap.tests.filter((t) => t.status === 'running');
    const sel = snap.tests.find((t) => t.key === selectedKey) ?? running.at(-1) ?? snap.tests.at(-1);
    const steps = sel
      ? `<h2>${escapeHtml(sel.title)} ${statusBadge(sel.status)}${sel.activity ? ` <span class="muted">● ${escapeHtml(sel.activity)}</span>` : ''}</h2>
         <ol class="timeline">${sel.steps
           .map((s) => `<li class="step">${statusBadge(s.status)} <code>${escapeHtml(s.api)}</code> ${escapeHtml(s.label ?? '')} <span class="muted">${fmtDuration(s.durationMs)}</span>${s.error ? `<div class="err">${escapeHtml(s.error.message ?? '')}</div>` : ''}</li>`)
           .join('') || '<li class="muted">Chưa có step.</li>'}</ol>`
      : '';
    const out = snap.output.slice(-50).map((o) => escapeHtml(o.text)).join('');
    main.innerHTML = `<h1>Live ${statusBadge(snap.status === 'finished' ? snap.runStatus ?? 'finished' : snap.status)}</h1>
      ${snap.status === 'running' ? `<p><button type="button" class="btn-stop" data-stop>${icon('square', { size: 14 })}Dừng run</button> <span class="muted small" data-stop-note></span></p>` : ''}
      <div class="progress"><div class="bar" style="width:${pct}%"></div></div>
      <p class="muted">${escapeHtml(snap.done)}/${escapeHtml(snap.total)} test${eta}${snap.status === 'finished' ? ' · đã xong — xem ở Runs' : ''}</p>
      ${snap.error ? `<div class="err">${escapeHtml(snap.error.message ?? '')}</div>` : ''}
      <section class="panel gantt">${lanes}<p class="muted small">Làn được xếp theo thời gian chạy chồng nhau, không phải số worker thật.</p></section>
      <section class="panel">${steps}</section>
      ${out ? `<section><h2>Output</h2><pre class="log">${out}</pre></section>` : ''}`;
    main.querySelector('[data-stop]')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      const { stopped } = await postJson('/api/run/stop', {}).catch(() => ({ stopped: false }));
      if (!stopped) main.querySelector('[data-stop-note]').textContent = 'Run này không do dashboard khởi động — dừng nó ở terminal (Ctrl-C).';
    });
    main.querySelectorAll('.block').forEach((b) =>
      b.addEventListener('click', () => {
        selectedKey = b.dataset.key;
        draw();
      }));
  }

  const stop = liveStream((s) => {
    snap = s;
    draw();
  });
  const tick = setInterval(() => snap?.status === 'running' && draw(), 1000); // grow running blocks
  draw();
  return () => {
    stop();
    clearInterval(tick);
  };
}
