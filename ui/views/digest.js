import { getJson } from '../api.js';
import { pageHead, copyToClipboard } from '../analysis.js';
import { renderMarkdown } from '../markdown.js';
import { icon } from '../icons.js';

let digestDays = 7;

export async function renderDigest(main) {
  const d = await getJson(`/api/digest?days=${digestDays}`);
  const tools = `<label>Khoảng <select data-days>${[7, 14, 30].map((n) => `<option value="${n}" ${n === digestDays ? 'selected' : ''}>${n} ngày</option>`).join('')}</select></label>
    <button type="button" data-copy>${icon('copy', { size: 14 })}Copy Markdown</button>
    <button type="button" data-download>${icon('download', { size: 14 })}Tải .md</button>`;
  main.innerHTML = `${pageHead('Digest', 'newspaper', 'Tóm tắt tuần để dán vào Slack, email hay standup. Lệnh <code>/e2e-dashboard digest</code> in ra cùng nội dung và lưu vào <code>.e2e-dashboard/digests/</code>.', tools)}
    <article class="panel md digest">${renderMarkdown(d.markdown)}</article>`;
  main.querySelector('[data-days]').addEventListener('change', (e) => {
    digestDays = Number(e.target.value) || 7;
    renderDigest(main);
  });
  main.querySelector('[data-copy]').addEventListener('click', (e) => copyToClipboard(d.markdown, e.currentTarget));
  main.querySelector('[data-download]').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([d.markdown], { type: 'text/markdown' }));
    a.download = `e2e-digest-${d.to.slice(0, 10)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}
