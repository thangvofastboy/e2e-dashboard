import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../ui/markdown.js';
import { GUIDE_MD } from '../ui/guide.js';

test('heading # đến ### thành h1–h3, có escape', () => {
  const html = renderMarkdown('# Một\n## Hai <b>\n### Ba `x`');
  assert.match(html, /<h1>Một<\/h1>/);
  assert.match(html, /<h2>Hai &lt;b&gt;<\/h2>/);
  assert.match(html, /<h3>Ba <code>x<\/code><\/h3>/);
  assert.doesNotMatch(renderMarkdown('#### Bốn'), /<h4>/);
});

test('bảng pipe đơn giản: thead, tbody, inline và escape', () => {
  const html = renderMarkdown('| Lệnh | Việc |\n|---|:-:|\n| `npx e2e run` | chạy **test** |\n| a \\| b | <img src=x onerror=alert(1)> |');
  assert.match(html, /<table class="table md-table"><thead><tr><th>Lệnh<\/th><th>Việc<\/th><\/tr><\/thead>/);
  assert.match(html, /<td><code>npx e2e run<\/code><\/td><td>chạy <strong>test<\/strong><\/td>/);
  assert.match(html, /<td>a \| b<\/td>/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x/);
});

test('dòng có | nhưng không có dòng phân cách thì vẫn là đoạn văn', () => {
  const html = renderMarkdown('| không phải bảng |\nchữ thường');
  assert.doesNotMatch(html, /<table/);
  assert.match(html, /<p>/);
});

test('bảng kết thúc khi gặp dòng không bắt đầu bằng |', () => {
  const html = renderMarkdown('|a|b|\n|-|-|\n|1|2|\nsau bảng');
  assert.match(html, /<\/table>\n<p>sau bảng<\/p>/);
});

test('guide: đủ 10 phần, render không lỗi, không chứa dòng làm hỏng bundler', () => {
  const html = renderMarkdown(GUIDE_MD);
  assert.equal((html.match(/<h2>/g) ?? []).length, 10);
  assert.doesNotMatch(GUIDE_MD, /^\s*export\s+default\b/m);
  assert.doesNotMatch(GUIDE_MD, /^\s*import\s*\{[^}]*\}\s*from\s*['"]\.{1,2}\//m);
});

test('bảng: | trong code và \\| ở cuối ô không tách ô', () => {
  const html = renderMarkdown('| Lệnh | Ghi chú |\n|---|---|\n| `a | b` | cuối \\| |');
  const cells = [...html.matchAll(/<td>(.*?)<\/td>/g)].map((m) => m[1]);
  assert.equal(cells.length, 2, html);
  assert.match(cells[0], /<code>a \| b<\/code>/);
  assert.equal(cells[1], 'cuối |');
});
