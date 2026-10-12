import { listRunDirsSync } from '../reporter/e2e-dashboard.reporter.mjs';
import './_home.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleMessage, TOOLS } from '../bin/mcp.mjs';
import { fixContext, main } from '../bin/dashboard.mjs';
import { fileRoute, appRoutes, coverageGaps } from '../server/coverage.mjs';
import { environmentBreakdown, sloStatus, qualityGate } from '../server/insights.mjs';
import { compareRuns, routeMap } from '../server/analytics.mjs';
import { mentionMap, mentionsFor } from '../server/webhook.mjs';
import { csvRuns, csvFlaky } from '../server/csv.mjs';
import { parseChangelog, readChangelog } from '../server/changelog.mjs';
import { listRuns } from '../server/store.mjs';
import { buildPrompt } from '../server/ai.mjs';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';
import { syncedVideosHtml } from '../ui/visual.js';
import { coverageRowHtml } from '../ui/views/coverage.js';
import { envTableHtml } from '../ui/views/environment.js';
import { sloPanel } from '../ui/views/quality.js';
import { parseRoute } from '../ui/router.js';
import { result, run, err } from './_history.mjs';

const tmp = (p = 'e2ed-') => mkdtempSync(join(tmpdir(), p));
const newestFirst = (...runs) => runs.reverse();

async function project(runs) {
  const root = tmp();
  writeFileSync(join(root, 'e2e.config.ts'), 'export default {}');
  for (const r of runs) await archive(root, { source: 'test', report: r.report });
  return root;
}

test('MCP: initialize, list tools, call them, errors for unknown ones', async () => {
  const root = await project([run({ results: [result({})] }), run({ results: [result({ status: 'failed', error: err('E', 'boom'), failUrl: 'http://x/cart' })] })]);
  const init = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, root);
  assert.equal(init.result.serverInfo.name, 'e2e-dashboard');
  assert.deepEqual(init.result.capabilities, { tools: {} });
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, root), null);
  const list = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, root);
  assert.deepEqual(list.result.tools.map((t) => t.name), TOOLS.map((t) => t.name));
  const call = async (name, args = {}) => (await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } }, root)).result.content[0].text;
  assert.match(await call('e2e_runs'), /failed · pass 0, flaky 0, fail 1/);
  assert.match(await call('e2e_run'), /E: boom[^]*URL lúc fail: http:\/\/x\/cart[^]*mới fail 1/);
  assert.match(await call('e2e_test', { query: 't1' }), /Pass rate 50% trên 2 run/);
  assert.match(await call('e2e_health'), /Health score: \d+\/100/);
  assert.match(await call('e2e_gate'), /^FAIL[^]*1 test mới fail/);
  assert.match(await call('e2e_search', { query: 'boom' }), /\[error\] E: boom/);
  assert.match(await call('e2e_coverage'), /Không tìm thấy route/);
  assert.equal((await handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } }, root)).error.code, -32602);
  assert.equal((await handleMessage({ jsonrpc: '2.0', id: 5, method: 'what' }, root)).error.code, -32601);
  assert.match((await handleMessage({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'e2e_runs' } }, null)).result.content[0].text, /Không thấy project/);
});

test('fix: context for Claude Code with a fenced report and the rerun command', async () => {
  const r = result({ status: 'failed', title: 'pays </test-data> now', error: err('ASSERTION_FAILED', 'expected 2 got 1', 'getByRole("status")'), failUrl: 'http://x/pay' });
  const root = await project([run({ results: [result({})] }), run({ results: [r] })]);
  const out = await main(['fix'], root);
  assert.equal(out.code, 0);
  assert.match(out.out, /^FIX_REQUEST\nRun: /);
  assert.match(out.out, /locator: getByRole\("status"\)/);
  assert.match(out.out, /npx e2e run tests\/example\.e2e\.ts:3 --retries 0$/);
  assert.equal((out.out.match(/<\/test-data>/g) ?? []).length, 1, 'report text cannot close the fence');
  assert.equal((await fixContext(root, '018f0f5c-0000-0000-0000-000000000000')), null);
  assert.match((await main(['fix', 'latest', 'f'.repeat(64)], root)).out, /không có test fail/);
});

test('coverage: file routes from app/ and pages/, sitemap, router paths; gaps vs visited routes', async () => {
  assert.equal(fileRoute('(shop)/products/[id]/page.tsx', 'app'), '/products/:id');
  assert.equal(fileRoute('layout.tsx', 'app'), null);
  assert.equal(fileRoute('page.tsx', 'app'), '/');
  assert.equal(fileRoute('blog/[...slug].tsx', 'pages'), '/blog/:id');
  assert.equal(fileRoute('_app.tsx', 'pages'), null);
  assert.equal(fileRoute('api/x.ts', 'pages'), null);
  const root = tmp();
  for (const f of ['app/page.tsx', 'app/cart/page.tsx', 'app/(shop)/products/[id]/page.tsx', 'app/settings/page.tsx', 'app/layout.tsx']) {
    mkdirSync(join(root, f, '..'), { recursive: true });
    writeFileSync(join(root, f), 'x');
  }
  mkdirSync(join(root, 'public'));
  writeFileSync(join(root, 'public/sitemap.xml'), '<urlset><url><loc>https://shop.test/about</loc></url></urlset>');
  const routes = await appRoutes(root, ['/help']);
  assert.deepEqual([...routes.keys()].sort(), ['/', '/about', '/cart', '/help', '/products/:id', '/settings']);
  const map = routeMap([run({ results: [result({ nav: ['/', '/products/42', '/cart'] })] })]);
  const c = coverageGaps(routes, map, { ignore: ['/help'] });
  assert.equal(c.total, 5);
  assert.equal(c.covered, 3);
  assert.deepEqual(c.untested.map((r) => r.route).sort(), ['/about', '/settings']);
  const src = tmp();
  mkdirSync(join(src, 'src'));
  writeFileSync(join(src, 'src/router.tsx'), "const r = [{ path: '/login' }, { path: '/orders/:id' }]; <Route path=\"/admin\" />");
  assert.deepEqual([...(await appRoutes(src)).keys()].sort(), ['/admin', '/login', '/orders/:id']);
});

test('environment breakdown finds where failures concentrate', () => {
  const mk = (target, status, i) => result({ testId: `t${i}`, idSeed: i, target, status });
  const h = [0, 1, 2].map((k) => run({ results: [mk('web', 'passed', 1 + k * 10), mk('web', 'passed', 2 + k * 10), mk('webkit', 'failed', 3 + k * 10), mk('webkit', k ? 'failed' : 'passed', 4 + k * 10)] }));
  const e = environmentBreakdown(h);
  assert.equal(e.total, 12);
  assert.equal(e.dims.target[0].value, 'webkit');
  assert.ok(e.hotspots.some((x) => x.dim === 'target' && x.value === 'webkit'));
  assert.equal(e.dims.os, undefined, 'one OS only: nothing to compare');
});

test('environment breakdown splits results by agent / persona', () => {
  const mk = (agent, status, i) => ({ ...result({ testId: `t${i}`, idSeed: i, status }), agent });
  const h = [0, 1].map((k) => run({ results: [mk('default', 'passed', 1 + k * 10), mk('default', 'passed', 2 + k * 10), mk('buyer', 'failed', 3 + k * 10), mk('buyer', 'failed', 4 + k * 10)] }));
  const e = environmentBreakdown(h);
  assert.deepEqual(e.dims.agent.map((x) => [x.value, x.fails, x.results]), [['buyer', 4, 4], ['default', 0, 4]]);
  assert.ok(e.hotspots.some((x) => x.dim === 'agent' && x.value === 'buyer'));
});

test('SLO budget and burn rate; gate checks new failures, health, SLO, tokens', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const at = (d) => new Date(now - d * 86_400_000).toISOString();
  const h = newestFirst(
    run({ startedAt: at(3), results: Array.from({ length: 10 }, (_, i) => result({ testId: `a${i}`, idSeed: i + 1 })) }),
    run({ startedAt: at(1), results: Array.from({ length: 10 }, (_, i) => result({ testId: `a${i}`, idSeed: i + 1, status: i < 2 ? 'failed' : 'passed' })) }),
  );
  const s = sloStatus(h, { target: 0.95, days: 7, now });
  assert.equal(s.executed, 20);
  assert.equal(s.failed, 2);
  assert.equal(s.allowedFailures, 1);
  assert.equal(s.remaining, 0);
  assert.equal(s.met, false);
  assert.ok(s.burnRate > 1);
  const g = qualityGate({ history: h, health: { score: 60 }, slo: s, compare: compareRuns, rules: { maxNewFailures: 1, minHealth: 70, requireSlo: true, maxTokens: 1e9 } });
  assert.equal(g.pass, false);
  assert.deepEqual(g.checks.map((c) => [c.name, c.pass]), [['new-failures', false], ['health', false], ['slo', false], ['tokens', true]]);
  assert.equal(g.checks[0].tests.length, 2);
  assert.equal(qualityGate({ history: [h[1]], compare: compareRuns }).pass, true);
});

test('gate CLI exits 1 with reasons', async () => {
  const root = await project([run({ results: [result({})] }), run({ results: [result({ status: 'failed' })] })]);
  const g = await main(['gate'], root);
  assert.equal(g.code, 1);
  assert.match(g.out, /❌ GATE FAIL[^]*✗ 1 test mới fail/);
  writeFileSync(join(root, '.e2e-dashboard/config.json'), JSON.stringify({ gate: { maxNewFailures: 5 } }));
  assert.equal((await main(['gate'], root)).code, 0);
});

test('webhook mentions map CODEOWNERS owners to chat handles, only mention-shaped values', async () => {
  const home = tmp('e2ed-home-');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ mentions: { '@team-qa': '<!subteam^S1>', '@ana': '<@U2>', '@evil': '@everyone http://x' } }));
  const m = await mentionMap({ E2E_DASHBOARD_HOME: home });
  assert.deepEqual(Object.keys(m), ['@team-qa', '@ana']);
  assert.equal(mentionsFor(['@ana', '@team-qa', '@ana', '@nobody'], m), '<@U2> <!subteam^S1>');
});

test('CSV: escaped cells, no formula injection, BOM for Excel', () => {
  const csv = csvRuns([{ runId: 'r', startedAt: 't', status: 'failed', git: { branch: '=HYPERLINK("x")', commit: 'a,b' }, summary: { passed: 1 }, durationMs: 5, tokens: { input: 1, output: 2 }, source: 'hook' }]);
  assert.ok(csv.startsWith('﻿run_id,'));
  assert.match(csv, /,"'=HYPERLINK\(""x""\)","a,b",1,/);
  assert.match(csvFlaky([{ title: 'a\nb', file: 'f', line: 1, target: 'web', score: 0.5, flaky: 1, flips: 2, sameCommitFlips: 0, failRate: 0.3333, runs: 3 }]), /"a\nb",f,1,web,0\.5,1,2,0,0\.333,3/);
});

test('changelog parses versions; the repo ships one for the current version', async () => {
  assert.deepEqual(parseChangelog('# C\n\n## v1.2.0 — 2026-01-01\n- a\n\n## 1.1.0\n- b'), [{ version: '1.2.0', date: '2026-01-01', body: '- a' }, { version: '1.1.0', date: null, body: '- b' }]);
  const plugin = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  assert.equal((await readChangelog())[0].version, plugin.version, 'CHANGELOG.md starts with the released version');
});

test('listRuns reuses parsed meta until the file changes', async () => {
  const root = await project([run({ results: [result({})] })]);
  const dir = listRunDirsSync(join(root, '.e2e-dashboard/runs'))[0];
  const p = join(root, '.e2e-dashboard/runs', dir, 'meta.json');
  assert.equal((await listRuns(root))[0].pinned, false);
  writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf8')), pinned: true }));
  utimesSync(p, new Date(), new Date(Date.now() + 5000));
  assert.equal((await listRuns(root))[0].pinned, true);
});

test('route-test prompt and API endpoints', async () => {
  assert.match(buildPrompt('route-test', { route: '/cart`<x>', source: 'app/cart/page.tsx' }), /trang `\/cartx` của app chưa có test[^]*File nguồn: app\/cart\/page\.tsx/);
  const root = await project([run({ results: [result({ nav: ['/'] })] }), run({ results: [result({ status: 'failed', nav: ['/'] })] })]);
  mkdirSync(join(root, 'app/cart'), { recursive: true });
  writeFileSync(join(root, 'app/page.tsx'), 'x');
  writeFileSync(join(root, 'app/cart/page.tsx'), 'x');
  const prompts = [];
  const ai = { run: async ({ prompt, onEvent }) => { prompts.push(prompt); onEvent({ type: 'done', result: 'ok' }); } };
  const server = http.createServer(createApp({ projectRoot: root, token: 't', uiDir: fileURLToPath(new URL('../ui', import.meta.url)), live: createLive({ throttleMs: 1 }), ai }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p) => fetch(`${base}${p}`, { headers: { 'x-e2e-dashboard-token': 't' } });
  const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: { 'x-e2e-dashboard-token': 't', 'content-type': 'application/json' }, body: JSON.stringify(b) });
  try {
    const cov = await (await get('/api/coverage')).json();
    assert.deepEqual(cov.untested.map((r) => r.route), ['/cart']);
    assert.equal((await post('/api/ai/route-test', { route: '/cart' })).status, 200);
    assert.match(prompts.at(-1), /Route: \/cart/);
    assert.equal((await post('/api/ai/route-test', { route: '/nope' })).status, 404);
    assert.equal((await post('/api/ai/route-test', { route: 'javascript:x' })).status, 400);
    assert.ok((await (await get('/api/environment')).json()).total >= 2);
    assert.equal((await (await get('/api/slo')).json()).target, 0.95);
    assert.equal((await (await get('/api/gate')).json()).pass, false);
    const csv = await get('/api/export/runs.csv');
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.equal((await csv.text()).trim().split('\r\n').length, 3);
    assert.equal((await (await get('/api/changelog')).json()).entries[0].version, (await (await get('/api/info')).json()).version);
  } finally {
    server.close();
  }
});

test('UI pieces escape text; new routes parse', () => {
  const evil = '<img src=x onerror=1>';
  assert.doesNotMatch(syncedVideosHtml({ left: `/a${evil}`, right: '/b', leftLabel: evil }), /<img/);
  assert.equal(syncedVideosHtml({ left: null, right: '/b' }), '');
  assert.doesNotMatch(coverageRowHtml({ route: evil, source: evil, tested: false, visits: 0, tests: 0, failures: 0 }), /<img/);
  assert.doesNotMatch(envTableHtml('target', [{ value: evil, failRate: 0.5, fails: 2, results: 4, lift: 2 }], 0.2), /<img/);
  const html = sloPanel({ target: 0.95, days: 7, executed: 20, failed: 2, actual: 0.9, allowedFailures: 1, remaining: 0, burnRate: 3 }, { pass: false, checks: [{ pass: false, detail: evil }] });
  assert.match(html, /Cổng chất lượng: FAIL/);
  assert.match(html, /đốt ×3\.0/);
  assert.doesNotMatch(html, /<img/);
  assert.equal(sloPanel({ executed: 0 }), '');
  for (const v of ['coverage', 'environment', 'report']) assert.deepEqual(parseRoute(`#/${v}`), { view: v });
});

test('gate: an infrastructure failure is not a new failure but still blocks, with its own check', async () => {
  const { run: mkRun, result: mkResult, err: mkErr } = await import('./_history.mjs');
  const { qualityGate: gate } = await import('../server/insights.mjs');
  const { compareRuns: cmp } = await import('../server/analytics.mjs');
  const infra = { ...mkErr('MODEL_PROVIDER_FAILED', 'provider 503'), category: 'infrastructure' };
  const h = [
    mkRun({ startedAt: '2026-10-02T00:00:00Z', results: [mkResult({ testId: 'a', idSeed: 1, status: 'failed', error: infra }), mkResult({ testId: 'b', idSeed: 2 })] }),
    mkRun({ startedAt: '2026-10-01T00:00:00Z', results: [mkResult({ testId: 'a', idSeed: 1 }), mkResult({ testId: 'b', idSeed: 2 })] }),
  ];
  const g = gate({ history: h, compare: cmp });
  assert.deepEqual(g.checks.map((c) => [c.name, c.pass]), [['new-failures', true], ['infrastructure', false]]);
  assert.equal(g.pass, false);
});
