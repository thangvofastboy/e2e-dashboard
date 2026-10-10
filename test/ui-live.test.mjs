import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ganttBlocks } from '../ui/views/live.js';
import { historyCells } from '../ui/views/tests.js';

test('ganttBlocks places tests on their lane as % of elapsed run time', () => {
  const t0 = Date.parse('2026-07-24T12:00:00Z');
  const snap = {
    startedAt: new Date(t0).toISOString(), finishedAt: null,
    tests: [
      { key: 'a', lane: 0, status: 'passed', title: 'A', startedAt: new Date(t0).toISOString(), finishedAt: new Date(t0 + 5000).toISOString(), durationMs: 5000 },
      { key: 'b', lane: 1, status: 'running', title: 'B', startedAt: new Date(t0 + 5000).toISOString(), finishedAt: null, durationMs: null },
    ],
  };
  const blocks = ganttBlocks(snap, t0 + 10_000);
  assert.deepEqual(blocks.map((b) => [b.key, b.lane, b.left, b.width]), [['a', 0, 0, 50], ['b', 1, 50, 50]]);
  assert.equal(blocks[1].durationMs, 5000);
  assert.deepEqual(ganttBlocks({ startedAt: null, tests: [] }), []);
});

test('historyCells pads to n, oldest first, links each run', () => {
  const html = historyCells([{ runId: 'new', status: 'failed' }, { runId: 'old', status: 'passed' }], 4);
  assert.equal((html.match(/class="cell/g) ?? []).length, 4);
  assert.ok(html.indexOf('#/run/old') < html.indexOf('#/run/new'));
  assert.match(html, /s-failed/);
});

test('testRowHtml escapes the source line from a tampered report', async () => {
  const { testRowHtml } = await import('../ui/views/tests.js');
  const html = testRowHtml({ title: 't', line: '<img src=x onerror=alert(1)>', tags: [], target: 'web', agent: 'default', history: [], avgDurationMs: null });
  assert.doesNotMatch(html, /<img/);
});
