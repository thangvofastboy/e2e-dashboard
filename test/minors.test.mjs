// Regression tests for the deferred minor findings (M1–M8) and the ETA formula from spec §4.4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archive, applyRetention } from '../reporter/e2e-dashboard.reporter.mjs';
import { testHistory } from '../server/store.mjs';
import { createLive, estimateEta } from '../server/live.mjs';
import { flattenResults } from '../ui/model.js';
import { videoNote } from '../ui/views/run.js';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));
const tmp = () => mkdtempSync(join(tmpdir(), 'e2ed-'));

test('M1: malformed result fields do not break archive, history or the view model', async () => {
  const root = tmp();
  const r = fixture();
  r.run.results[0].titlePath = 'not-an-array';
  r.run.results[1].id = 42;
  const res = await archive(root, { source: 'hook', report: r });
  assert.equal(res.status, 'archived');
  const rows = await testHistory(root);
  assert.equal(rows.length, 2);
  assert.equal(typeof rows[0].title, 'string');
  assert.equal(typeof flattenResults(r)[0].title, 'string');
});

test('M2: retention removes stale .tmp-* dirs left by a killed archive, keeps fresh ones', async () => {
  const root = tmp();
  await archive(root, { source: 'hook', report: fixture() });
  const runs = join(root, '.e2e-dashboard/runs');
  mkdirSync(join(runs, '.tmp-old'));
  mkdirSync(join(runs, '.tmp-new'));
  const hourAgo = new Date(Date.now() - 3600_000);
  utimesSync(join(runs, '.tmp-old'), hourAgo, hourAgo);
  await applyRetention(root, 50);
  assert.equal(existsSync(join(runs, '.tmp-old')), false);
  assert.equal(existsSync(join(runs, '.tmp-new')), true);
});

test('M3: a restarted serial member frees its old lane', () => {
  const live = createLive();
  const start = (s) => ({ type: 'test-started', at: `2026-07-24T12:00:0${s}.000Z`, testId: 'A', agent: 'default', repeat: 0, title: 'A', file: 'a', target: 'web' });
  live.apply({ type: 'run-started', at: '2026-07-24T12:00:00.000Z', runId: 'r' });
  live.apply(start(1));
  live.apply(start(2));
  live.apply(start(3));
  assert.equal(live.snapshot().lanes, 1);
});

test('M4: the export names a video it left out', () => {
  assert.match(videoNote({ path: 'web/t/attempt-0/video/video.webm' }, null), /video\.webm/);
  assert.equal(videoNote({ path: 'x.webm' }, '/files/x.webm'), '');
  assert.match(videoNote(null, null), /Không có video/);
});

test('M6: archive stops and leaves nothing behind once the signal aborts', async () => {
  const root = tmp();
  let checks = 0;
  const signal = { get aborted() { return ++checks > 1; } };
  const res = await archive(root, { source: 'reporter', report: fixture(), signal });
  assert.deepEqual(res, { status: 'skipped', reason: 'aborted' });
  assert.deepEqual(readdirSync(join(root, '.e2e-dashboard/runs')), []);
});

test('M7: live subscribers share one EventSource', async () => {
  let opened = 0;
  let closed = 0;
  globalThis.EventSource = class { constructor() { opened++; } close() { closed++; } };
  const { liveStream } = await import('../ui/api.js');
  const a = liveStream(() => {});
  const b = liveStream(() => {});
  assert.equal(opened, 1);
  a();
  assert.equal(closed, 0);
  b();
  assert.equal(closed, 1);
  delete globalThis.EventSource;
});

test('ETA (spec §4.4): history of the remaining tests, median for unknown ones, divided by busy lanes', () => {
  const avg = new Map([['a|web|default', 2000], ['b|web|default', 4000], ['c|web|default', 6000]]);
  const snap = {
    status: 'running', total: 4, done: 1, lanes: 2,
    tests: [{ key: 'a|web|default|0', status: 'passed' }, { key: 'b|web|default|0', status: 'running' }],
  };
  // remaining: b (4000) + c (6000) + one test without history (median 4000) = 14000, over 1 busy lane
  assert.equal(estimateEta(snap, avg), 14000);
  assert.equal(estimateEta({ ...snap, tests: [...snap.tests, { key: 'c|web|default|0', status: 'running' }] }, avg), 7000);
});
