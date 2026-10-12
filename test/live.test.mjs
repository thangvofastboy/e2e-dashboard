import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLive, estimateEta } from '../server/live.mjs';

const at = (s) => `2026-07-24T12:00:${String(s).padStart(2, '0')}.000Z`;
const started = (testId, s) => ({ type: 'test-started', at: at(s), testId, agent: 'default', repeat: 0, title: testId, file: 'a.e2e.ts', target: 'web' });
const finished = (testId, s, status = 'passed') => ({
  type: 'test-finished', at: at(s),
  result: { testId, targetId: 'web', agent: 'default', repeat: 0, status, attempts: [{ durationMs: 1000 }] },
});

test('tracks run lifecycle, counts and lanes (lowest free lane is reused)', () => {
  const live = createLive();
  live.apply({ type: 'run-started', at: at(0), runId: 'r1', artifactsRoot: '/x' });
  live.apply({ type: 'plan', at: at(0), total: 3, files: [] });
  live.apply(started('A', 1));
  live.apply(started('B', 1));
  live.apply(finished('A', 2));
  live.apply(started('C', 3));
  const s = live.snapshot();
  assert.equal(s.status, 'running');
  assert.equal(s.total, 3);
  assert.equal(s.done, 1);
  const lane = (id) => s.tests.find((t) => t.testId === id).lane;
  assert.deepEqual([lane('A'), lane('B'), lane('C')], [0, 1, 0]);
  assert.equal(s.lanes, 2);
  live.apply({ type: 'run-finished', at: at(9), status: 'failed', exitCode: 1 });
  assert.equal(live.snapshot().status, 'finished');
  assert.equal(live.snapshot().runStatus, 'failed');
});

test('records step progress by stepId', () => {
  const live = createLive();
  live.apply({ type: 'run-started', at: at(0), runId: 'r1' });
  live.apply(started('A', 1));
  const base = { type: 'step', testId: 'A', agent: 'default', repeat: 0, target: 'web' };
  const identity = { attemptId: 'x', attemptIndex: 0, stepId: 's1', stepIndex: 0 };
  live.apply({ ...base, progress: { phase: 'start', kind: 'agent', api: 'agent.act', label: 'buy', identity } });
  live.apply({ ...base, progress: { phase: 'activity', api: 'agent.act', activity: 'model', identity } });
  let t = live.snapshot().tests[0];
  assert.equal(t.steps[0].status, 'running');
  assert.equal(t.activity, 'model');
  live.apply({ ...base, progress: { phase: 'end', kind: 'agent', api: 'agent.act', label: 'buy', status: 'failed', durationMs: 50, modelCalls: 1, error: { message: 'nope' }, identity } });
  t = live.snapshot().tests[0];
  assert.equal(t.steps[0].status, 'failed');
  assert.equal(t.steps[0].error.message, 'nope');
});

test('ignores unknown events and malformed input; caps output', () => {
  const live = createLive();
  live.apply({ type: 'run-started', at: at(0), runId: 'r1' });
  live.apply({ type: 'brand-new-event' });
  live.apply(null);
  live.apply({ type: 'step', testId: 'missing', progress: { phase: 'start' } });
  for (let i = 0; i < 600; i++) live.apply({ type: 'output', at: at(1), pair: undefined, stream: 'stdout', text: `l${i}` });
  const s = live.snapshot();
  assert.equal(s.output.length, 500);
  assert.equal(s.output.at(-1).text, 'l599');
});

test('subscribers receive throttled snapshots; flush sends immediately', () => {
  const live = createLive({ throttleMs: 10_000 });
  const got = [];
  const off = live.subscribe((s) => got.push(s));
  live.apply({ type: 'run-started', at: at(0), runId: 'r1' });
  live.apply(started('A', 1));
  live.flush();
  assert.equal(got.length, 1);
  assert.equal(got[0].tests.length, 1);
  off();
  live.flush();
  assert.equal(got.length, 1);
});

test('estimateEta uses history averages for remaining tests divided by lanes', () => {
  const snap = { status: 'running', total: 4, done: 2, lanes: 2, tests: [] };
  assert.equal(estimateEta(snap, new Map([['a', 2000], ['b', 4000]])), 6000); // 2 left, both with history; no busy lane → ÷ 1
  assert.equal(estimateEta(snap, new Map()), null);
  assert.equal(estimateEta({ ...snap, status: 'finished' }, new Map([['a', 1]])), null);
});

test('unselected tests (filtered out of the run) do not count as progress', () => {
  const live = createLive();
  live.apply({ type: 'run-started', at: at(0), runId: 'r1' });
  live.apply({ type: 'plan', at: at(0), total: 3, files: [] });
  live.apply({ type: 'test-finished', at: at(1), result: { testId: 'X', targetId: 'web', agent: 'default', repeat: 0, status: 'skipped', selected: false, attempts: [] } });
  live.apply({ type: 'test-finished', at: at(1), result: { testId: 'Y', targetId: 'web', agent: 'default', repeat: 0, status: 'skipped', selected: false, attempts: [] } });
  const s = live.snapshot();
  assert.equal(s.total, 1);
  assert.equal(s.done, 0);
});

test('no ETA when nothing is left to run', () => {
  assert.equal(estimateEta({ status: 'running', total: 0, done: 0, lanes: 0, tests: [] }, new Map([['a', 1000]])), null);
});

test('e2e 0.19 wire result (test.id + target {name}, no testId/targetId) updates status, frees the lane and keeps the error', () => {
  const live = createLive();
  live.apply({ type: 'run-started', at: at(0), runId: 'r2', artifactsRoot: '/x' });
  live.apply(started('A', 1));
  live.apply({
    type: 'test-finished', at: at(2),
    result: { test: { id: 'A', kind: 'test', title: 'A' }, target: { name: 'web', platform: 'web' }, agent: 'default', repeat: 0, selected: true, status: 'failed',
      attempts: [{ durationMs: 500, error: { code: 'ERROR', message: "ENOENT: no such file, open 'auth.json'", stack: 'x' } }] },
  });
  live.apply(started('B', 3));
  const s = live.snapshot();
  const a = s.tests.find((t) => t.testId === 'A');
  assert.equal(a.status, 'failed');
  assert.deepEqual(a.error, { code: 'ERROR', message: "ENOENT: no such file, open 'auth.json'" });
  assert.equal(s.tests.find((t) => t.testId === 'B').lane, 0, 'A finished, so B reuses lane 0');
  assert.equal(s.lanes, 1);
  live.apply({ type: 'plan', at: at(0), total: 5, files: [] }); // plan counts unselected setups too
  live.apply({ type: 'run-finished', at: at(9), status: 'failed', exitCode: 1 });
  assert.equal(live.snapshot().total, live.snapshot().done, 'a finished run shows done/done, not done/plan');
});

test('run-stopped and notice events reach the snapshot; a new run clears them', () => {
  const live = createLive({ throttleMs: 1 });
  live.apply({ type: 'run-started', at: '2026-10-13T00:00:00Z', runId: 'r1' });
  live.apply({ type: 'notice', target: 'web', message: 'fell back to chromium' });
  live.apply({ type: 'run-stopped', failures: 3, limit: 3 });
  assert.deepEqual(live.snapshot().stopped, { failures: 3, limit: 3 });
  assert.deepEqual(live.snapshot().notices, [{ target: 'web', message: 'fell back to chromium' }]);
  assert.equal(live.full().stopped.limit, 3);
  live.apply({ type: 'run-started', at: '2026-10-13T00:01:00Z', runId: 'r2' });
  assert.equal(live.snapshot().stopped, null);
  assert.deepEqual(live.snapshot().notices, []);
});
