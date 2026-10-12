import { getJson } from '../api.js';
import { escapeHtml, fmtDuration, fmtTokens } from '../format.js';

// The model calls e2e made for one test (`e2e run --ai-trace`): previews first, the full prompt / response on open.
const msgText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (p?.type === 'text' ? p.text : p?.type ? `[${p.type}]` : String(p ?? ''))).join('\n') : JSON.stringify(c ?? ''));

function callHtml(c) {
  const tok = `${fmtTokens(c.input)} → ${fmtTokens(c.output)} tok`;
  return `<details class="ai-call${c.error ? ' failed' : ''}" data-call="${escapeHtml(c.id)}">
    <summary><span class="mono">#${c.n + 1}</span> <span class="tag">${escapeHtml(c.model ?? '?')}</span> <span class="muted">${tok} · ${c.durationMs == null ? '—' : fmtDuration(c.durationMs)}${c.finishReason ? ` · ${escapeHtml(c.finishReason)}` : ''}</span>${c.error ? ` <span class="tag err-class">lỗi</span>` : ''}
      <div class="small muted">${escapeHtml(c.error ?? (c.response || c.prompt))}</div></summary>
    <div class="ai-call-body muted small">Đang tải…</div></details>`;
}

function detailHtml(d) {
  const msgs = (d.input?.prompt ?? []).map((m) => `<section><h4>${escapeHtml(m.role ?? '?')}</h4><pre>${escapeHtml(msgText(m.content))}</pre></section>`).join('');
  const tools = (d.input?.tools ?? []).map((t) => escapeHtml(t.name ?? '?')).join(', ');
  const out = d.output ? `<section><h4>response</h4><pre>${escapeHtml(msgText(d.output.content ?? d.output))}</pre></section>` : '';
  return `${tools ? `<p class="small muted">Tools: ${tools}</p>` : ''}${msgs}${out}${d.error ? `<section><h4>error</h4><pre>${escapeHtml(d.error)}</pre></section>` : ''}`;
}

export async function renderAiTrace(el, runId, testId) {
  let data;
  try {
    data = await getJson(`/api/runs/${encodeURIComponent(runId)}/ai-trace?testId=${encodeURIComponent(testId)}`);
  } catch {
    el.innerHTML = '<p class="muted">Run này không có ai-trace. Chạy với <code>--ai-trace</code> (hộp thoại Run → Nâng cao).</p>';
    return;
  }
  if (!data.runs.length) {
    el.innerHTML = '<p class="muted">Test này không gọi model.</p>';
    return;
  }
  const t = data.totals;
  el.innerHTML = `<p class="small muted">${t.calls} lần gọi model · ${fmtTokens(t.input)} → ${fmtTokens(t.output)} tok${t.cached ? ` (${fmtTokens(t.cached)} cache)` : ''} · ${fmtDuration(t.durationMs)}${t.errors ? ` · ${t.errors} lỗi` : ''}</p>
    ${data.runs.map((r) => `<div class="ai-run"><h3>${escapeHtml(r.name ?? r.scope?.api ?? 'run')}${Number.isInteger(r.scope?.attempt) && r.scope.attempt > 0 ? ` <span class="tag">attempt ${escapeHtml(String(r.scope.attempt + 1))}</span>` : ''}</h3>${r.calls.map(callHtml).join('')}</div>`).join('')}`;
  el.querySelectorAll('details[data-call]').forEach((d) =>
    d.addEventListener('toggle', async () => {
      if (!d.open || d.dataset.loaded) return;
      d.dataset.loaded = '1';
      const body = d.querySelector('.ai-call-body');
      try {
        body.innerHTML = detailHtml(await getJson(`/api/runs/${encodeURIComponent(runId)}/ai-trace/${encodeURIComponent(d.dataset.call)}`));
      } catch (e) {
        body.textContent = `Không tải được: ${e.message}`;
      }
    }));
}
