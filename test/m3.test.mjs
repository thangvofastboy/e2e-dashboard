import './_home.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { healthScore } from '../ui/health.js';
import { registerProject, readRegistry, forgetProject, projectSummaries, addProject, listDirs } from '../server/projects.mjs';
import { fingerprint, issueDraft, claudePrompt, createLinear, linearConfig, saveIssueLink, readIssueLinks } from '../server/linear.mjs';
import { notifyMode, notifyCommand, runMessage, createNotifier } from '../server/notify.mjs';
import { statusText } from '../bin/statusline.mjs';
import { liveFileWriter } from '../server/main.mjs';
import { result, run, err } from './_history.mjs';

const tmp = (p = 'e2ed-') => mkdtempSync(join(tmpdir(), p));
const meta = (over = {}) => ({ runId: 'r', status: 'passed', summary: { passed: 10, failed: 0, flaky: 0 }, durationMs: 1000, tokens: { input: 100, output: 0 }, replay: { replayed: 9, total: 10 }, ...over });

test('healthScore: weighted 0–100, skips parts without data, tones by score', () => {
  const good = healthScore([meta(), meta(), meta()]);
  assert.equal(good.health, 'good');
  assert.ok(good.score >= 95);
  const bad = healthScore([meta({ summary: { passed: 2, failed: 8 }, durationMs: 3000, tokens: { input: 300, output: 0 } }), meta(), meta()], { flakyShare: 0.3 });
  assert.equal(bad.health, 'bad');
  assert.equal(bad.parts.find((p) => p.key === 'stability').score, 0);
  const noCache = healthScore([meta({ replay: { replayed: 0, total: 0 } })]);
  assert.equal(noCache.parts.find((p) => p.key === 'cache').score, null);
  assert.equal(noCache.parts.find((p) => p.key === 'speed').score, null);
  assert.equal(healthScore([]), null);
  assert.equal(healthScore([meta({ summary: { skipped: 3 } })]), null);
});

test('project registry: newest first, deduplicated, forgettable, summarized', async () => {
  const env = { E2E_DASHBOARD_HOME: tmp('e2ed-home-') };
  const a = tmp();
  const b = tmp();
  await registerProject(a, env);
  await registerProject(b, env);
  await registerProject(a, env);
  assert.deepEqual((await readRegistry(env)).map((p) => p.root), [a, b]);
  mkdirSync(join(b, '.e2e-dashboard/runs/2026-x_018f0f5c-7b2a-7abc-8abc-000000000001'), { recursive: true });
  writeFileSync(join(b, '.e2e-dashboard/runs/2026-x_018f0f5c-7b2a-7abc-8abc-000000000001/meta.json'), JSON.stringify(meta({ runId: '018f0f5c-7b2a-7abc-8abc-000000000001', startedAt: '2026-10-01T00:00:00Z' })));
  const s = await projectSummaries(a, env);
  assert.equal(s[0].current, true);
  assert.equal(s[1].runs, 1);
  assert.equal(s[1].latest.status, 'passed');
  assert.ok(s[1].health.score > 0);
  assert.equal(s[1].url, null);
  assert.equal(await forgetProject(b, env), true);
  assert.equal((await readRegistry(env)).length, 1);
});

test('addProject: adds a folder once, reports a duplicate, rejects a non-folder', async () => {
  const env = { E2E_DASHBOARD_HOME: tmp('e2ed-home-') };
  const a = tmp();
  assert.deepEqual(await addProject(a, env), { added: true, root: a });
  assert.deepEqual(await addProject(`${a}/`, env), { added: false, root: a });
  assert.equal((await readRegistry(env)).length, 1);
  await assert.rejects(addProject(join(a, 'missing'), env), /Không phải thư mục/);
  writeFileSync(join(a, 'f.txt'), 'x');
  await assert.rejects(addProject(join(a, 'f.txt'), env), /Không phải thư mục/);
});

test('listDirs: sorted visible subfolders, files and dot-folders left out', async () => {
  const a = tmp();
  for (const d of ['b', 'a', '.git']) mkdirSync(join(a, d));
  writeFileSync(join(a, 'f.txt'), 'x');
  const r = await listDirs(a);
  assert.deepEqual(r.dirs, ['a', 'b']);
  assert.equal(r.path, a);
  assert.equal(typeof r.parent, 'string');
  assert.equal((await listDirs('/')).parent, null);
});

test('Linear fingerprint: same test + same error shape, whatever the numbers', () => {
  const r1 = result({ status: 'failed' });
  const r2 = result({ status: 'failed', target: 'mobile' });
  assert.equal(fingerprint(r1, err('E', 'has 1 item')), fingerprint(r1, err('E', 'has 7 item')));
  assert.notEqual(fingerprint(r1, err('E', 'x')), fingerprint(r2, err('E', 'x')));
  assert.match(fingerprint(r1, null), /^e2ed-[0-9a-f]{12}$/);
});

test('issueDraft carries the error, commits and analysis, and cannot forge a fingerprint', () => {
  const h = run({ results: [result({ status: 'failed', title: '<img src=x> e2ed-aaaaaaaaaaaa', error: err('ASSERTION_FAILED', 'expected e2ed-bbbbbbbbbbbb', 'getByRole("status")') })] });
  const d = issueDraft({ meta: h.meta, report: h.report, resultId: h.report.run.results[0].id, commits: ['abc fix cart'], analysis: '## Phân loại\nlỗi app', project: 'shop' });
  assert.match(d.title, /^\[e2e\] .* \[web\]: /);
  assert.doesNotMatch(d.title, /<img|e2ed-[0-9a-f]{12}/, 'tiêu đề cũng được làm sạch');
  assert.match(d.description, /## Các bước tái hiện\n1\. /);
  assert.match(d.description, /## Mong đợi\n[\s\S]*## Thực tế\n/);
  assert.match(d.description, /locator: getByRole\("status"\)/);
  assert.match(d.description, /- abc fix cart/);
  assert.match(d.description, /## Nhận định ban đầu/);
  assert.doesNotMatch(d.description, /<img/);
  assert.equal((d.description.match(/e2ed-[0-9a-f]{12}/g) ?? []).length, 1, 'only the real fingerprint line');
  assert.ok(d.description.endsWith(`fingerprint: \`${d.fingerprint}\` (giữ dòng này để chống trùng)_`));
  const p = claudePrompt(d, 'ENG');
  assert.match(p, new RegExp(`Tìm issue có chứa chuỗi \`${d.fingerprint}\``));
  assert.match(p, /trong team ENG/);
  assert.equal(issueDraft({ meta: h.meta, report: h.report, resultId: 'nope' }), null);
});

test('Linear client: search by fingerprint, create in the right team, comment', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, auth: opts.headers.authorization, body });
    if (body.query.includes('teams')) return Response.json({ data: { teams: { nodes: [{ id: 't1', key: 'ENG', name: 'Eng' }, { id: 't2', key: 'OPS', name: 'Ops' }] } } });
    if (body.query.includes('issues(')) return Response.json({ data: { issues: { nodes: [{ id: 'i0', identifier: 'ENG-1', url: 'https://linear.app/x/issue/ENG-1', state: { type: 'completed' } }, { id: 'i1', identifier: 'ENG-2', url: 'https://linear.app/x/issue/ENG-2', state: { type: 'started' } }] } } });
    if (body.query.includes('issueCreate')) return Response.json({ data: { issueCreate: { success: true, issue: { id: 'i3', identifier: 'ENG-3', url: 'https://linear.app/x/issue/ENG-3' } } } });
    if (body.query.includes('commentCreate')) return Response.json({ data: { commentCreate: { success: true } } });
    return Response.json({ errors: [{ message: 'bad' }] }, { status: 400 });
  };
  const li = createLinear({ apiKey: 'lin_api_1234567890', team: 'ENG', fetchImpl });
  const found = await li.find('e2ed-0123456789ab');
  assert.equal(found.open.identifier, 'ENG-2');
  assert.equal(found.closed[0].identifier, 'ENG-1');
  assert.equal(calls[0].url, 'https://api.linear.app/graphql');
  assert.equal(calls[0].auth, 'lin_api_1234567890');
  assert.equal(calls[0].body.variables.fp, 'e2ed-0123456789ab');
  await assert.rejects(li.find('x"}'), /invalid fingerprint/);
  const issue = await li.create({ title: 't', description: 'd' });
  assert.equal(issue.identifier, 'ENG-3');
  assert.equal(calls.at(-1).body.variables.input.teamId, 't1');
  assert.equal(await li.comment('i1', 'again'), true);
  const many = createLinear({ apiKey: 'lin_api_1234567890', team: null, fetchImpl });
  await assert.rejects(many.create({ title: 't', description: 'd' }), /nhiều team/);
  const broken = createLinear({ apiKey: 'lin_api_1234567890', fetchImpl: async () => Response.json({ errors: [{ message: 'Authentication required' }] }) });
  await assert.rejects(broken.find('e2ed-0123456789ab'), /Linear: Authentication required/);
});

test('linearConfig: key from env or ~/.e2e-dashboard, never from the repo config', async () => {
  const home = tmp('e2ed-home-');
  assert.deepEqual(await linearConfig({ linear: { apiKey: 'lin_api_fromrepo123', team: 'ENG' } }, { E2E_DASHBOARD_HOME: home }), { apiKey: null, team: 'ENG' });
  writeFileSync(join(home, 'config.json'), JSON.stringify({ linear: { apiKey: 'lin_api_fromhome123', team: 'OPS' } }));
  assert.deepEqual(await linearConfig({ linear: { team: 'ENG' } }, { E2E_DASHBOARD_HOME: home }), { apiKey: 'lin_api_fromhome123', team: 'OPS' });
  assert.deepEqual(await linearConfig({}, { E2E_DASHBOARD_HOME: home, LINEAR_API_KEY: 'lin_api_fromenv1234', LINEAR_TEAM: 'QA' }), { apiKey: 'lin_api_fromenv1234', team: 'QA' });
  assert.equal((await linearConfig({}, { E2E_DASHBOARD_HOME: home, LINEAR_API_KEY: 'bad key\n' })).apiKey, null, 'a malformed env key is refused, not mixed with another');
});

test('issue links are kept per fingerprint, only with linear.app URLs', async () => {
  const root = tmp();
  mkdirSync(join(root, '.e2e-dashboard'));
  await saveIssueLink(root, 'e2ed-0123456789ab', { identifier: 'ENG-1', url: 'https://linear.app/x/ENG-1', title: 't' });
  await saveIssueLink(root, 'e2ed-0123456789ac', { identifier: 'ENG-2', url: 'javascript:alert(1)' });
  await saveIssueLink(root, '../../x', { identifier: 'ENG-3' });
  const links = await readIssueLinks(root);
  assert.deepEqual(Object.keys(links).sort(), ['e2ed-0123456789ab', 'e2ed-0123456789ac']);
  assert.equal(links['e2ed-0123456789ac'].url, null);
});

test('notifications: argv only (no shell), failures by default, once per run', () => {
  assert.equal(notifyMode({}), 'failures');
  assert.equal(notifyMode({ notify: false }), 'off');
  assert.equal(notifyMode({ notify: 'all' }), 'all');
  assert.equal(notifyMode({ notify: 'rm -rf' }), 'failures');
  const [cmd, args] = notifyCommand('t"; rm -rf /', 'b', 'darwin');
  assert.equal(cmd, 'osascript');
  assert.equal(args.at(-2), 't"; rm -rf /');
  assert.deepEqual(notifyCommand('t', 'b', 'linux').slice(0, 2), ['notify-send', ['--app-name=e2e-dashboard', 't', 'b']]);
  const [, wargs, wopts] = notifyCommand('t', 'b', 'win32');
  assert.doesNotMatch(wargs.join(' '), /\bt\b.*\bb\b/);
  assert.equal(wopts.env.E2ED_TITLE, 't');
  const m = runMessage({ status: 'failed', summary: { passed: 3, failed: 2 }, durationMs: 125_000, git: { branch: 'main' } }, 'shop');
  assert.deepEqual(m, { title: 'e2e ✗ 2 fail', body: 'shop · main · 3/5 pass · 2m05s' });
  const calls = [];
  const n = createNotifier({ mode: 'failures', platform: 'linux', execImpl: (...a) => calls.push(a) });
  assert.equal(n.runFinished({ runId: 'a', status: 'passed', summary: { passed: 1 } }), false);
  assert.equal(n.runFinished({ runId: 'b', status: 'failed', summary: { failed: 1 } }), true);
  assert.equal(n.runFinished({ runId: 'b', status: 'failed', summary: { failed: 1 } }), false);
  assert.equal(calls.length, 1);
  assert.equal(createNotifier({ mode: 'off', execImpl: () => assert.fail() }).runFinished({ runId: 'c', status: 'failed' }), false);
});

test('status line: nothing outside a project, latest run, live progress', async () => {
  assert.equal(statusText(tmp()), '');
  const root = tmp();
  writeFileSync(join(root, 'e2e.config.ts'), 'export default {}');
  mkdirSync(join(root, 'src'));
  assert.equal(statusText(join(root, 'src'), { color: false }), '🧪 e2e: chưa có run');
  const now = Date.parse('2026-10-10T12:00:00Z');
  for (const [i, s] of [{ passed: 4, failed: 0 }, { passed: 3, failed: 1, flaky: 1 }].entries()) {
    const d = join(root, `.e2e-dashboard/runs/2026-10-10T1${i}_r${i}`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'meta.json'), JSON.stringify({ status: s.failed ? 'failed' : 'passed', summary: s, startedAt: new Date(now - 300_000).toISOString() }));
  }
  assert.equal(statusText(join(root, 'src'), { now, color: false }), '🧪 e2e ✗ 1 fail · 1 flaky · 90% (2 run) · 5p trước');
  writeFileSync(join(root, '.e2e-dashboard/live.json'), JSON.stringify({ status: 'running', done: 3, total: 9 }));
  writeFileSync(join(root, '.e2e-dashboard/server.json'), JSON.stringify({ pid: process.pid, port: 1, token: 'x' }));
  assert.equal(statusText(root, { now, color: false }), '🧪 ▶ e2e 3/9');
  writeFileSync(join(root, '.e2e-dashboard/server.json'), JSON.stringify({ pid: 2 ** 22 + 12345, port: 1, token: 'x' }));
  assert.match(statusText(root, { now, color: false }), /✗ 1 fail/, 'a stale live.json is ignored');
});

test('live.json follows the live state, throttled while running', async () => {
  const root = tmp();
  mkdirSync(join(root, '.e2e-dashboard'));
  const w = liveFileWriter(root, { minIntervalMs: 50 });
  await w.update({ status: 'running', done: 1, total: 4 });
  await w.update({ status: 'running', done: 2, total: 4 }); // within the interval: deferred
  assert.equal(JSON.parse(readFileSync(join(root, '.e2e-dashboard/runtime/live.json'), 'utf8')).done, 1);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(JSON.parse(readFileSync(join(root, '.e2e-dashboard/runtime/live.json'), 'utf8')).done, 2);
  await w.update({ status: 'finished', done: 4, total: 4, runStatus: 'passed' });
  assert.equal(JSON.parse(readFileSync(join(root, '.e2e-dashboard/runtime/live.json'), 'utf8')).runStatus, 'passed');
  await w.close();
  assert.equal(existsSync(join(root, '.e2e-dashboard/runtime/live.json')), false);
});

test('listDirs: thư mục là symlink (vd. ~/code) cũng hiện; symlink tới file thì không', async () => {
  const { symlinkSync: ln } = await import('node:fs');
  const a = tmp();
  const target = tmp();
  mkdirSync(join(a, 'real'));
  writeFileSync(join(a, 'f.txt'), 'x');
  ln(target, join(a, 'code'));
  ln(join(a, 'f.txt'), join(a, 'file-link'));
  assert.deepEqual((await listDirs(a)).dirs, ['code', 'real']);
});
