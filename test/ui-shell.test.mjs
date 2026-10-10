import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, runHref } from '../ui/router.js';
import { runTable } from '../ui/views/overview.js';
import { passRate } from '../ui/health.js';
import { fileURLToPath } from 'node:url';
import { bundleUi } from '../ui/bundle.mjs';

// All ui/ modules share one scope after bundling: duplicate top-level names are a SyntaxError here.
test('the real UI bundle compiles', async () => {
  const code = await bundleUi(fileURLToPath(new URL('../ui', import.meta.url)));
  assert.doesNotThrow(() => new Function(code));
});

test('parseRoute covers every view and deep links', () => {
  assert.deepEqual(parseRoute(''), { view: 'overview' });
  assert.deepEqual(parseRoute('#/'), { view: 'overview' });
  assert.deepEqual(parseRoute('#/runs'), { view: 'runs' });
  assert.deepEqual(parseRoute('#/live'), { view: 'live' });
  assert.deepEqual(parseRoute('#/tests'), { view: 'tests' });
  assert.deepEqual(parseRoute('#/run/abc'), { view: 'run', runId: 'abc', resultId: null });
  assert.deepEqual(parseRoute('#/run/abc/test/r%201'), { view: 'run', runId: 'abc', resultId: 'r 1' });
  assert.deepEqual(parseRoute('#/nope'), { view: 'notfound' });
  assert.equal(runHref('abc', 'r 1'), '#/run/abc/test/r%201');
  assert.equal(runHref('abc'), '#/run/abc');
});

test('passRate counts flaky as passed and ignores skipped', () => {
  assert.equal(passRate({ summary: { passed: 3, flaky: 1, failed: 1, interrupted: 0, skipped: 5 } }), 0.8);
  assert.equal(passRate({ summary: { passed: 0, flaky: 0, failed: 0, interrupted: 0, skipped: 2 } }), null);
});

test('runTable links each run and escapes branch names', () => {
  const html = runTable([{
    runId: 'r1', status: 'failed', startedAt: new Date().toISOString(), durationMs: 2000,
    summary: { passed: 1, failed: 2, flaky: 0, skipped: 0, interrupted: 0 }, tokens: { input: 10, output: 5 },
    git: { branch: '<b>', commit: 'a'.repeat(40), dirty: true }, source: 'hook', pinned: true,
  }]);
  assert.match(html, /href="#\/run\/r1"/);
  assert.match(html, /&lt;b&gt;@aaaaaaa/);
  assert.match(html, /#i-pin/);
});

test('runTable escapes numbers taken from a tampered report', () => {
  const html = runTable([{ runId: 'r1', status: 'failed', startedAt: new Date().toISOString(), durationMs: 1, summary: { passed: '<img src=x onerror=alert(1)>' }, tokens: {}, source: 'hook' }]);
  assert.doesNotMatch(html, /<img/);
});
