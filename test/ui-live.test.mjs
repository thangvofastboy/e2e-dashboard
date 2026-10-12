import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ganttBlocks, stripAnsi } from '../ui/views/live.js';
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

test('stripAnsi drops colour codes and control chars, keeps newlines and tabs', () => {
  assert.equal(stripAnsi('\x1b[1m\x1b[41m FAIL \x1b[49m\x1b[22m web\r\n\tline\x07'), ' FAIL  web\n\tline');
  assert.equal(stripAnsi(undefined), '');
  assert.equal(stripAnsi('see \x1b]8;;https://x.dev/a\x07trace\x1b]8;;\x07 now'), 'see trace now');
  assert.equal(stripAnsi('\x1b]8;;https://x.dev\x1b\\link\x1b]8;;\x1b\\'), 'link');
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

test('tally counts finished statuses for the Live progress line', async () => {
  const { tally } = await import('../ui/views/live.js');
  assert.equal(tally([]), '');
  const html = tally([{ status: 'passed' }, { status: 'failed' }, { status: 'failed' }, { status: 'skipped' }, { status: 'running' }]);
  assert.match(html, /1 pass/);
  assert.match(html, /2 fail/);
  assert.match(html, /1 skip/);
  assert.doesNotMatch(html, /flaky/);
});

test('tally shows how many workers are running now and the peak reached', async () => {
  const { tally } = await import('../ui/views/live.js');
  const running = tally([{ status: 'running' }, { status: 'running' }, { status: 'passed' }], 5);
  assert.match(running, /2 worker đang chạy \(tối đa 5\)/);
  assert.match(running, /1 pass/);
  assert.match(tally([{ status: 'passed' }], 4), /tối đa 4 worker/);
  assert.doesNotMatch(tally([{ status: 'running' }], 1), /tối đa/);
});
