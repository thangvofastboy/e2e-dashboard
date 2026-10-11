import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../ui/markdown.js';
import { lineChart, stackedBarChart, legend } from '../ui/charts.js';

test('markdown renders the supported subset', () => {
  const html = renderMarkdown('# Tiêu đề\n\nĐoạn **đậm** và *nghiêng* với `code`.\n\n- một\n- hai\n\n1. a\n2. b\n\n```js\nconst x = 1 < 2;\n```\n\n[docs](https://e2e.tester.army)');
  assert.match(html, /<h1>Tiêu đề<\/h1>/);
  assert.match(html, /<strong>đậm<\/strong>/);
  assert.match(html, /<em>nghiêng<\/em>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<ul><li>một<\/li><li>hai<\/li><\/ul>/);
  assert.match(html, /<ol><li>a<\/li><li>b<\/li><\/ol>/);
  assert.match(html, /<pre><code(?: class="language-\w+")?>const x = 1 &lt; 2;\n<\/code><\/pre>/);
  assert.match(html, /<a href="https:\/\/e2e\.tester\.army" rel="noopener noreferrer" target="_blank">docs<\/a>/);
});

test('markdown never emits raw HTML or script links', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert(1)) [y](data:text/html,hi) <img src=x onerror=alert(1)>');
  assert.doesNotMatch(html, /<script|<img|href="javascript|href="data/);
  assert.match(html, /&lt;script&gt;/);
});

test('lineChart draws one marker per non-null point and breaks on null', () => {
  const svg = lineChart({ points: [{ label: 'a', value: 1 }, { label: 'b', value: null }, { label: 'c', value: 3 }], ariaLabel: 'pass rate' });
  assert.match(svg, /^<svg[^>]*role="img"[^>]*aria-label="pass rate"/);
  assert.equal((svg.match(/<circle /g) ?? []).length, 2);
  assert.equal((svg.match(/<path class="line/g) ?? []).length, 2);
  assert.equal((svg.match(/data-tip=/g) ?? []).length, 3);
  assert.doesNotMatch(svg, /NaN/);
});

test('stackedBarChart draws segments, hatches failures, escapes labels', () => {
  const svg = stackedBarChart({
    bars: [{ label: '<run>', segments: { passed: 3, failed: 1, skipped: 0 }, tip: '<b>' }, { label: 'r2', segments: { passed: 0, failed: 0 } }],
    keys: ['passed', 'flaky', 'failed', 'skipped'],
    ariaLabel: 'kết quả',
  });
  assert.equal((svg.match(/class="seg s-/g) ?? []).length, 2);
  assert.match(svg, /fill="url\(#hatch\)"/);
  assert.doesNotMatch(svg, /<run>|<b>|NaN/);
});

test('empty charts and legend', () => {
  assert.match(lineChart({ points: [] }), /Chưa có dữ liệu/);
  assert.match(stackedBarChart({ bars: [], keys: ['passed'] }), /Chưa có dữ liệu/);
  assert.match(legend(['passed', 'failed']), /tone-good.*#i-check.*passed.*tone-bad.*#i-x.*failed/s);
});

test('markdown drops links whose URL hides a scheme behind control characters', () => {
  for (const url of ['\u0001javascript:alert(1)', '\u001fjavascript:alert(1)', 'java\u0000script:alert(1)', '\u007fjavascript:alert(1)']) {
    const html = renderMarkdown(`[x](${url})`);
    assert.doesNotMatch(html, /<a /, JSON.stringify(url));
  }
});

test('markdown accepts indented code fences (e.g. inside a list item)', () => {
  const html = renderMarkdown('- Sửa dòng 13:\n\n   ```ts\n   await expect(x).toHaveText("a")\n   ```\n\nXong.');
  assert.match(html, /<pre><code class="language-ts">await expect\(x\)\.toHaveText\(&quot;a&quot;\)\n<\/code><\/pre>/);
  assert.match(html, /<p>Xong\.<\/p>/);
});
