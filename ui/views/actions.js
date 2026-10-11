// Dialogs for actions that leave the dashboard: git bisect, a PR comment, a CI import.
import { getJson, postJson } from '../api.js';
import { openModal, copyToClipboard } from '../analysis.js';
import { escapeHtml } from '../format.js';
import { runHref } from '../router.js';
import { icon } from '../icons.js';

export async function openBisectDialog({ runId, resultId }) {
  const { body } = openModal('bisect-dialog', 'Tìm commit gây lỗi', 'commit');
  try {
    const p = await getJson(`/api/bisect?runId=${encodeURIComponent(runId)}&resultId=${encodeURIComponent(resultId)}`);
    const side = (label, x, tone) => (x ? `<div><span class="chip tone-${tone}">${label}</span> <a href="${runHref(x.runId)}">${escapeHtml(new Date(x.startedAt).toLocaleString('vi-VN'))}</a> <code>${escapeHtml(x.branch ?? '?')}@${escapeHtml(String(x.commit ?? '?').slice(0, 10))}</code></div>` : '');
    body.innerHTML = `<p><strong>${escapeHtml(p.title)}</strong> <code>${escapeHtml(p.test)}</code></p>
      ${side('pass gần nhất', p.good, 'good')}${side('fail đầu tiên', p.bad, 'bad')}
      ${p.script ? `<p class="muted small">Chạy trong terminal ở thư mục project (git bisect checkout từng commit, nên commit hoặc stash thay đổi trước):</p><pre class="code"><code>${escapeHtml(p.script)}</code></pre>
        <footer><button type="button" data-copy>${icon('copy', { size: 14 })}Copy lệnh</button></footer>` : `<div class="banner tone-warn">${icon('info', { size: 15 })}${escapeHtml(p.reason)}</div>`}`;
    body.querySelector('[data-copy]')?.addEventListener('click', (e) => copyToClipboard(p.script, e.currentTarget));
  } catch (e) {
    body.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`;
  }
}

export async function openPrDialog({ a, b }) {
  const { body } = openModal('pr-dialog', 'Đăng so sánh lên pull request', 'send');
  let d;
  try {
    d = await postJson('/api/github/pr', { a, b });
  } catch (e) {
    body.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`;
    return;
  }
  const where = d.pr
    ? `<div class="banner tone-info">${icon('info', { size: 15 })}PR mở của branch: <a href="${escapeHtml(/^https:\/\/github\.com\//.test(d.pr.url) ? d.pr.url : '#')}" target="_blank" rel="noopener noreferrer">#${escapeHtml(d.pr.number)} ${escapeHtml(d.pr.title)}</a></div>`
    : `<div class="banner tone-warn">${icon('alert', { size: 15 })}${escapeHtml(d.error ?? 'Không thấy PR đang mở cho branch của run B.')} Bạn vẫn có thể copy nội dung.</div>`;
  body.innerHTML = `${where}<details open><summary>Nội dung comment (Markdown, GitHub sẽ hiện thành bảng)</summary><pre class="code linear-preview">${escapeHtml(d.markdown)}</pre></details>
    <div data-status hidden></div>
    <footer><button type="button" data-copy>${icon('copy', { size: 14 })}Copy Markdown</button>${d.pr ? `<button type="button" class="primary" data-post>${icon('send', { size: 14 })}Đăng qua gh</button>` : ''}</footer>`;
  body.querySelector('[data-copy]').addEventListener('click', (e) => copyToClipboard(d.markdown, e.currentTarget));
  body.querySelector('[data-post]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    const st = body.querySelector('[data-status]');
    st.hidden = false;
    try {
      const r = await postJson('/api/github/pr', { a, b, post: true });
      st.className = 'banner tone-good';
      st.textContent = `Đã đăng comment ${r.posted ?? ''}`;
    } catch (x) {
      st.className = 'banner tone-bad';
      st.textContent = x.message;
    }
  });
}

export function openImportDialog(onDone) {
  const { body } = openModal('import-dialog', 'Nhập report từ GitHub Actions', 'upload', `
    <p class="muted small">Dùng GitHub CLI (<code>gh</code>) đã đăng nhập để tải artifact của một workflow run có <code>report.json</code> của e2e (thư mục <code>.e2e</code>), rồi lưu vào lịch sử với nguồn <code>ci</code>.</p>
    <form class="row" data-form><label>Run id <input type="text" name="runId" inputmode="numeric" pattern="\\d+" required placeholder="vd. 1234567890"></label>
      <label>Artifact <input type="text" name="artifact" placeholder="(tất cả)"></label>
      <button type="submit" class="primary">${icon('download', { size: 14 })}Nhập</button></form>
    <div data-status hidden></div>
    <p class="muted small">Cũng làm được bằng lệnh <code>/e2e-dashboard import --gh &lt;run id&gt;</code> hoặc <code>/e2e-dashboard import &lt;report.json&gt;</code>.</p>`);
  body.querySelector('[data-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const st = body.querySelector('[data-status]');
    st.hidden = false;
    st.className = 'banner tone-info';
    st.textContent = 'Đang tải artifact…';
    try {
      const { imported } = await postJson('/api/import/github', { runId: String(fd.get('runId')), artifact: String(fd.get('artifact') ?? '') });
      const ok = imported.filter((x) => x.status === 'archived').length;
      st.className = `banner tone-${ok ? 'good' : 'warn'}`;
      st.textContent = imported.length ? `Đã nhập ${ok}/${imported.length} report${imported.some((x) => x.status === 'exists') ? ' (có run đã có sẵn)' : ''}.` : 'Artifact không có report.json nào.';
      if (ok) onDone?.();
    } catch (x) {
      st.className = 'banner tone-bad';
      st.textContent = x.message;
    }
  });
}
