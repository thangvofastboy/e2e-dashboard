import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarize, runDirName } from '../reporter/e2e-dashboard.reporter.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));

test('summarize counts tokens, model calls and replay across all steps', () => {
  const m = summarize(fixture(), { source: 'hook' });
  assert.equal(m.runId, '018f0f5c-7b2a-7abc-8abc-0123456789ab');
  assert.equal(m.status, 'failed');
  assert.equal(m.kind, 'run');
  assert.equal(m.durationMs, 1000);
  assert.deepEqual(m.summary, fixture().run.summary);
  assert.ok(m.tokens.input > 0 && m.tokens.output > 0);
  assert.ok(m.modelCalls >= 1);
  assert.ok(m.replay.total >= m.replay.replayed);
  assert.deepEqual(m.targets, ['web']);
  assert.equal(m.source, 'hook');
  assert.equal(m.pinned, false);
});

test('summarize prefers run.vcs over the git fallback', () => {
  const r = fixture();
  r.run.vcs = { commit: 'a'.repeat(40), branch: 'main', dirty: true };
  const m = summarize(r, { source: 'hook', git: { commit: 'b'.repeat(40), branch: 'x', dirty: false } });
  assert.deepEqual(m.git, { commit: 'a'.repeat(40), branch: 'main', dirty: true });
});

test('interrupted run without finishedAt has null duration', () => {
  const r = fixture();
  r.run.status = 'interrupted';
  delete r.run.finishedAt;
  const m = summarize(r, { source: 'watcher' });
  assert.equal(m.finishedAt, null);
  assert.equal(m.durationMs, null);
  assert.equal(m.status, 'interrupted');
});

test('explore runs are marked as explore', () => {
  const r = fixture();
  r.run.explore = { goal: 'x' };
  assert.equal(summarize(r, { source: 'hook' }).kind, 'explore');
});

test('runDirName is filesystem safe and ends with the run id', () => {
  assert.equal(runDirName(fixture()), '2026-07-24T12-00-00-000Z_018f0f5c-7b2a-7abc-8abc-0123456789ab');
});

test('errorClasses groups failures by e2e error category; infrastructure leaves the pass rate', async () => {
  const { passRate } = await import('../ui/health.js');
  const r = fixture();
  const ok = { status: 'passed', attempts: [] };
  const bad = (category) => ({ status: 'failed', attempts: [{ error: { code: 'X', category, message: 'm' } }] });
  r.run.results = [ok, bad('test'), bad('infrastructure'), bad('configuration'), { status: 'failed', attempts: [] }];
  r.run.errors = [{ code: 'REPORT_WRITE_FAILED', message: 'x' }];
  const m = summarize(r, { source: 'hook' });
  assert.deepEqual(m.errorClasses, { test: 2, infrastructure: 1, configuration: 1 });
  assert.equal(m.runErrors, 1);
  const meta = { summary: { passed: 1, failed: 4 }, errorClasses: m.errorClasses };
  assert.equal(passRate(meta), 1 / 3); // 1 pass, 2 real failures; 2 non-test failures ignored
  assert.equal(passRate({ summary: { passed: 1, failed: 4 } }), 1 / 5); // older run: unchanged
  assert.equal(passRate({ summary: { failed: 2 }, errorClasses: { infrastructure: 2 } }), null);
});
