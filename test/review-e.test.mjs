import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../ui/markdown.js';

test('markdown: * and ** inside a link URL stay in the href (not turned into <em>/<strong>)', () => {
  assert.equal(renderMarkdown('[glob](https://x.dev/a*b*c)'), '<p><a href="https://x.dev/a*b*c" rel="noopener noreferrer" target="_blank">glob</a></p>');
  assert.equal(renderMarkdown('[g](https://x.dev/**/y**)'), '<p><a href="https://x.dev/**/y**" rel="noopener noreferrer" target="_blank">g</a></p>');
  // formatting around / inside the label still works
  assert.match(renderMarkdown('**[x](https://a.dev)**'), /<strong><a href="https:\/\/a\.dev"[^>]*>x<\/a><\/strong>/);
  assert.match(renderMarkdown('[**x**](https://a.dev) and *y*'), /<a href="https:\/\/a\.dev"[^>]*><strong>x<\/strong><\/a> and <em>y<\/em>/);
  assert.equal(renderMarkdown('[x](javascript:alert(1))'), '<p>x)</p>');
});

test('markdown: NUL in the source cannot forge a code placeholder', () => {
  assert.equal(renderMarkdown('`a` \u00000\u0000 x'), '<p><code>a</code> 0 x</p>');
  assert.equal(renderMarkdown('text\u00005\u0000'), '<p>text5</p>');
});
