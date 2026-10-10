import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineChart, donutChart, sparkline, heatmap, hbarChart } from '../ui/charts.js';

test('area option adds a gradient fill with a unique id per chart', () => {
  const a = lineChart({ points: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }], area: true });
  const b = lineChart({ points: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }], area: true });
  const id = (s) => /<linearGradient id="([^"]+)"/.exec(s)[1];
  assert.notEqual(id(a), id(b));
  assert.match(a, new RegExp(`<path class="area" d="[^"]+" fill="url\\(#${id(a)}\\)"`));
});

test('donut draws one arc per non-zero segment with tooltips and a center label', () => {
  const svg = donutChart({ segments: [{ key: 'passed', value: 39 }, { key: 'failed', value: 3 }, { key: 'flaky', value: 0 }], center: '93%', ariaLabel: 'kết quả' });
  assert.equal((svg.match(/<circle class="arc s-/g) ?? []).length, 2);
  assert.match(svg, /data-tip="39 passed"/);
  assert.match(svg, />93%</);
  assert.match(donutChart({ segments: [] }), /Chưa có dữ liệu/);
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
