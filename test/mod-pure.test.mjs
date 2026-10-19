import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseServer, num, cleanLive, cleanRun, passRate } from '../mods/e2e-dashboard-tab/hooks/pure.ts';

test('parseServer: only a real port and a plain token reach a URL (server.json is a file in the user repo)', () => {
  assert.deepEqual(parseServer({ port: 4477, token: 'ab12_-CD' }), { port: 4477, token: 'ab12_-CD' });
  for (const bad of [
    { port: '1@evil.test', token: 'abc' }, { port: '4477', token: 'abc' }, { port: 0, token: 'abc' }, { port: 70000, token: 'abc' },
    { port: 4477.5, token: 'abc' }, { port: 4477, token: 'a b' }, { port: 4477, token: 'a\r\nHost: x' }, { port: 4477, token: '' },
    { port: 4477 }, null, 'x', [],
  ]) assert.equal(parseServer(bad), null, JSON.stringify(bad));
});

test('num: finite non-negative numbers only', () => {
  assert.equal(num(3), 3);
  for (const bad of ['3', NaN, Infinity, -1, null, undefined, {}, '<svg>']) assert.equal(num(bad), 0);
});

test('cleanLive: counts become numbers, markup and long titles cannot ride through', () => {
  const l = cleanLive({ status: 'running', done: '5', total: 10, counts: { passed: '<script>', failed: 2 }, running: ['a'.repeat(500), 1, null, 'c', 'd'], at: 5 });
  assert.deepEqual(l.counts, { passed: 0, failed: 2 });
  assert.equal(l.done, 0);
  assert.equal(l.running.length, 3);
  assert.ok(l.running.every((x) => typeof x === 'string' && x.length <= 120));
  assert.equal(l.at, undefined);
  assert.equal(cleanLive('nope'), null);
});

test('cleanRun + passRate: strings in the report summary cannot turn into string math', () => {
  const run = cleanRun({ runId: 'r', status: 'passed', durationMs: '9', summary: { passed: '1', flaky: 0, failed: 1 }, errorClasses: { infrastructure: 1 } });
  assert.equal(run.summary.passed, 0);
  assert.equal(passRate(cleanRun({ summary: { passed: 9, failed: 1 } })), 90);
  // infra failures are not the app's fault: 9 passed, 1 failed (infra) → 100
  assert.equal(passRate(cleanRun({ summary: { passed: 9, failed: 1 }, errorClasses: { infrastructure: 1 } })), 100);
  assert.equal(passRate(cleanRun({ summary: {} })), null);
});
