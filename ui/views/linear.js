import { postJson } from '../api.js';
import { copyToClipboard } from '../analysis.js';
import { renderMarkdown } from '../markdown.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';

const issueLink = (i) => (i?.url && /^https:\/\/linear\.app\//.test(i.url) ? `<a href="${escapeHtml(i.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(i.identifier || i.url)}</a>` : escapeHtml(i?.identifier ?? ''));

// Report a failed test to Linear: preview, duplicate check by fingerprint, or hand it to Claude (MCP).
export async function openLinearDialog({ runId, resultId }) {
  document.getElementById('linear-dialog')?.remove();
  const dlg = document.createElement('dialog');
  dlg.id = 'linear-dialog';
  dlg.innerHTML = `<div class="run-form"><header><h2>${icon('ticket', { size: 16 })}Gửi Linear</h2><button type="button" class="icon-btn" data-close aria-label="Đóng">${icon('close')}</button></header><div data-body><p class="muted">Đang dựng nội dung…</p></div></div>`;
  document.body.append(dlg);
  dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  const body = dlg.querySelector('[data-body]');
  let d;
  try {
    d = await postJson('/api/linear/draft', { runId, resultId });
  } catch (e) {
    body.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`;
    return;
  }
  const status = (html, tone = 'info') => {
    const el = body.querySelector('[data-status]');
    el.className = `banner tone-${tone}`;
    el.hidden = false;
    el.innerHTML = html;
  };
  body.innerHTML = `
    ${d.link ? `<div class="banner tone-info">${icon('info', { size: 15 })}Đã gửi trước đây: ${issueLink(d.link)}</div>` : ''}
    <p><strong>${escapeHtml(d.draft.title)}</strong></p>
    <details><summary>Mô tả issue</summary><div class="md linear-preview">${renderMarkdown(d.draft.description)}</div></details>
    <p class="muted small">Chống trùng: mô tả mang mã <code>${escapeHtml(d.draft.fingerprint)}</code> (tên test + dạng lỗi). Cùng lỗi ở run khác sẽ thành comment trên issue đang mở.${d.team ? ` Team: <code>${escapeHtml(d.team)}</code>.` : ''}</p>
    <div data-status hidden></div>
    <footer>
      <button type="button" data-copy-claude title="Dán vào Claude Code có Linear MCP">${icon('copy', { size: 14 })}Copy cho Claude (Linear MCP)</button>
      ${d.configured ? `<button type="button" class="primary" data-send>${icon('send', { size: 14 })}Gửi lên Linear</button>` : '<span class="muted small">Đặt <code>LINEAR_API_KEY</code> (và <code>LINEAR_TEAM</code>) để gửi trực tiếp.</span>'}
    </footer>`;
  body.querySelector('[data-copy-claude]').addEventListener('click', (e) => copyToClipboard(d.prompt, e.currentTarget));
  const send = async (mode) => {
    status(`${icon('loader', { size: 14 })} Đang kiểm tra trùng trên Linear…`);
    try {
      const r = await postJson('/api/linear/issue', { runId, resultId, mode });
      if (r.status === 'duplicate') {
        status(`${icon('alert', { size: 15 })}Đã có issue đang mở: ${issueLink(r.issue)} (${escapeHtml(r.issue.state?.name ?? '')}). <button type="button" data-comment>Thêm comment run này</button>`, 'warn');
        body.querySelector('[data-comment]').addEventListener('click', () => send('comment'));
      } else if (r.status === 'commented') status(`${icon('check', { size: 15 })}Đã thêm comment vào ${issueLink(r.issue)}.`, 'good');
      else status(`${icon('check', { size: 15 })}Đã tạo ${issueLink(r.issue)}${r.reopenedFrom ? ` (tái phát của ${escapeHtml(r.reopenedFrom)})` : ''}.`, 'good');
    } catch (e) {
      status(escapeHtml(e.message), 'bad');
    }
  };
  body.querySelector('[data-send]')?.addEventListener('click', () => send('create'));
}
