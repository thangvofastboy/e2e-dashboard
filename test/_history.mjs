// Builds synthetic archived runs for the M2/M3 tests: {meta, report} pairs, newest first.
import { readFileSync } from 'node:fs';
import { summarize } from '../reporter/e2e-dashboard.reporter.mjs';

const BASE = JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));
const hex = (n, len = 64) => n.toString(16).padStart(len, '0').slice(-len);

// One result. `error` adds a failing attempt error; `cache` sets the agent.act step's cache mode.
export function result({ testId = 't1', title = testId, target = 'web', status = 'passed', error = null, idSeed = 1, nav = [], failUrl = null, cache = 'self-finalized', entry = null, tokens = 100, durationMs = 1000, screenshots = [] }) {
  const r = structuredClone(BASE.run.results[0]);
  r.id = hex(idSeed);
  r.testId = `tests/a.e2e.ts::${testId}`;
  r.titlePath = [title];
  r.targetId = target;
  r.status = status;
  const a = r.attempts[0];
  a.durationMs = durationMs;
  a.status = status === 'flaky' ? 'passed' : status;
  a.error = error;
  a.failure = failUrl ? { url: failUrl } : undefined;
  a.artifacts = screenshots.map((p, i) => ({ id: `${r.id}:s${i}`, kind: 'screenshot', mediaType: 'image/png', path: p }));
  const step = a.steps[0];
  step.index = 0;
  step.events = [
    { kind: 'model', name: 'executor', inputTokens: tokens, outputTokens: Math.round(tokens / 5) },
    ...nav.map((p) => ({ kind: 'navigation', detail: `navigated to ${p}` })),
  ];
  step.cache = cache ? { mode: cache, reason: cache === 'missed' ? 'no-entry' : undefined, replayedActions: cache === 'self-finalized' ? 2 : 0, totalActions: 2, entry: entry ?? hex(999) } : undefined;
  a.steps = [step];
  return r;
}

let seq = 0;
export function run({ results, branch = 'main', commit = 'a'.repeat(40), startedAt, status } = {}) {
  seq++;
  const report = structuredClone(BASE);
  report.run.id = `018f0f5c-7b2a-7abc-8abc-${hex(seq, 12)}`;
  report.run.startedAt = startedAt ?? new Date(Date.parse('2026-10-01T00:00:00Z') + seq * 3600_000).toISOString();
  report.run.finishedAt = new Date(Date.parse(report.run.startedAt) + 60_000).toISOString();
  report.run.results = results;
  report.run.errors = [];
  report.run.vcs = { commit, branch, dirty: false };
  const count = (s) => results.filter((r) => r.status === s).length;
  report.run.summary = { passed: count('passed'), failed: count('failed'), flaky: count('flaky'), interrupted: count('interrupted'), skipped: count('skipped') };
  report.run.status = status ?? (count('failed') || count('interrupted') ? 'failed' : 'passed');
  return { meta: { ...summarize(report, { source: 'test' }), dir: 'x' }, report };
}

export const err = (code, message, locator) => ({ code, message, details: locator ? { locator } : {} });
