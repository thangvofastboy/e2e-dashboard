// Hồi quy cho các lỗi tìm thấy khi review nhóm B (ai, aitrace, linear, linear-mcp, autobug, selfheal, dupes).
import './_home.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, result, err } from './_history.mjs';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { parseStreamLine } from '../server/ai.mjs';
import { aiTraceView } from '../server/aitrace.mjs';
import { createLinear } from '../server/linear.mjs';
import { createMcpLinear } from '../server/linear-mcp.mjs';
import { autoLogBugs } from '../server/autobug.mjs';
import { createSelfHeal } from '../server/selfheal.mjs';
import { findDuplicates, splitCandidates } from '../server/dupes.mjs';

test('parseStreamLine: malformed stream-json lines yield nothing instead of throwing (a throw in the data handler kills the server)', () => {
  assert.deepEqual(parseStreamLine('null'), []);
  assert.deepEqual(parseStreamLine('42'), []);
  assert.deepEqual(parseStreamLine('{"type":"assistant","message":{"content":"plain string"}}'), []);
  assert.deepEqual(parseStreamLine('{"type":"assistant","message":{"content":[null,{"type":"text","text":"ok"}]}}'), [{ type: 'text', text: 'ok' }]);
});

test('aiTraceView: null entries and non-array prompt / messages in ai-trace.json do not crash the view', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2ed-rb-trace-'));
  writeFileSync(join(dir, 'ai-trace.json'), JSON.stringify({
    runs: [null, { id: 'r1' }],
    steps: [null, { id: 's1', run_id: 'r1', input: JSON.stringify({ prompt: 5, tools: 'x' }), output: JSON.stringify({ response: { messages: { a: 1 } } }) }],
  }));
  const v = await aiTraceView(dir);
  assert.equal(v.runs.length, 1);
  assert.equal(v.runs[0].calls.length, 1);
  assert.equal(v.runs[0].calls[0].messages, 0);
  assert.equal(v.runs[0].calls[0].tools, 0);
});

test('Linear client: a null / data-less GraphQL body is a Linear error, not a TypeError', async () => {
  for (const payload of [null, {}]) {
    const linear = createLinear({ apiKey: 'lin_api_xxxxxxxxxx', fetchImpl: async () => ({ ok: true, status: 200, json: async () => payload }) });
    await assert.rejects(linear.find('e2ed-0123456789ab'), /^Error: Linear: HTTP 200/);
  }
});

test('Linear MCP: <result>null</result> is reported as an invalid result, not a TypeError', async () => {
  const ai = { run: async ({ onEvent }) => onEvent({ type: 'done', isError: false, result: '<result>null</result>' }) };
  const linear = createMcpLinear({ ai });
  await assert.rejects(linear.find('e2ed-0123456789ab'), /không trả về kết quả hợp lệ/);
  await assert.rejects(linear.get('ENG-1'), /không trả về kết quả hợp lệ/);
});

test('autoLogBugs: two archive passes at the same time create one issue, not two', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-rb-autobug-'));
  const { meta, report } = run({ results: [result({ testId: 'a', status: 'failed', error: { ...err('ASSERTION_FAILED', 'boom'), category: 'test' } })] });
  await archive(root, { source: 'hook', report });
  const created = [];
  const linear = {
    find: async () => { await new Promise((r) => setTimeout(r, 20)); return { open: null, closed: [] }; },
    create: async (d) => { created.push(d); return { id: `id-${created.length}`, identifier: `ENG-${created.length}`, url: 'https://linear.app/x' }; },
  };
  const [a, b] = await Promise.all([autoLogBugs({ projectRoot: root, runId: meta.runId, linear }), autoLogBugs({ projectRoot: root, runId: meta.runId, linear })]);
  assert.deepEqual([a.status, b.status].sort(), ['already-handled', 'done']);
  assert.equal(created.length, 1);
});

test('autoLogBugs: a pass that could not run (run not archived yet) does not block the next pass', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-rb-autobug-'));
  const { meta, report } = run({ results: [result({ testId: 'a', idSeed: 7, status: 'failed', error: { ...err('ASSERTION_FAILED', 'boom'), category: 'test' } })] });
  const linear = { find: async () => ({ open: null, closed: [] }), create: async () => ({ id: 'i', identifier: 'ENG-9', url: 'https://linear.app/x' }) };
  assert.equal((await autoLogBugs({ projectRoot: root, runId: meta.runId, linear })).status, 'no-run');
  await archive(root, { source: 'hook', report });
  assert.equal((await autoLogBugs({ projectRoot: root, runId: meta.runId, linear })).status, 'done');
});

test('selfheal: "Phân tích lại" while the fix is running is refused (it would overwrite the fix and orphan its branch)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'e2ed-rb-heal-home-'));
  const repo = mkdtempSync(join(tmpdir(), 'e2ed-rb-heal-repo-'));
  mkdirSync(join(repo, '.git'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({ selfHeal: { enabled: true, repo } }));
  let release;
  const fixing = new Promise((r) => { release = r; });
  let fixRuns = 0;
  const aiFactory = ({ args }) => ({
    run: async ({ onEvent }) => {
      if (args.includes('Read,Grep,Glob,Edit,Write')) {
        fixRuns++;
        await fixing;
        return onEvent({ type: 'done', result: 'sửa' });
      }
      onEvent({ type: 'done', result: '{"verdict":"dashboard-bug","confidence":0.9,"summary":"x","files":["server/store.mjs"]}' });
    },
  });
  const runCmd = async (cmd, args) => (cmd === 'git' && args.includes('--name-only') ? 'server/store.mjs\0' : cmd === 'git' && args[0] === 'rev-parse' ? 'a'.repeat(40) : '');
  const heal = createSelfHeal({ projectRoot: mkdtempSync(join(tmpdir(), 'e2ed-rb-heal-p-')), env: { E2E_DASHBOARD_HOME: home }, aiFactory, run: runCmd });
  const e = await heal.report({ source: 'server', message: 'boom', stack: 'TypeError: boom\n    at x (/p/server/store.mjs:1:1)' });
  for (let i = 0; i < 200 && (await heal.list())[0]?.status !== 'fixing'; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal((await heal.list())[0].status, 'fixing');
  assert.equal(await heal.retry(e.fingerprint), false);
  release();
  for (let i = 0; i < 200 && (await heal.list())[0]?.status !== 'awaiting-review'; i++) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal((await heal.list())[0].status, 'awaiting-review');
  assert.equal(fixRuns, 1);
});

test('dupes: tests in a serial group (steps live on the group, not the result) are still compared', () => {
  const steps = (n) => Array.from({ length: n }, (_, i) => ({ index: i, api: 'agent.act', label: `step ${i}`, status: 'passed', events: i % 5 === 0 ? [{ kind: 'navigation' }] : [] }));
  const { report } = run({ results: [result({ testId: 's1', idSeed: 11 }), result({ testId: 's2', idSeed: 12 })] });
  for (const r of report.run.results) {
    delete r.attempts;
    r.serialGroupId = 'g1';
  }
  report.run.serialGroups = [{ id: 'g1', attempts: [{ members: report.run.results.map((r) => ({ testId: r.testId, status: 'passed', steps: steps(16) })) }] }];
  assert.deepEqual(findDuplicates(report).map((g) => g.kind), ['same-steps']);
  assert.equal(splitCandidates(report).length, 2);
});
