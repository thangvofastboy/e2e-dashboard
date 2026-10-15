import { postStream, postJson, getJson, isExport } from '../api.js';
import { escapeHtml } from '../format.js';
import { renderMarkdown } from '../markdown.js';
import { icon } from '../icons.js';

let aiAbort = null;

// một lượt hỏi–đáp → bản ghi gửi lên /api/ai/chats (server/aichats.mjs). Không có session (lỗi trước khi claude chạy,
// kết quả cache) hoặc không có gì để lưu thì trả null. chatId cố định theo session đầu tiên; sessionId là session mới nhất
export function chatEntry({ chatId, sessionId, title, source = null, question, answer = '', error = '' }) {
  if (!sessionId || !question || (!answer && !error)) return null;
  const ai = { role: 'ai', text: answer };
  if (error) ai.error = error;
  return { id: chatId ?? sessionId, sessionId, title, ...(source ? { source } : {}), msgs: [{ role: 'user', text: question }, ai] };
}
// lưu chat trên máy: lỗi mạng / server cũ không được làm hỏng khung AI
// trả promise để khung chat nạp lại danh sách sau khi đã ghi xong
const saveChat = (entry) => (entry && !isExport() ? postJson('/api/ai/chats', entry).catch(() => {}) : Promise.resolve());

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
  let chatId = null; // phân tích + các câu hỏi thêm = một chat trong lịch sử Hỏi AI
  const run = async (path, payload, append = '') => {
    aiAbort = new AbortController();
    let text = '';
    let finalText = '';
    let failure = '';
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
          failure = e.message;
        }
      }, aiAbort.signal);
    } catch (x) {
      if (x.name !== 'AbortError') {
        err.hidden = false;
        err.textContent = x.message;
        failure = x.message;
      } else failure = 'Đã dừng giữa chừng'; // đóng panel / mở phân tích khác: lịch sử ghi rõ câu trả lời bị cắt
    }
    const entry = chatEntry({ chatId, sessionId, title, source: { action, runId, resultId }, question: payload.question ?? title, answer: finalText || text, error: failure });
    chatId ??= entry?.id ?? null;
    saveChat(entry);
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

// Hội thoại đang mở: đóng rồi mở lại panel vẫn thấy; các chat cũ (gồm cả phân tích AI) lấy từ /api/ai/chats.
// id = chat trong lịch sử (session đầu tiên), sessionId = session để hỏi tiếp
const NEW_CHAT = () => ({ id: null, title: null, sessionId: null, msgs: [] });
let chat = NEW_CHAT();
const ACTION_LABEL = { ask: 'Hỏi AI', 'analyze-failure': 'Phân tích lỗi', 'analyze-run': 'Phân tích run', 'suggest-locator': 'Gợi ý locator', 'why-flaky': 'Vì sao flaky', 'repro-steps': 'Bước tái hiện', 'run-summary': 'Tóm tắt run' };
const shortTitle = (q) => (q.length > 60 ? `${q.slice(0, 59)}…` : q);

// danh sách chat đã lưu (mới nhất trước): bấm để mở lại và hỏi tiếp, nút × để xoá
export function historyHtml(list = []) {
  if (!list.length) return '';
  const rows = list.map((c) => `<li><button type="button" class="hist-item" data-chat="${escapeHtml(c.id)}"><span class="hist-title">${escapeHtml(c.title)}</span>
      <span class="hist-meta">${icon(c.source?.action && c.source.action !== 'ask' ? 'bulb' : 'sparkles', { size: 12 })}${escapeHtml(ACTION_LABEL[c.source?.action] ?? c.source?.action ?? 'Hỏi AI')} · ${escapeHtml(c.count)} tin · ${escapeHtml(new Date(c.updatedAt).toLocaleString('vi-VN'))}</span></button>
      <button type="button" class="icon-btn hist-del" data-del-chat="${escapeHtml(c.id)}" aria-label="Xoá chat này" title="Xoá chat này">${icon('close', { size: 13 })}</button></li>`).join('');
  return `<h3 class="hist-head">${icon('clock', { size: 14 })} Chat đã lưu</h3><ul class="chat-history">${rows}</ul>`;
}
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
        <ul class="ask-ideas">${IDEAS.map((q) => `<li><button type="button" data-idea>${escapeHtml(q)}</button></li>`).join('')}</ul><div data-history></div>`;
    log.querySelectorAll('[data-idea]').forEach((b) => b.addEventListener('click', () => send(b.textContent)));
    log.scrollTop = log.scrollHeight;
    if (!chat.msgs.length && !isExport()) loadHistory();
  };
  const loadHistory = async () => {
    const list = await getJson('/api/ai/chats').catch(() => []);
    const box = log.querySelector('[data-history]');
    if (box) box.innerHTML = historyHtml(list);
  };
  // bấm trong danh sách lịch sử: mở lại chat (hỏi tiếp bằng session đã lưu) hoặc xoá
  log.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del-chat]');
    if (del) {
      await postJson('/api/ai/chats/delete', { id: del.dataset.delChat }).catch(() => {});
      return loadHistory();
    }
    const open = e.target.closest('[data-chat]');
    if (!open || busy) return;
    const c = await getJson(`/api/ai/chats?id=${encodeURIComponent(open.dataset.chat)}`).catch(() => null);
    if (!c || !panel.isConnected || busy) return; // đã gửi câu hỏi mới trong lúc chờ: không đè chat đang trả lời
    chat = { id: c.id, title: c.title, sessionId: c.sessionId ?? c.id, msgs: c.msgs };
    render();
    input.focus();
  });
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
      else ai.error = 'Đã dừng giữa chừng';
    }
    if (!ai.text && !ai.error) ai.text = '_(Không có câu trả lời)_';
    setBusy(false);
    mine.title ??= shortTitle(q);
    const entry = chatEntry({ chatId: mine.id, sessionId: mine.sessionId, title: mine.title, source: { action: 'ask' }, question: q, answer: ai.text, error: ai.error });
    mine.id ??= entry?.id ?? null;
    // đã bấm "+" trong lúc trả lời: danh sách lịch sử đang hiện, nạp lại khi chat này đã ghi xong
    saveChat(entry).then(() => panel.isConnected && !chat.msgs.length && loadHistory());
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
    chat = NEW_CHAT();
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
