import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { aiTraceView, aiTraceCall, usageOf } from '../server/aitrace.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));
const put = (root, rel, c) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), c); };

const doc = (startedAt) => ({
  runs: [
    { id: 'r1', started_at: startedAt, parent_run_id: null, parent_step_id: null, function_id: 'checkout · agent.act "pay"', e2e: { test: 'checkout', testId: 't1', target: 'web', agent: 'default', attempt: 0, api: 'agent.act', label: 'pay' } },
    { id: 'r2', started_at: startedAt, parent_run_id: null, parent_step_id: null, function_id: 'other', e2e: { test: 'other', testId: 't2', target: 'web', agent: 'default', attempt: 0 } },
  ],
  steps: [
    { id: 's1', run_id: 'r1', step_number: 0, type: 'generate', model_id: 'm-1', provider: 'p', started_at: startedAt, duration_ms: 1200, input: JSON.stringify({ prompt: [{ role: 'system', content: 'sys' }, { role: 'user', content: [{ type: 'text', text: 'click   pay' }, { type: 'image' }] }], tools: [{ name: 'click' }] }), output: JSON.stringify({ content: [{ type: 'text', text: 'done' }], finishReason: 'stop' }), usage: JSON.stringify({ inputTokens: 100, outputTokens: 20 }), error: null },
    { id: 's2', run_id: 'r2', step_number: 0, type: 'generate', model_id: 'm-1', provider: 'p', started_at: startedAt, duration_ms: null, input: '{}', output: null, usage: null, error: JSON.stringify({ message: 'boom' }) },
  ],
});

function project(traceAt) {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-ai-'));
  const report = fixture();
  put(root, '.e2e/report.json', JSON.stringify(report));
  if (traceAt) put(root, '.e2e/ai-trace.json', JSON.stringify(doc(traceAt)));
  return { root, report };
}

test('archive keeps ai-trace.json of this run and records its size in meta', async () => {
  const { root, report } = project('2026-07-24T12:00:01.000Z');
  const res = await archive(root, { source: 'hook' });
  assert.ok(existsSync(join(res.runDir, 'ai-trace.json')));
  assert.deepEqual(JSON.parse(readFileSync(join(res.runDir, 'meta.json'), 'utf8')).aiTrace, { runs: 2, calls: 2 });
  assert.equal(report.run.startedAt, '2026-07-24T12:00:00.000Z');
});

test('archive ignores an ai-trace.json left over from an older run', async () => {
  const { root } = project('2026-07-01T00:00:00.000Z');
  const res = await archive(root, { source: 'hook' });
  assert.equal(existsSync(join(res.runDir, 'ai-trace.json')), false);
  assert.equal(JSON.parse(readFileSync(join(res.runDir, 'meta.json'), 'utf8')).aiTrace, undefined);
});

test('aiTraceView lists calls with tokens and previews, filters by test; aiTraceCall returns one in full', async () => {
  const { root } = project('2026-07-24T12:00:01.000Z');
  const { runDir } = await archive(root, { source: 'hook' });
  const all = await aiTraceView(runDir);
  assert.deepEqual(all.totals, { calls: 2, input: 100, output: 20, cached: 0, durationMs: 1200, errors: 1 });
  const one = await aiTraceView(runDir, { testId: 't1' });
  assert.equal(one.runs.length, 1);
  const c = one.runs[0].calls[0];
  assert.deepEqual([c.input, c.output, c.durationMs, c.finishReason, c.messages, c.tools], [100, 20, 1200, 'stop', 2, 1]);
  assert.equal(c.prompt, 'click pay [image]');
  assert.equal(c.response, 'done');
  assert.equal(all.runs[1].calls[0].error, 'boom');
  const full = await aiTraceCall(runDir, 's1');
  assert.equal(full.input.prompt[0].content, 'sys');
  assert.equal(await aiTraceCall(runDir, 'nope'), null);
  assert.equal(await aiTraceView(join(root, 'missing')), null);
});

test('usageOf reads both AI SDK usage shapes', () => {
  assert.deepEqual(usageOf('{"inputTokens":{"total":7},"outputTokens":{"total":3}}'), { input: 7, output: 3, cached: 0 });
  assert.deepEqual(usageOf('not json'), { input: 0, output: 0, cached: 0 });
});

test('a hostile ai-trace.json cannot put markup into the page: scope fields are coerced', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'e2ed-evil-trace-'));
  const bad = '<img src=x onerror=alert(1)>';
  writeFileSync(join(dir, 'ai-trace.json'), JSON.stringify({
    runs: [{ id: 'r1', started_at: bad, function_id: bad, e2e: { test: bad, testId: 't1', target: bad, agent: bad, attempt: bad, api: 'agent.act', label: bad } }],
    steps: [{ id: 's1', run_id: 'r1', step_number: bad, model_id: bad, provider: bad, started_at: bad, duration_ms: bad, input: '{}', output: null, usage: JSON.stringify({ inputTokens: bad, outputTokens: bad }), error: null }],
  }));
  const v = await aiTraceView(dir);
  const scope = v.runs[0].scope;
  assert.equal(scope.attempt, 0, 'a string attempt becomes 0, so "attempt + 1" can never concatenate markup');
  assert.equal(typeof scope.attempt, 'number');
  const call = v.runs[0].calls[0];
  assert.deepEqual([call.n, call.input, call.output, call.durationMs], [0, 0, 0, null], 'numbers stay numbers');
  const { readFileSync } = await import('node:fs');
  const ui = readFileSync(new URL('../ui/views/aitrace.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /attempt \$\{r\.scope\.attempt \+ 1\}/, 'the view does not interpolate the attempt unescaped');
});
