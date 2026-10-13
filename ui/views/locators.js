import { getJson, isExport } from '../api.js';
import { openAiPanel } from './ai-panel.js';
import { runCountPicker, analysisCount, pageHead, emptyBox, noAgentBox, meter, copyToClipboard } from '../analysis.js';
import { escapeHtml, fmtTokens } from '../format.js';
import { runHref } from '../router.js';
import { icon } from '../icons.js';

export function locatorCardHtml(c, i) {
  const s = c.suggestion;
  return `<article class="panel loc">
    <header><div><strong>${escapeHtml(c.title)}</strong> <span class="muted small">${escapeHtml(c.target)}</span>
      <div><code>agent.act</code> “${escapeHtml(c.label)}” <span class="muted small">${c.source ? `${escapeHtml(c.source.file)}:${escapeHtml(c.source.line)}` : ''}</span></div></div>
      <div class="loc-meta">${meter(c.stability, c.stability >= 0.9 ? 'good' : 'warn', `${c.replayed}/${c.runs} replay`)}${c.tokensWhenLive ? `<span class="muted small">${escapeHtml(fmtTokens(c.tokensWhenLive))} token mỗi lần chạy live</span>` : ''}</div></header>
    ${s ? `<pre class="code"><code>${escapeHtml(s.code)}</code></pre>${s.todos ? `<p class="muted small">${escapeHtml(s.todos)} thao tác chưa có locator ổn định: giữ agent cho phần đó hoặc nhờ AI.</p>` : ''}`
      : '<p class="muted">Không đọc được bản ghi cache của step (đã bị xoá hoặc cache ở thư mục khác: đặt <code>"cacheDir"</code> trong config).</p>'}
    <footer>${s ? `<button type="button" data-copy-loc="${i}">${icon('copy', { size: 14 })}Copy code</button>` : ''}
      ${c.latest && !isExport() ? `<button type="button" class="btn-ai" data-ai-loc="${i}">${icon('sparkles', { size: 14 })}Nhờ AI viết lại</button><a href="${runHref(c.latest.runId, c.latest.resultId)}">Xem run</a>` : ''}</footer>
  </article>`;
}

export async function renderLocators(main) {
  const picker = runCountPicker(() => renderLocators(main));
  const { candidates, scan } = await getJson(`/api/locators?n=${analysisCount()}`);
  const head = pageHead('Gợi ý locator', 'crosshair', 'Step <code>agent.act</code> chạy lại từ replay cache ổn định qua nhiều run có thể viết thành code locator: chạy không cần model, nhanh và không tốn token. Code dưới được dựng từ bản ghi cache của e2e (<code>.e2e/cache</code>), hãy xem lại trước khi dùng.', `${picker.html}${isExport() || !candidates.length ? '' : `<button type="button" class="btn-ai" data-ai-locbatch title="AI đề xuất đổi các bước này sang locator cho cả suite">${icon('sparkles', { size: 14 })}AI đề xuất cho cả suite</button>`}`);
  main.innerHTML = candidates.length ? `${head}<section class="locs">${candidates.map(locatorCardHtml).join('')}</section>` : `${head}${scan.actSteps ? emptyBox('Chưa có step nào đủ ổn định', `Có ${scan.actSteps} step agent.act nhưng chưa step nào được replay từ cache ở ít nhất 3 run (và ≥ 60% số lần chạy).`) : noAgentBox(scan, 'gợi ý locator')}`;
  picker.bind(main);
  main.querySelector('[data-ai-locbatch]')?.addEventListener('click', () => openAiPanel({ action: 'locator-batch', runId: null, title: 'Đổi agent.act sang locator · cả suite' }));
  main.querySelectorAll('[data-copy-loc]').forEach((b) => b.addEventListener('click', () => copyToClipboard(candidates[Number(b.dataset.copyLoc)].suggestion.code, b)));
  main.querySelectorAll('[data-ai-loc]').forEach((b) =>
    b.addEventListener('click', () => {
      const c = candidates[Number(b.dataset.aiLoc)];
      openAiPanel({ action: 'suggest-locator', runId: c.latest.runId, resultId: c.latest.resultId, extra: { stepIndex: c.stepIndex }, title: `Locator · ${c.label}` });
    }));
}
