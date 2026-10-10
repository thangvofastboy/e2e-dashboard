import './_home.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { search, anomalies, lintAgentSteps, modelStats, bisectPlan, flakyEvidence } from '../server/insights.mjs';
import { parseCodeowners, ownersOf, readCodeowners } from '../server/owners.mjs';
import { addQuarantine, readQuarantine, removeQuarantine, quarantineFlags } from '../server/quarantine.mjs';
import { importReport, importFromGithub, sharePush, sharePull } from '../server/share.mjs';
import { prCommentMarkdown, createGithub } from '../server/github.mjs';
import { createNotifier } from '../server/notify.mjs';
import { buildRunArgs } from '../server/runner.mjs';
import { compareRuns } from '../server/analytics.mjs';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';
import { main } from '../bin/dashboard.mjs';
import { searchHitsHtml } from '../ui/views/search.js';
import { modelRowHtml } from '../ui/views/models.js';
import { lintRowHtml } from '../ui/views/lint.js';
import { result, run, err } from './_history.mjs';

const tmp = (p = 'e2ed-') => mkdtempSync(join(tmpdir(), p));
const newestFirst = (...runs) => runs.reverse();

test('search folds accents, needs every term, ranks label hits', () => {
  const h = [run({ branch: 'feat/thanh-toán', results: [result({ testId: 'pay', title: 'Thanh toán thẻ', status: 'failed', error: err('LOCATOR_NOT_FOUND', 'no Pay button'), failUrl: 'http://x/checkout' }), result({ testId: 'login', idSeed: 2 })] })];
  assert.equal(search(h, 'thanh toan')[0].label, 'Thanh toán thẻ');
  assert.ok(search(h, 'locator_not_found').some((x) => x.kind === 'error'));
  assert.ok(search(h, 'checkout').some((x) => x.kind === 'url'));
  assert.ok(search(h, 'feat/thanh').some((x) => x.kind === 'run'));
  assert.deepEqual(search(h, 'pay zzz'), []);
  assert.deepEqual(search(h, '   '), []);
  assert.match(search(h, 'thanh')[0].href, /^#\/run\/[0-9a-f-]+\/test\/[0-9a-f]{64}$/);
});

test('anomalies: much slower or costlier than the test’s own history', () => {
  const past = [0, 1, 2, 3, 4].map((i) => run({ results: [result({ testId: 'a', durationMs: 1000 + i * 10, tokens: 100 }), result({ testId: 'b', idSeed: 2, durationMs: 1000, tokens: 100 })] }));
  const now = run({ results: [result({ testId: 'a', durationMs: 5000, tokens: 100 }), result({ testId: 'b', idSeed: 2, durationMs: 1040, tokens: 2000 })] });
  const a = anomalies(newestFirst(...past, now));
  assert.deepEqual(a.map((x) => `${x.title}:${x.metric}`).sort(), ['a:durationMs', 'b:tokens']);
  assert.equal(anomalies(newestFirst(...past.slice(0, 2), now)).length, 0, 'too little history');
  assert.equal(anomalies(newestFirst(...past, now), { runId: past[4].meta.runId }).length, 0);
});

test('lint flags unverified, multi-goal, vague, long and heavy agent steps', () => {
  const r = result({});
  const s = r.attempts[0].steps[0];
  s.label = 'open the cart and remove the item and then check out properly';
  s.cache = { ...s.cache, write: 'unconfirmed' };
  s.metrics = { modelCalls: 9 };
  const ok = result({ testId: 'ok', idSeed: 2 });
  ok.attempts[0].steps[0].label = 'adds shoes to the cart';
  const f = lintAgentSteps([run({ results: [r, ok] })]);
  assert.equal(f.length, 1);
  assert.deepEqual(f[0].rules.sort(), ['budget-heavy', 'check-in-act', 'multi-goal', 'no-verification', 'vague']);
});

test('modelStats per provider/model, budget per model, cheaper-judge hint', () => {
  const r1 = result({});
  r1.attempts[0].steps[0].model = { provider: 'anthropic', model: 'big', calls: 2, inputTokens: 1000, outputTokens: 100, estimatedCostUsd: 0.5 };
  r1.attempts[0].steps.push({ ...structuredClone(r1.attempts[0].steps[0]), index: 1, api: 'agent.assert', status: 'failed', model: { provider: 'anthropic', model: 'big', calls: 1, inputTokens: 500, outputTokens: 10, estimatedCostUsd: 0.3 } });
  const r2 = result({ testId: 'b', idSeed: 2 });
  r2.attempts[0].steps[0].model = { provider: 'anthropic', model: 'small', calls: 1, inputTokens: 1000, outputTokens: 100, estimatedCostUsd: 0.05 };
  const s = modelStats([run({ results: [r1, r2] })], { budget: { perModel: { 'anthropic/big': 0.5 } } });
  assert.deepEqual(s.models.map((m) => m.id), ['anthropic/big', 'anthropic/small']);
  assert.equal(s.models[0].passRate, 0.5);
  assert.equal(s.over[0].id, 'anthropic/big');
  assert.match(s.hints[0], /1 bước judgment/);
});

test('bisectPlan: last pass → first fail, script only when commits differ', () => {
  const h = newestFirst(
    run({ commit: 'a'.repeat(40), results: [result({ status: 'passed' })] }),
    run({ commit: 'b'.repeat(40), results: [result({ status: 'failed' })] }),
    run({ commit: 'c'.repeat(40), results: [result({ status: 'failed' })] }),
  );
  const p = bisectPlan(h, h[0].meta.runId, h[0].report.run.results[0].id);
  assert.equal(p.good.commit, 'a'.repeat(40));
  assert.equal(p.bad.commit, 'b'.repeat(40), 'the first failing run, not the newest');
  assert.match(p.script, /^git bisect start b{40} a{40}\ngit bisect run npx e2e run tests\/example\.e2e\.ts:3 --target web --no-cache --retries 0\ngit bisect reset$/);
  const same = newestFirst(run({ results: [result({ status: 'passed' })] }), run({ results: [result({ status: 'failed' })] }));
  assert.equal(bisectPlan(same, same[0].meta.runId, same[0].report.run.results[0].id).script, null);
  assert.equal(bisectPlan(h, h[0].meta.runId, 'nope'), null);
  assert.equal(flakyEvidence(h, `${h[0].report.run.results[0].testId}|web|default`).length, 3);
});

test('CODEOWNERS: last match wins, gitignore-like patterns', () => {
  const rules = parseCodeowners('# owners\n* @all\n/tests/ @qa\ntests/**/checkout*.ts @pay x@y.z\ndocs/ @docs # trailing\n*.md bad-owner');
  assert.deepEqual(ownersOf(rules, 'src/a.ts'), ['@all']);
  assert.deepEqual(ownersOf(rules, 'tests/login.e2e.ts'), ['@qa']);
  assert.deepEqual(ownersOf(rules, 'tests/shop/checkout.e2e.ts'), ['@pay', 'x@y.z']);
  assert.deepEqual(ownersOf(rules, 'a/docs/x.txt'), ['@docs']);
  assert.deepEqual(ownersOf(rules, 'README.md'), []);
  const root = tmp();
  mkdirSync(join(root, '.github'));
  writeFileSync(join(root, '.github/CODEOWNERS'), 'tests/ @qa');
  assert.equal(readCodeowners(root).file, '.github/CODEOWNERS');
});

test('quarantine: add, expire, CI flags escaped as regexes; runner passes --grep-invert', async () => {
  const root = tmp();
  const now = Date.parse('2026-10-10T00:00:00Z');
  await addQuarantine(root, { key: 'tests/a.e2e.ts::x|web|default', title: 'cart › adds (1+1)', file: 'tests/a.e2e.ts', line: 3, days: 7 }, now);
  await addQuarantine(root, { key: 'tests/a.e2e.ts::y|web|default', title: "it's old", days: 1 }, now - 3 * 86_400_000);
  await assert.rejects(addQuarantine(root, { key: 'bad\nkey' }), /invalid key/);
  const f = quarantineFlags(await readQuarantine(root), now);
  assert.equal(f.active.length, 1);
  assert.equal(f.expired.length, 1);
  assert.deepEqual(f.args, ['--grep-invert', '^cart adds \\(1\\+1\\)$']);
  assert.equal(f.command, "npx e2e run --grep-invert '^cart adds \\(1\\+1\\)$'");
  assert.equal(await removeQuarantine(root, 'tests/a.e2e.ts::y|web|default'), true);
  assert.equal((await readQuarantine(root)).length, 1);
  assert.deepEqual(buildRunArgs({ grepInvert: ['^a$'] }), ['e2e', 'run', '--grep-invert', '^a$']);
  assert.throws(() => buildRunArgs({ grepInvert: ['--exec=x'] }), /invalid grepInvert/);
});

test('CI import from a file or a gh artifact; team folder push and pull', async () => {
  const ci = tmp();
  const h = run({ results: [result({ status: 'failed' })] });
  mkdirSync(join(ci, 'out/.e2e'), { recursive: true });
  writeFileSync(join(ci, 'out/.e2e/report.json'), JSON.stringify(h.report));
  const a = tmp();
  assert.equal((await importReport(a, join(ci, 'out/.e2e'))).status, 'archived');
  assert.equal(JSON.parse(readFileSync(join(a, '.e2e-dashboard/runs', readdirSync(join(a, '.e2e-dashboard/runs'))[0], 'meta.json'), 'utf8')).source, 'ci');
  assert.equal((await importReport(a, join(ci, 'nope'))).status, 'skipped');

  const calls = [];
  const execImpl = (cmd, args, _o, cb) => {
    calls.push([cmd, ...args]);
    const d = args[args.indexOf('-D') + 1];
    mkdirSync(join(d, 'e2e-report'), { recursive: true });
    writeFileSync(join(d, 'e2e-report/report.json'), JSON.stringify(run({ results: [result({})] }).report));
    cb(null, '', '');
  };
  const gh = await importFromGithub(a, '123', { artifact: 'e2e-report', execImpl });
  assert.equal(gh[0].status, 'archived');
  assert.deepEqual(calls[0].slice(0, 4), ['gh', 'run', 'download', '123']);
  await assert.rejects(importFromGithub(a, '1; rm -rf', { execImpl }), /số/);

  const team = tmp('e2ed-team-');
  const pushed = await sharePush(a, team);
  assert.equal(pushed.pushed, 2);
  assert.equal((await sharePush(a, team)).pushed, 0, 'idempotent');
  const projectDir = join(team, readdirSync(team)[0], 'runs');
  // a hostile teammate: a symlinked run and a run whose id does not match its folder
  symlinkSync('/etc', join(projectDir, '2026-x_018f0f5c-7b2a-7abc-8abc-0000000000ee'));
  mkdirSync(join(projectDir, '2026-y_018f0f5c-7b2a-7abc-8abc-0000000000ff'));
  writeFileSync(join(projectDir, '2026-y_018f0f5c-7b2a-7abc-8abc-0000000000ff/meta.json'), '{"runId":"other"}');
  writeFileSync(join(projectDir, '2026-y_018f0f5c-7b2a-7abc-8abc-0000000000ff/report.json'), '{}');
  const b = mkdtempSync(join(tmpdir(), 'x-'));
  const bProject = join(b, readdirSync(team)[0]);
  mkdirSync(bProject);
  const pulled = await sharePull(bProject, team, { by: 'ana' });
  assert.equal(pulled.pulled, 2);
  assert.equal(pulled.skipped, 1);
  const metas = readdirSync(join(bProject, '.e2e-dashboard/runs')).map((d) => JSON.parse(readFileSync(join(bProject, '.e2e-dashboard/runs', d, 'meta.json'), 'utf8')));
  assert.ok(metas.every((m) => m.source === 'shared' && m.sharedBy === 'ana'));
  assert.equal((await sharePull(bProject, team)).pulled, 0);
});

test('PR comment: escaped Markdown, gh with argv and stdin only', async () => {
  const base = run({ results: [result({ testId: 'a' })] });
  const head = run({ branch: 'feat/x', results: [result({ testId: 'a', title: '<b>|x', status: 'failed', error: err('E`', 'boom *x*') })] });
  const md = prCommentMarkdown(compareRuns(base, head), { project: 'shop' });
  assert.match(md, /### 🧪 e2e · shop: main@aaaaaaa → feat\/x@aaaaaaa/);
  assert.match(md, /🔴 Mới fail \| \\<b\\>\\\|x \\\[web\\\] \| `E` boom \\\*x\\\*/);
  const calls = [];
  const execImpl = (cmd, args, _o, cb) => {
    const stdin = { data: '', end(s) { this.data = s; } };
    calls.push({ cmd, args, stdin });
    setImmediate(() => cb(null, args[1] === 'list' ? '[{"number":7,"url":"https://github.com/o/r/pull/7","title":"t"}]' : 'https://github.com/o/r/pull/7#c1', ''));
    return { stdin };
  };
  const g = createGithub({ projectRoot: tmp(), execImpl });
  assert.equal((await g.findPr('feat/x')).number, 7);
  assert.equal(await g.findPr('--evil'), null);
  assert.equal(await g.comment(7, md), 'https://github.com/o/r/pull/7#c1');
  assert.deepEqual(calls[1].args, ['pr', 'comment', '7', '--body-file', '-']);
  assert.equal(calls[1].stdin.data, md);
});

test('notifier reports anomalies even on a passing run', () => {
  const calls = [];
  const n = createNotifier({ mode: 'failures', platform: 'linux', execImpl: (...a) => calls.push(a) });
  assert.equal(n.runFinished({ runId: 'x', status: 'passed', summary: { passed: 2 } }, { anomalies: 2 }), true);
  assert.equal(calls[0][1][1], 'e2e ⚠ 2 test bất thường');
});

test('API: search, anomalies, lint, models, bisect, owners, quarantine, why-flaky, PR, import', async () => {
  const root = tmp();
  writeFileSync(join(root, 'e2e.config.ts'), 'export default {}');
  mkdirSync(join(root, '.github'));
  writeFileSync(join(root, '.github/CODEOWNERS'), 'tests/ @qa');
  const runs = [
    run({ commit: 'a'.repeat(40), results: [result({ testId: 'cart', status: 'passed' })] }),
    run({ commit: 'b'.repeat(40), results: [result({ testId: 'cart', status: 'failed', error: err('E', 'boom') })] }),
  ];
  for (const r of runs) await archive(root, { source: 'test', report: r.report });
  const prompts = [];
  const ai = { run: async ({ prompt, onEvent }) => { prompts.push(prompt); onEvent({ type: 'done', result: 'ok' }); } };
  const posted = [];
  const github = { findPr: async (b) => (b === 'main' ? { number: 3, url: 'https://github.com/o/r/pull/3', title: 't' } : null), comment: async (n, body) => posted.push([n, body]) && 'url' };
  const ghImport = async (_root, id) => [{ report: 'r.json', status: id === '9' ? 'archived' : 'exists' }];
  const server = http.createServer(createApp({ projectRoot: root, token: 't', uiDir: fileURLToPath(new URL('../ui', import.meta.url)), live: createLive({ throttleMs: 1 }), ai, github, ghImport }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p) => (await fetch(`${base}${p}`, { headers: { 'x-e2e-dashboard-token': 't' } })).json();
  const post = async (p, body) => {
    const res = await fetch(`${base}${p}`, { method: 'POST', headers: { 'x-e2e-dashboard-token': 't', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, text: await res.text() };
  };
  try {
    assert.equal((await get('/api/search?q=cart')).hits[0].kind, 'test');
    assert.deepEqual((await get('/api/search?q=')).hits, []);
    assert.ok(Array.isArray((await get('/api/anomalies')).anomalies));
    assert.ok((await get('/api/lint')).rules['no-verification']);
    assert.deepEqual((await get('/api/models')).models, []);
    const resultId = runs[1].report.run.results[0].id;
    const plan = await get(`/api/bisect?runId=${runs[1].meta.runId}&resultId=${resultId}`);
    assert.match(plan.script, /git bisect start b{40} a{40}/);
    assert.deepEqual((await get('/api/owners?files=tests/example.e2e.ts,src/x.ts')).owners, { 'tests/example.e2e.ts': ['@qa'], 'src/x.ts': [] });
    const key = `${runs[1].report.run.results[0].testId}|web|default`;
    assert.equal((await post('/api/quarantine', { key, title: 'cart', days: 3 })).status, 201);
    assert.equal((await post('/api/quarantine', { key: 'x' })).status, 400);
    const q = await get('/api/quarantine');
    assert.deepEqual(q.active, [key]);
    assert.match(q.command, /--grep-invert '\^cart\$'/);
    const why = await post('/api/ai/why-flaky', { runId: runs[1].meta.runId, resultId });
    assert.equal(why.status, 200);
    assert.match(prompts.at(-1), /Lịch sử \(mới → cũ\):\n- .*\[failed\] main@b{10}.*E: boom\n- .*\[passed\] main@a{10}/);
    const draft = await post('/api/linear/draft', { runId: runs[1].meta.runId, resultId });
    assert.match(JSON.parse(draft.text).draft.description, /Owners \(CODEOWNERS\):\*\* @qa/);
    const pr = JSON.parse((await post('/api/github/pr', { a: runs[0].meta.runId, b: runs[1].meta.runId })).text);
    assert.equal(pr.pr.number, 3);
    assert.equal(posted.length, 0, 'preview does not post');
    await post('/api/github/pr', { a: runs[0].meta.runId, b: runs[1].meta.runId, post: true });
    assert.equal(posted[0][0], 3);
    assert.equal(JSON.parse((await post('/api/import/github', { runId: '9' })).text).imported[0].status, 'archived');
    assert.match((await get('/api/digest?days=3650')).markdown, /Test đang cách ly\n- cart: đến/);
  } finally {
    server.close();
  }
});

test('CLI: quarantine, import and share commands', async () => {
  const root = tmp();
  writeFileSync(join(root, 'e2e.config.ts'), 'export default {}');
  assert.match((await main(['quarantine'], root)).out, /Không có test nào đang cách ly/);
  await addQuarantine(root, { key: 'a|web|default', title: 'checkout pays' });
  assert.match((await main(['quarantine'], root)).out, /npx e2e run --grep-invert '\^checkout pays\$'/);
  const report = join(root, 'ci-report.json');
  writeFileSync(report, JSON.stringify(run({ results: [result({})] }).report));
  assert.match((await main(['import', 'ci-report.json'], root)).out, /Đã nhập run/);
  assert.match((await main(['import', 'ci-report.json'], root)).out, /đã có/);
  assert.equal((await main(['share', 'push'], root)).code, 1);
  const team = tmp('e2ed-team-');
  assert.match((await main(['share', 'push', team], root)).out, /Đã đẩy 1 run/);
  assert.ok(existsSync(team));
});

test('UI rows for search, models and lint escape their text', () => {
  const evil = '<img src=x onerror=alert(1)>';
  assert.doesNotMatch(searchHitsHtml([{ kind: 'test', label: evil, sub: evil, href: '#/run/x' }]), /<img/);
  assert.doesNotMatch(modelRowHtml({ id: evil, model: evil, provider: evil, apis: [{ api: evil, steps: 1 }], steps: 1, passRate: 1, tokensPerStep: 1, avgDurationMs: 1, costPerStep: 0.1, costUsd: 0.1, cacheShare: 0.5 }), /<img/);
  assert.doesNotMatch(lintRowHtml({ title: evil, target: evil, api: evil, label: evil, source: { file: evil, line: 1 }, rules: ['vague'], latest: { runId: 'r', resultId: 'x' } }, { vague: evil }), /<img/);
});
