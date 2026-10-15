import './_home.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRoute, compareHref, branchesHref } from '../ui/router.js';
import { pixelDiff, screenshotTriplets, visualCompareHtml } from '../ui/visual.js';
import { layoutRoutes, routeGraphSvg } from '../ui/views/routes.js';
import { flakyRowHtml } from '../ui/views/flaky.js';
import { errorGroupHtml } from '../ui/views/errors.js';
import { compareRowHtml } from '../ui/views/compare.js';
import { projectCardHtml } from '../ui/views/projects.js';
import { locatorCardHtml } from '../ui/views/locators.js';
import { branchRowHtml } from '../ui/views/branches.js';
import { healthPanel, runTable } from '../ui/views/overview.js';
import { meter, fmtPct, fmtPoints } from '../ui/analysis.js';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { main, installStatusline } from '../bin/dashboard.mjs';
import { result, run } from './_history.mjs';

test('routes for the M2/M3 pages', () => {
  for (const v of ['flaky', 'errors', 'cost', 'routes', 'projects', 'digest', 'locators']) assert.deepEqual(parseRoute(`#/${v}`), { view: v });
  assert.deepEqual(parseRoute('#/compare/a/b'), { view: 'compare', a: 'a', b: 'b' });
  assert.deepEqual(parseRoute('#/compare/a'), { view: 'notfound' });
  assert.deepEqual(parseRoute('#/branches'), { view: 'branches', a: null, b: null });
  assert.deepEqual(parseRoute(branchesHref('main', 'feat/x')), { view: 'branches', a: 'main', b: 'feat/x' });
  assert.equal(compareHref('a b', 'c'), '#/compare/a%20b/c');
  assert.equal(branchesHref(null, 'x'), '#/branches');
});

test('pixelDiff marks changed pixels and counts them', () => {
  const a = new Uint8ClampedArray([0, 0, 0, 255, 10, 10, 10, 255]);
  const b = new Uint8ClampedArray([0, 0, 0, 255, 200, 10, 10, 255]);
  const d = pixelDiff(a, b, 2, 1);
  assert.equal(d.changed, 1);
  assert.equal(d.total, 2);
  assert.deepEqual([...d.data.slice(4, 8)], [230, 30, 50, 255]);
  assert.notEqual(d.data[0], 230);
});

test('screenshotTriplets pairs the expected/actual/diff images of toHaveScreenshot', () => {
  const t = screenshotTriplets([
    { path: 'r/a/screenshots/home-expected.png' }, { path: 'r/a/screenshots/home-actual.png' }, { path: 'r/a/screenshots/home-diff.png' },
    { path: 'r/a/screenshots/lonely-actual.png' }, { path: 'r/a/fail.png' },
  ]);
  assert.equal(t.length, 1);
  assert.equal(t[0].name, 'home');
  assert.equal(t[0].diff.path, 'r/a/screenshots/home-diff.png');
  assert.equal(visualCompareHtml({ left: null, right: 'x' }), '');
  const html = visualCompareHtml({ left: '/a.png" onerror="x', right: '/b.png', title: '<t>' });
  assert.doesNotMatch(html, /onerror="x|<t>/);
  assert.match(html, /data-vmode="slider"/);
});

test('route layout: columns by distance from the entry, back edges as arcs', () => {
  const nodes = [{ route: '/', visits: 3, entries: 3, tests: 1, failures: 0 }, { route: '/cart', visits: 2, entries: 0, tests: 1, failures: 1 }, { route: '/pay', visits: 1, entries: 0, tests: 1, failures: 0 }];
  const edges = [{ from: '/', to: '/cart', count: 2 }, { from: '/cart', to: '/pay', count: 1 }, { from: '/pay', to: '/', count: 1 }];
  const L = layoutRoutes(nodes, edges);
  assert.deepEqual(L.nodes.map((n) => n.depth), [0, 1, 2]);
  const svg = routeGraphSvg({ nodes: [...nodes, { route: '/<x>', visits: 1, entries: 1, tests: 1, failures: 0 }], edges });
  assert.equal((svg.match(/class="rm-edge back"/g) ?? []).length, 1);
  assert.match(svg, /rm-node tone-bad" data-tip="\/cart/);
  assert.doesNotMatch(svg, /<x>|NaN/);
});

test('M2 rows and cards escape report text', () => {
  const evil = '<img src=x onerror=alert(1)>';
  assert.doesNotMatch(flakyRowHtml({ title: evil, file: evil, line: 1, target: 'web', agent: 'default', score: 0.5, flaky: 1, flips: 2, sameCommitFlips: 1, failRate: 0.2, history: [{ runId: 'r', status: 'failed' }], last: { runId: 'r', resultId: 'x' } }), /<img/);
  assert.doesNotMatch(errorGroupHtml({ code: evil, message: evil, pattern: evil, locator: evil, count: 1, runs: 1, tests: [{ title: evil, target: evil, runId: 'r', resultId: 'x' }], firstSeen: '2026-01-01', lastSeen: '2026-01-02' }), /<img/);
  assert.doesNotMatch(compareRowHtml({ key: evil, repeat: 0, title: evil, target: 'web', agent: 'default', change: 'regressed', a: { resultId: 'a', status: 'passed', durationMs: 1 }, b: { resultId: 'b', status: 'failed', durationMs: 2, error: { code: evil, message: evil } }, durationDelta: 1, _aRun: 'r1', _bRun: 'r2' }), /<img/);
  assert.doesNotMatch(projectCardHtml({ name: evil, root: `/x/${evil}`, exists: true, current: false, runs: 1, latest: { status: 'passed', summary: {}, startedAt: '2026-01-01', branch: evil }, passRate: 1, health: { score: 90, health: 'good' }, url: null }), /<img/);
  assert.doesNotMatch(locatorCardHtml({ title: evil, target: 'web', label: evil, source: { file: evil, line: 1 }, stability: 1, replayed: 3, runs: 3, tokensWhenLive: 10, suggestion: { code: `await x('${evil}')`, todos: 0 }, latest: { runId: 'r', resultId: 'x' } }, 0), /<img/);
  assert.doesNotMatch(branchRowHtml({ branch: evil, runs: 1, passRate: 1, avgDurationMs: 1, avgTokens: 1, flaky: 0, latest: { runId: 'r', status: 'passed', startedAt: '2026-01-01' } }), /<img/);
  assert.doesNotMatch(meter(0.5, 'good', evil), /<img/);
});

test('project card: nút Chọn để chạy, project đang chọn có đánh dấu, lệnh copy được shell-quote', () => {
  const p = { name: 'p', root: "/tmp/it's", exists: true, current: false, runs: 0, latest: null, passRate: null, health: null };
  const other = projectCardHtml({ ...p, url: 'http://127.0.0.1:4478/?token=abc' });
  assert.match(other, /data-select="\/tmp\/it&#39;s"/);
  assert.match(other, /Đang mở/);
  assert.doesNotMatch(other, /token=abc/); // không lộ token trong thẻ
  assert.match(projectCardHtml({ ...p, url: null }), /data-copy-cmd="cd &#39;\/tmp\/it&#39;\\&#39;&#39;s&#39; &amp;&amp; claude \/e2e-dashboard"/);
  const cur = projectCardHtml({ ...p, current: true });
  assert.match(cur, /Đang chọn để chạy/);
  assert.doesNotMatch(cur, /data-select=/);
});

test('health panel and run table selection', () => {
  const html = healthPanel({ score: 72, health: 'warn', parts: [{ key: 'passRate', label: 'Pass rate', value: 0.9, score: 0.9, weight: 40 }, { key: 'cache', label: 'Cache', value: null, score: null, weight: 10 }] });
  assert.match(html, /Health score 72\/100/);
  assert.match(html, /tone-warn/);
  assert.match(html, /90%/);
  assert.equal(healthPanel(null), '');
  const t = runTable([{ runId: 'r1', status: 'passed', startedAt: new Date().toISOString(), summary: {}, source: 'hook' }], { selectable: true, selected: new Set(['r1']) });
  assert.match(t, /data-cmp="r1" checked/);
  assert.equal(fmtPct(0.456), '46%');
  assert.equal(fmtPoints(-0.1), '-10 điểm');
});

test('archive keeps screenshots of passed results only with "screenshots": "all"', async () => {
  for (const all of [false, true]) {
    const root = mkdtempSync(join(tmpdir(), 'e2ed-shots-'));
    if (all) {
      mkdirSync(join(root, '.e2e-dashboard'));
      writeFileSync(join(root, '.e2e-dashboard/config.json'), JSON.stringify({ screenshots: 'all' }));
    }
    const r = result({ status: 'passed', screenshots: ['web/t/shot.png'] });
    r.attempts[0].artifacts.push({ id: 'v', kind: 'video', path: 'web/t/video.webm' });
    mkdirSync(join(root, '.e2e/results/web/t'), { recursive: true });
    writeFileSync(join(root, '.e2e/results/web/t/shot.png'), 'png');
    writeFileSync(join(root, '.e2e/results/web/t/video.webm'), 'webm');
    const h = run({ results: [r] });
    const out = await archive(root, { source: 'test', report: h.report });
    assert.equal(existsSync(join(out.runDir, 'artifacts/web/t/shot.png')), all);
    assert.equal(existsSync(join(out.runDir, 'artifacts/web/t/video.webm')), false);
  }
});

test('CLI: digest writes a dated file; statusline install respects an existing status line', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-cli-'));
  writeFileSync(join(root, 'e2e.config.ts'), 'export default {}');
  await archive(root, { source: 'test', report: run({ startedAt: new Date().toISOString(), results: [result({ status: 'failed' })] }).report });
  const out = await main(['digest', '7'], root);
  assert.equal(out.code, 0);
  assert.match(out.out, /# Digest e2e/);
  const file = out.out.match(/Đã lưu: (.*)$/m)[1];
  assert.match(readFileSync(file, 'utf8'), /Run:\*\* 1/);

  const env = { E2E_DASHBOARD_HOME: mkdtempSync(join(tmpdir(), 'e2ed-home-')), CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'e2ed-claude-')) };
  const first = await installStatusline(env);
  assert.equal(first.changed, true);
  const settings = JSON.parse(readFileSync(join(env.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8'));
  assert.equal(settings.statusLine.command, `node "${join(env.E2E_DASHBOARD_HOME, 'statusline.mjs')}"`);
  assert.ok(existsSync(join(env.E2E_DASHBOARD_HOME, 'statusline.mjs')));
  assert.equal((await installStatusline(env)).reason, 'already');
  writeFileSync(join(env.CLAUDE_CONFIG_DIR, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'mine' }, model: 'x' }));
  const third = await installStatusline(env);
  assert.equal(third.reason, 'exists');
  assert.equal(JSON.parse(readFileSync(join(env.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8')).statusLine.command, 'mine');
  assert.match((await main(['statusline'], root)).out, /statusline install/);
  assert.match((await main(['projects'], tmpdir())).out, /project|Chưa có/);
});
