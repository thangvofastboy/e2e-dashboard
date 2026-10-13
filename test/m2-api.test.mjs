const NO_MCP = async () => ({ servers: [], connected: false, prefixes: [], needsAuth: false, installed: true }); // không gọi `claude mcp list` thật trong test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { createApp, readCacheEntry } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';
import { registerProject } from '../server/projects.mjs';
import { result, run, err } from './_history.mjs';

const TOKEN = 'tok-m2';
const UI = fileURLToPath(new URL('../ui', import.meta.url));
const ENTRY = 'c'.repeat(64);
let server, base, root, runs, prompts, linearCalls, linearState;
const env = { E2E_DASHBOARD_HOME: mkdtempSync(join(tmpdir(), 'e2ed-home-')), LINEAR_API_KEY: 'lin_api_test123456', LINEAR_TEAM: 'ENG' };

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'e2ed-m2-'));
  writeFileSync(join(root, 'e2e.config.ts'), 'export default {}');
  runs = [
    run({ branch: 'main', results: [result({ testId: 'cart', entry: ENTRY, nav: ['/', '/cart'] }), result({ testId: 'login', idSeed: 2, entry: ENTRY })] }),
    run({ branch: 'main', results: [result({ testId: 'cart', entry: ENTRY, status: 'failed', error: err('ASSERTION_FAILED', 'has 1 item'), nav: ['/', '/cart'], failUrl: 'http://x/cart' }), result({ testId: 'login', idSeed: 2, entry: ENTRY })] }),
    run({ branch: 'feat/x', results: [result({ testId: 'cart', entry: ENTRY }), result({ testId: 'login', idSeed: 2, entry: ENTRY, status: 'failed', error: err('ASSERTION_FAILED', 'has 2 item') })] }),
  ];
  for (const r of runs) await archive(root, { source: 'test', report: r.report });
  mkdirSync(join(root, '.e2e/cache'), { recursive: true });
  writeFileSync(join(root, `.e2e/cache/${ENTRY}.json`), JSON.stringify({ schemaVersion: 'trace-1', createdAt: 'x', payload: { summary: 'adds', actions: [{ name: 'tap', target: { role: 'button', name: 'Add' } }] } }));
  await registerProject(root, env);
  prompts = [];
  linearCalls = [];
  linearState = { open: null };
  const linearFetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    linearCalls.push(body);
    if (body.query.includes('issues(')) return Response.json({ data: { issues: { nodes: linearState.open ? [linearState.open] : [] } } });
    if (body.query.includes('teams')) return Response.json({ data: { teams: { nodes: [{ id: 'team-1', key: 'ENG', name: 'Eng' }] } } });
    if (body.query.includes('issueCreate')) {
      linearState.open = { id: 'i1', identifier: 'ENG-7', url: 'https://linear.app/x/issue/ENG-7', title: body.variables.input.title, state: { name: 'Todo', type: 'unstarted' } };
      return Response.json({ data: { issueCreate: { success: true, issue: linearState.open } } });
    }
    if (body.query.includes('issue(id:')) return body.variables.id === 'ENG-42' ? Response.json({ data: { issue: { id: 'i42', identifier: 'ENG-42', url: 'https://linear.app/x/issue/ENG-42', title: 'Checkout lỗi', state: { name: 'In Progress', type: 'started' } } } }) : Response.json({ errors: [{ message: 'Entity not found: Issue' }] });
    if (body.query.includes('commentCreate')) return Response.json({ data: { commentCreate: { success: true } } });
    return Response.json({ errors: [{ message: 'unexpected' }] });
  };
  const ai = {
    run: async ({ prompt, onEvent }) => {
      prompts.push(prompt);
      onEvent({ type: 'done', result: '## Code đề xuất\nok' });
    },
  };
  server = http.createServer(createApp({ projectRoot: root, token: TOKEN, uiDir: UI, live: createLive({ throttleMs: 1 }), ai, env, linearFetch, mcpDetect: NO_MCP }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const auth = { 'x-e2e-dashboard-token': TOKEN };
const get = async (p) => {
  const res = await fetch(`${base}${p}`, { headers: auth });
  return { status: res.status, body: await res.json() };
};
const post = async (p, body) => {
  const res = await fetch(`${base}${p}`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text.startsWith('data:') ? text : JSON.parse(text) };
};

test('analysis endpoints answer from the archived runs', async () => {
  const flaky = (await get('/api/flaky?n=10')).body.tests;
  assert.deepEqual(flaky.map((t) => t.title).sort(), ['cart', 'login']);
  const errors = (await get('/api/errors')).body.groups;
  assert.equal(errors.length, 1);
  assert.equal(errors[0].tests.length, 2, 'same error shape across two tests');
  assert.equal((await get(`/api/errors?runId=${runs[1].meta.runId}`)).body.groups[0].count, 1);
  assert.equal((await get('/api/errors?runId=018f0f5c-0000-0000-0000-000000000000')).status, 404);
  const cost = (await get('/api/cost')).body;
  assert.equal(cost.runs.length, 3);
  assert.ok(cost.slowSteps.length);
  const routes = (await get('/api/routes')).body;
  assert.equal(routes.nodes.find((n) => n.route === '/cart').failures, 1);
  const health = (await get('/api/health')).body.health;
  assert.ok(health.score > 0 && health.score <= 100);
});

test('compare: two runs by id, 404 for unknown ones', async () => {
  const { status, body } = await get(`/api/compare?a=${runs[0].meta.runId}&b=${runs[1].meta.runId}`);
  assert.equal(status, 200);
  assert.equal(body.counts.regressed, 1);
  assert.equal(body.rows[0].title, 'cart');
  assert.equal((await get(`/api/compare?a=${runs[0].meta.runId}&b=../../etc`)).status, 404);
});

test('branches: list and compare', async () => {
  const { branches } = (await get('/api/branches')).body;
  assert.deepEqual(branches.map((b) => b.branch), ['feat/x', 'main']);
  const c = (await get('/api/branches/compare?a=main&b=feat%2Fx')).body;
  assert.equal(c.rows[0].title, 'login');
  assert.equal(c.rows[0].delta, -1);
  assert.equal((await get('/api/branches/compare?a=main')).status, 400);
});

test('projects and digest', async () => {
  const p = (await get('/api/projects')).body.projects;
  assert.equal(p[0].current, true);
  assert.equal(p[0].runs, 3);
  const d = (await get('/api/digest?days=3650')).body;
  assert.match(d.markdown, /^# Digest e2e/);
  assert.equal(d.runs, 3);
  assert.equal((await post('/api/projects/forget', { root })).body.removed, true);
});

test('locators: candidates with code read from the e2e replay cache', async () => {
  const { candidates } = (await get('/api/locators?n=10')).body;
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].suggestion.code, "await screen.getByRole('button', 'Add').tap();");
});

test('readCacheEntry stays inside the project and refuses odd names', async () => {
  assert.equal((await readCacheEntry(root, ENTRY)).schemaVersion, 'trace-1');
  assert.equal(await readCacheEntry(root, '../e2e.config'), null);
  assert.equal(await readCacheEntry(root, ENTRY, { cacheDir: '../..' }), null);
  const evil = mkdtempSync(join(tmpdir(), 'e2ed-evil-'));
  writeFileSync(join(evil, `${'d'.repeat(64)}.json`), '{"secret":1}');
  symlinkSync(join(evil, `${'d'.repeat(64)}.json`), join(root, `.e2e/cache/${'d'.repeat(64)}.json`));
  assert.equal(await readCacheEntry(root, 'd'.repeat(64)), null, 'a planted symlink is not followed');
});

test('suggest-locator: AI prompt carries the step and the draft from the cache', async () => {
  const r = runs[0].report.run.results[0];
  const res = await post('/api/ai/suggest-locator', { runId: runs[0].meta.runId, resultId: r.id, stepIndex: 0 });
  assert.equal(res.status, 200);
  assert.match(prompts.at(-1), /agent\.act "adds shoes to the cart"/);
  assert.match(prompts.at(-1), /screen\.getByRole\('button', 'Add'\)\.tap\(\)/);
  assert.equal((await post('/api/ai/suggest-locator', { runId: runs[0].meta.runId, resultId: r.id, stepIndex: 9 })).status, 404);
  assert.equal((await post('/api/ai/suggest-locator', { runId: runs[0].meta.runId, resultId: r.id, stepIndex: '0' })).status, 400);
  const again = await post('/api/ai/suggest-locator', { runId: runs[0].meta.runId, resultId: r.id, stepIndex: 0 });
  assert.match(again.body, /"type":"cached"/);
});

test('Linear: draft, create once, then duplicate, then comment', async () => {
  const runId = runs[1].meta.runId;
  const resultId = runs[1].report.run.results[0].id;
  const draft = (await post('/api/linear/draft', { runId, resultId })).body;
  assert.equal(draft.configured, true);
  assert.equal(draft.team, 'ENG');
  assert.match(draft.prompt, /Linear MCP/);
  assert.equal(draft.link, null);
  const created = await post('/api/linear/issue', { runId, resultId });
  assert.equal(created.status, 201);
  assert.equal(created.body.issue.identifier, 'ENG-7');
  assert.equal(linearCalls.find((c) => c.query.includes('issueCreate')).variables.input.teamId, 'team-1');
  const filed = runs[1].report.run.results[0];
  assert.equal((await get('/api/qc/notes')).body[`${filed.testId}|${filed.targetId}|${filed.agent ?? 'default'}`]?.known, 'ENG-7', 'a test sent to Linear is a known bug');
  const dup = await post('/api/linear/issue', { runId, resultId });
  assert.equal(dup.body.status, 'duplicate');
  assert.equal(linearCalls.filter((c) => c.query.includes('issueCreate')).length, 1, 'no second issue');
  const commented = await post('/api/linear/issue', { runId, resultId, mode: 'comment' });
  assert.equal(commented.body.status, 'commented');
  assert.match(linearCalls.at(-1).variables.input.body, new RegExp(runId));
  assert.equal((await get('/api/linear')).body.links[draft.draft.fingerprint].identifier, 'ENG-7');
  assert.equal((await post('/api/linear/draft', { runId, resultId })).body.link.identifier, 'ENG-7');
  assert.equal((await post('/api/linear/issue', { runId, resultId: 'f'.repeat(64) })).status, 404);
});

test('Linear: attach an existing issue to a bug: verified, known, and no second issue is created', async () => {
  const runId = runs[0].meta.runId;
  const r = runs[0].report.run.results[0];
  linearState.open = null;
  const before = linearCalls.filter((c) => c.query.includes('issueCreate')).length;
  assert.equal((await post('/api/linear/attach', { runId, resultId: r.id, ref: 'không có mã' })).status, 400);
  assert.equal((await post('/api/linear/attach', { runId, resultId: r.id, ref: 'ENG-999' })).status, 404, 'Linear does not know it');
  const ok = await post('/api/linear/attach', { runId, resultId: r.id, ref: 'https://linear.app/x/issue/eng-42/checkout-loi' });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.issue.identifier, ok.body.issue.title, ok.body.verified], ['ENG-42', 'Checkout lỗi', true]);
  const notes = (await get('/api/qc/notes')).body;
  assert.equal(notes[`${r.testId}|${r.targetId}|${r.agent ?? 'default'}`].known, 'ENG-42');
  assert.equal((await post('/api/linear/draft', { runId, resultId: r.id })).body.link.identifier, 'ENG-42');
  const send = await post('/api/linear/issue', { runId, resultId: r.id });
  assert.equal(send.body.status, 'duplicate', 'the attached issue is not duplicated');
  assert.equal(send.body.issue.identifier, 'ENG-42');
  assert.equal(linearCalls.filter((c) => c.query.includes('issueCreate')).length, before, 'no issue created');
});

test('Linear: detach removes the known-bug mark and the saved link, and leaves the Linear issue alone', async () => {
  const runId = runs[0].meta.runId;
  const r = runs[0].report.run.results[0];
  const key = `${r.testId}|${r.targetId}|${r.agent ?? 'default'}`;
  await post('/api/linear/attach', { runId, resultId: r.id, ref: 'ENG-42' });
  assert.equal((await get('/api/qc/notes')).body[key].known, 'ENG-42');
  const calls = linearCalls.length;
  const out = await post('/api/linear/detach', { runId, resultId: r.id });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.removed, { known: 'ENG-42', link: 'ENG-42' });
  assert.equal((await get('/api/qc/notes')).body[key]?.known ?? null, null);
  assert.equal((await post('/api/linear/draft', { runId, resultId: r.id })).body.link, null);
  assert.equal(linearCalls.length, calls, 'detach never talks to Linear (the issue is left alone)');
  assert.deepEqual((await post('/api/linear/detach', { runId, resultId: r.id })).body.removed, { known: null, link: null }, 'detaching twice is harmless');
  assert.equal((await post('/api/linear/detach', { runId, resultId: 'f'.repeat(64) })).status, 404);
});

