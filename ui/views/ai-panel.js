import { postStream, isExport } from '../api.js';
import { escapeHtml } from '../format.js';
import { renderMarkdown } from '../markdown.js';
import { icon } from '../icons.js';

let aiAbort = null;

// Right-hand drawer that streams an AI analysis (spec §6). In the export it only shows saved results.
// onDone(text, footer): sau khi AI trả lời xong, view gắn thêm nút (lưu file test, chạy test đã chọn…)
export function openAiPanel({ action, runId, resultId = null, title, saved = null, extra = {}, onDone = null }) {
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
    let finalText = '';
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
          if (e.result && !e.isError) finalText = e.result;
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
    actions.innerHTML = `${action !== 'followup' && action !== 'ask' ? `<button type="button" data-refresh>${icon('recycle', { size: 14 })}Phân tích lại</button>` : ''}
      ${sessionId ? `<form class="followup"><input name="q" placeholder="Hỏi thêm về kết quả này…" aria-label="Câu hỏi thêm" maxlength="4000" required><button type="submit" aria-label="Gửi">${icon('send', { size: 14 })}</button></form>` : ''}`;
    actions.querySelector('[data-refresh]')?.addEventListener('click', () => run(`/api/ai/${action}`, { ...extra, runId, resultId, refresh: true }));
    actions.querySelector('.followup')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = new FormData(e.target).get('q');
      run('/api/ai/followup', { runId, sessionId, question: q }, `${body.innerHTML}<hr><p><strong>${escapeHtml(q)}</strong></p>`);
    });
    if (onDone && (finalText || text)) {
      const extraBox = document.createElement('div');
      extraBox.className = 'ai-extra';
      actions.prepend(extraBox);
      onDone(finalText || text, extraBox);
    }
  };
  run(`/api/ai/${action}`, { ...extra, runId, resultId });
}

// Câu đầu mở session mới (/ask kèm tóm tắt suite), các câu sau resume đúng session đó.
export function chatRequest(sessionId, question) {
  return sessionId
    ? { path: '/api/ai/followup', payload: { runId: null, sessionId, question } }
    : { path: '/api/ai/ask', payload: { runId: null, question } };
}

// Hội thoại sống theo trang: đóng rồi mở lại panel vẫn thấy lịch sử.
let chat = { sessionId: null, msgs: [] };
const IDEAS = ['Tuần này test nào tệ đi và vì sao?', 'Test nào nên chuyển agent.act thành locator trước?', 'Lỗi nào ảnh hưởng nhiều test nhất, nên sửa gì trước?'];

function msgHtml(m) {
  if (m.role === 'user') return `<div class="msg user"><div class="bubble md">${escapeHtml(m.text)}</div></div>`;
  return `<div class="msg ai"><div class="bubble md">${m.text ? renderMarkdown(m.text) : ''}${m.error ? `<p class="err">${escapeHtml(m.error)}</p>` : ''}</div></div>`;
}

// Khung chat tự do về cả bộ test: lịch sử tin nhắn, ô nhập luôn ở dưới, Enter gửi, đang trả lời thì bấm để dừng.
export function openAskPanel() {
  aiAbort?.abort();
  document.getElementById('ai-panel')?.remove();
  const panel = document.createElement('aside');
  panel.id = 'ai-panel';
  panel.className = 'ai-chat';
  panel.setAttribute('aria-label', 'Hỏi AI');
  panel.innerHTML = `<header><h2>${icon('sparkles', { size: 16 })}Hỏi AI về bộ test</h2><span class="chat-head-btns"><button type="button" class="icon-btn" data-new title="Cuộc trò chuyện mới" aria-label="Cuộc trò chuyện mới">${icon('plus')}</button><button type="button" class="icon-btn" data-close aria-label="Đóng">${icon('close')}</button></span></header>
    <div class="chat-log" aria-live="polite"></div>
    <form class="chat-input"><textarea name="q" rows="1" placeholder="Nhắn cho AI… (Enter gửi, Shift+Enter xuống dòng)" aria-label="Câu hỏi" maxlength="4000"></textarea><button type="submit" aria-label="Gửi">${icon('send', { size: 14 })}</button></form>`;
  document.body.append(panel);
  const log = panel.querySelector('.chat-log');
  const form = panel.querySelector('form');
  const input = form.querySelector('textarea');
  const btn = form.querySelector('button');
  let busy = false;

  const render = () => {
    log.innerHTML = chat.msgs.length
      ? chat.msgs.map(msgHtml).join('')
      : `<p class="muted small">Claude nhận tóm tắt 30 run gần nhất (pass/fail, flaky, nhóm lỗi, lỗi app, chi phí) và có thể đọc code (chỉ đọc).</p>
        <ul class="ask-ideas">${IDEAS.map((q) => `<li><button type="button" data-idea>${escapeHtml(q)}</button></li>`).join('')}</ul>`;
    log.querySelectorAll('[data-idea]').forEach((b) => b.addEventListener('click', () => send(b.textContent)));
    log.scrollTop = log.scrollHeight;
  };
  const setBusy = (on) => {
    busy = on;
    btn.innerHTML = icon(on ? 'stop' : 'send', { size: 14 });
    btn.setAttribute('aria-label', on ? 'Dừng' : 'Gửi');
  };

  const send = async (raw) => {
    const q = String(raw).trim();
    if (!q || busy) return;
    input.value = '';
    const ai = { role: 'ai', text: '' };
    chat.msgs.push({ role: 'user', text: q }, ai);
    render();
    const bubble = log.lastElementChild.querySelector('.bubble');
    const paint = (status) => {
      bubble.innerHTML = `${ai.text ? renderMarkdown(ai.text) : ''}<p class="chat-status muted small">${status}</p>`;
      log.scrollTop = log.scrollHeight;
    };
    const thinking = `${icon('loader', { size: 14 })} Đang suy nghĩ…`;
    paint(thinking);
    setBusy(true);
    const { path, payload } = chatRequest(chat.sessionId, q);
    const mine = chat;
    aiAbort = new AbortController();
    let streamed = '';
    try {
      await postStream(path, payload, (e) => {
        if (e.type === 'session') mine.sessionId = e.sessionId;
        if (e.type === 'tool') paint(`${icon('eye', { size: 14 })} ${escapeHtml(e.name)} ${escapeHtml(e.detail)}`);
        if (e.type === 'text') {
          streamed += `${e.text}\n`;
          ai.text = streamed;
          paint(thinking);
        }
        if (e.type === 'done') {
          if (e.sessionId) mine.sessionId = e.sessionId;
          if (e.result && !e.isError) ai.text = e.result;
        }
        if (e.type === 'error') ai.error = e.message;
      }, aiAbort.signal);
    } catch (x) {
      if (x.name !== 'AbortError') ai.error = x.message;
      else if (!ai.text) ai.text = '_Đã dừng._';
    }
    if (!ai.text && !ai.error) ai.text = '_(Không có câu trả lời)_';
    setBusy(false);
    if (mine !== chat || !panel.isConnected) return; // đã bấm "Cuộc trò chuyện mới" hoặc đóng panel
    bubble.parentElement.outerHTML = msgHtml(ai);
    log.scrollTop = log.scrollHeight;
    input.focus();
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) aiAbort?.abort();
    else send(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  panel.querySelector('[data-new]').addEventListener('click', () => {
    aiAbort?.abort();
    chat = { sessionId: null, msgs: [] };
    render();
    input.focus();
  });
  panel.querySelector('[data-close]').addEventListener('click', () => {
    aiAbort?.abort();
    panel.remove();
  });
  render();
  input.focus();
}
