import { postStream, isExport } from '../api.js';
import { escapeHtml } from '../format.js';
import { renderMarkdown } from '../markdown.js';
import { icon } from '../icons.js';

let aiAbort = null;

// Right-hand drawer that streams an AI analysis (spec §6). In the export it only shows saved results.
export function openAiPanel({ action, runId, resultId = null, title, saved = null, extra = {} }) {
  aiAbort?.abort();
  document.getElementById('ai-panel')?.remove();
  const panel = document.createElement('aside');
  panel.id = 'ai-panel';
  panel.setAttribute('aria-label', 'Phân tích AI');
  panel.innerHTML = `<header><h2>${icon('sparkles', { size: 16 })}${escapeHtml(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Đóng">${icon('close')}</button></header>
    <div class="ai-status muted" aria-live="polite"></div>
    <div class="ai-body md"></div>
    <p class="err" hidden></p>
    <footer class="ai-actions"></footer>`;
  document.body.append(panel);
  const status = panel.querySelector('.ai-status');
  const body = panel.querySelector('.ai-body');
  const err = panel.querySelector('.err');
  const actions = panel.querySelector('.ai-actions');
  panel.querySelector('[data-close]').addEventListener('click', () => {
    aiAbort?.abort();
    panel.remove();
  });

  if (isExport()) {
    body.innerHTML = saved ? renderMarkdown(saved.markdown) : '<p class="muted">Chưa có phân tích nào được lưu cho mục này.</p>';
    if (saved?.createdAt) status.textContent = `Đã lưu lúc ${new Date(saved.createdAt).toLocaleString('vi-VN')}`;
    return;
  }

  let sessionId = null;
  const run = async (path, payload, append = '') => {
    aiAbort = new AbortController();
    let text = '';
    err.hidden = true;
    actions.innerHTML = '';
    status.innerHTML = `${icon('loader', { size: 14 })} Đang phân tích…`;
    try {
      await postStream(path, payload, (e) => {
        if (e.type === 'session') sessionId = e.sessionId;
        if (e.type === 'tool') status.innerHTML = `${icon('eye', { size: 14 })} ${escapeHtml(e.name)} ${escapeHtml(e.detail)}`;
        if (e.type === 'text') {
          text += `${e.text}\n`;
          body.innerHTML = append + renderMarkdown(text);
        }
        if (e.type === 'cached') {
          body.innerHTML = renderMarkdown(e.markdown);
          status.textContent = `Kết quả đã lưu lúc ${new Date(e.createdAt).toLocaleString('vi-VN')}`;
        }
        if (e.type === 'done') {
          if (e.sessionId) sessionId = e.sessionId;
          if (e.result && !e.isError) body.innerHTML = append + renderMarkdown(e.result);
          if (!e.cached) status.textContent = 'Xong.';
        }
        if (e.type === 'error') {
          err.hidden = false;
          err.textContent = e.message;
        }
      }, aiAbort.signal);
    } catch (x) {
      if (x.name !== 'AbortError') {
        err.hidden = false;
        err.textContent = x.message;
      }
    }
    actions.innerHTML = `${action !== 'followup' ? `<button type="button" data-refresh>${icon('recycle', { size: 14 })}Phân tích lại</button>` : ''}
      ${sessionId ? `<form class="followup"><input name="q" placeholder="Hỏi thêm về kết quả này…" aria-label="Câu hỏi thêm" maxlength="4000" required><button type="submit" aria-label="Gửi">${icon('send', { size: 14 })}</button></form>` : ''}`;
    actions.querySelector('[data-refresh]')?.addEventListener('click', () => run(`/api/ai/${action}`, { ...extra, runId, resultId, refresh: true }));
    actions.querySelector('.followup')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = new FormData(e.target).get('q');
      run('/api/ai/followup', { runId, sessionId, question: q }, `${body.innerHTML}<hr><p><strong>${escapeHtml(q)}</strong></p>`);
    });
  };
  run(`/api/ai/${action}`, { ...extra, runId, resultId });
}
