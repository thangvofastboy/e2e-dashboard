import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineChart, shareBar, sparkline, heatmap, hbarChart } from '../ui/charts.js';

test('area option adds a gradient fill with a unique id per chart', () => {
  const a = lineChart({ points: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }], area: true });
  const b = lineChart({ points: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }], area: true });
  const id = (s) => /<linearGradient id="([^"]+)"/.exec(s)[1];
  assert.notEqual(id(a), id(b));
  assert.match(a, new RegExp(`<path class="area" d="[^"]+" fill="url\\(#${id(a)}\\)"`));
});

test('shareBar draws one segment per non-zero value, sized by value, with tooltips and a headline', () => {
  const html = shareBar({ segments: [{ key: 'passed', value: 39 }, { key: 'failed', value: 3 }, { key: 'flaky', value: 0 }], center: '93%', centerLabel: 'pass rate', ariaLabel: 'kết quả' });
  assert.equal((html.match(/class="share-seg/g) ?? []).length, 2);
  assert.match(html, /flex-grow:39/);
  assert.match(html, /data-tip="3 [^"]*· 7%"/);
  assert.match(html, /<b>93%<\/b>/);
  assert.match(html, /aria-label="kết quả: 39 [^"]*, 3 /);
  assert.doesNotMatch(shareBar({ segments: [{ key: '<x>', value: 1, label: '<img>' }] }), /<img|<x>/);
  assert.match(shareBar({ segments: [] }), /Chưa có dữ liệu/);
});

test('sparkline skips nulls and needs two points', () => {
  assert.match(sparkline([1, null, 3, 2]), /<polyline class="spark"/);
  assert.equal(sparkline([5]), '');
  assert.doesNotMatch(sparkline([1, 2, 3]), /NaN/);
});

test('heatmap renders labelled rows of linked, toned cells', () => {
  const html = heatmap({ cols: 3, rows: [{ label: '<t>', cells: [{ status: 'passed', href: '#/run/a', tip: 'a' }, { status: 'failed', href: '#/run/b', tip: 'b' }] }] });
  assert.match(html, /&lt;t&gt;/);
  assert.equal((html.match(/class="hm-cell[ "]/g) ?? []).length, 3);
  assert.match(html, /hm-cell s-failed" href="#\/run\/b"/);
  assert.match(heatmap({ cols: 3, rows: [] }), /Chưa có dữ liệu/);
});

test('hbarChart scales bars to the max and escapes labels', () => {
  const html = hbarChart({ items: [{ label: '<slow>', value: 200 }, { label: 'fast', value: 50 }], format: (v) => `${v}ms` });
  assert.match(html, /width:100%/);
  assert.match(html, /width:25%/);
  assert.match(html, /&lt;slow&gt;/);
  assert.match(html, /200ms/);
});
