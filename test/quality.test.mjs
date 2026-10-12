import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, result } from './_history.mjs';
import { checksFor, analyzeQuality } from '../server/quality.mjs';

const st = (api, label = 'x', extra = {}) => ({ api, label, status: 'passed', events: [], ...extra });
const withSteps = (r, steps, durationMs = 1000) => { r.attempts[0].steps = steps; r.attempts[0].durationMs = durationMs; return r; };

test('a test with no assertion loses the most points', () => {
  const r = withSteps(result({ testId: 'a', idSeed: 1 }), [st('agent.act', 'open')]);
  const ids = checksFor(r).map((c) => c.id);
  assert.ok(ids.includes('no-assert'));
  assert.ok(ids.includes('agent-only'));
});

test('an assertion step (expect or agent.assert) clears the no-assert check', () => {
  const a = withSteps(result({ testId: 'a', idSeed: 1 }), [st('agent.act'), st('agent.assert', 'total shown')]);
  const b = withSteps(result({ testId: 'b', idSeed: 2 }), [st('expect', 'title visible')]);
  assert.equal(checksFor(a).some((c) => c.id === 'no-assert'), false);
  assert.equal(checksFor(b).some((c) => c.id === 'no-assert'), false);
});

test('flakiness, duplicates and length are penalised with their reason', () => {
  const steps = Array.from({ length: 16 }, () => st('expect'));
  const r = withSteps(result({ testId: 'a', idSeed: 1 }), steps, 90_000);
  const ids = checksFor(r, { flaky: 0.4, dupes: new Set([r.testId]), split: new Set([r.testId]) }).map((c) => c.id);
  for (const id of ['flaky', 'duplicate', 'long', 'slow', 'split']) assert.ok(ids.includes(id), id);
});

test('analyzeQuality ranks the newest run worst first and clamps at zero', () => {
  const good = withSteps(result({ testId: 'good', idSeed: 1 }), [st('agent.act'), st('expect', 'shown')]);
  const bad = withSteps(result({ testId: 'bad', idSeed: 2 }), [st('agent.act', '')]);
  const h = run({ results: [good, bad], startedAt: '2026-10-08T00:00:00Z' });
  const { rows, runId } = analyzeQuality([{ meta: h.meta, report: h.report }]);
  assert.equal(runId, h.meta.runId);
  assert.equal(rows[0].title, 'bad');
  assert.ok(rows[0].score < rows[1].score);
  assert.ok(rows.every((r) => r.score >= 0 && r.score <= 100));
  assert.deepEqual(analyzeQuality([]), { runId: null, rows: [] });
});
