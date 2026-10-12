import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';
import { resetPreview, resetAll } from '../server/reset.mjs';

const UI = fileURLToPath(new URL('../ui', import.meta.url));
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));
const put = (root, rel, c = '{}') => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), c); };

// a project with settings, data, one real archived run, and files that must survive any reset
async function project() {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-reset-'));
  const home = mkdtempSync(join(tmpdir(), 'e2ed-home-'));
  put(root, 'e2e.config.ts', 'export default {}');
  put(root, 'tests/a.e2e.ts', 'test()');
  put(root, '.e2e/report.json', JSON.stringify(fixture()));
  put(root, '.e2e-dashboard/server.json', '{"port":1}');
  put(root, '.e2e-dashboard/config.json', '{"budget":{}}');
  put(root, '.e2e-dashboard/state/settings.json');
  put(root, '.e2e-dashboard/state/alerts.json');
  put(root, '.e2e-dashboard/state/triage.json');
  put(root, '.e2e-dashboard/state/qc-notes.json');
  put(root, '.e2e-dashboard/state/longterm/2026.json');
  put(root, '.e2e-dashboard/cache/index.sqlite', 'x');
  put(root, '.e2e-dashboard/issues.json'); // the pre-0.8.8 location of a state file
  await archive(root, { source: 'hook' });
  put(home, 'config.json', '{"linear":{"apiKey":"k"}}');
  put(home, 'projects.json', '[]');
  return { root, home, env: { E2E_DASHBOARD_HOME: home } };
}
const has = (root, rel) => existsSync(join(root, rel));

test('preview lists what would go, with the run count, and changes nothing', async () => {
  const { root, env } = await project();
  const p = await resetPreview(root, { env });
  assert.ok(p.settings.items.some((x) => x.name === 'settings.json') && p.settings.items.some((x) => x.name === 'config.json'));
  assert.ok(p.data.items.some((x) => x.name === 'runs') && p.data.items.some((x) => x.name === 'issues.json'));
  assert.equal(p.data.runs, 1);
  assert.equal(p.global.exists, true);
  assert.ok(has(root, '.e2e-dashboard/state/settings.json'));
});

test('reset settings removes settings only; data, project files and server.json stay', async () => {
  const { root, env } = await project();
  const r = await resetAll(root, ['settings'], { env });
  assert.deepEqual(r.removed.map((x) => x.name).sort(), ['alerts.json', 'config.json', 'settings.json']);
  assert.equal(has(root, '.e2e-dashboard/state/settings.json'), false);
  assert.equal(has(root, '.e2e-dashboard/config.json'), false);
  for (const keep of ['.e2e-dashboard/state/triage.json', '.e2e-dashboard/runs', '.e2e-dashboard/server.json', 'e2e.config.ts', 'tests/a.e2e.ts', '.e2e/report.json']) assert.ok(has(root, keep), keep);
  assert.equal(has(env.E2E_DASHBOARD_HOME, 'config.json'), true, 'the machine-wide config is untouched');
});

test('reset data removes runs, state data (both layouts), index and long-term; settings stay', async () => {
  const { root, env } = await project();
  await resetAll(root, ['data'], { env });
  for (const gone of ['.e2e-dashboard/runs', '.e2e-dashboard/state/triage.json', '.e2e-dashboard/state/qc-notes.json', '.e2e-dashboard/state/longterm', '.e2e-dashboard/cache', '.e2e-dashboard/issues.json']) assert.equal(has(root, gone), false, gone);
  for (const keep of ['.e2e-dashboard/state/settings.json', '.e2e-dashboard/config.json', '.e2e-dashboard/server.json', 'e2e.config.ts', '.e2e/report.json']) assert.ok(has(root, keep), keep);
});

test('global removes only the machine-wide config.json, never projects.json', async () => {
  const { root, env } = await project();
  const r = await resetAll(root, ['global'], { env });
  assert.deepEqual(r.removed.map((x) => [x.scope, x.name]), [['global', 'config.json']]);
  assert.equal(has(env.E2E_DASHBOARD_HOME, 'config.json'), false);
  assert.equal(has(env.E2E_DASHBOARD_HOME, 'projects.json'), true);
  assert.ok(has(root, '.e2e-dashboard/runs'));
});

test('bad scopes are refused; a symlinked target is skipped, never followed', async () => {
  const { root, env } = await project();
  await assert.rejects(resetAll(root, [], { env }), /scopes/);
  await assert.rejects(resetAll(root, ['everything'], { env }), /scopes/);
  const outside = mkdtempSync(join(tmpdir(), 'e2ed-outside-'));
  put(outside, 'keep.txt', 'precious');
  const { rmSync } = await import('node:fs');
  rmSync(join(root, '.e2e-dashboard/exports'), { recursive: true, force: true });
  symlinkSync(outside, join(root, '.e2e-dashboard/exports'));
  const r = await resetAll(root, ['data'], { env });
  assert.ok(r.skipped.some((x) => x.why === 'symlink'));
  assert.equal(readFileSync(join(outside, 'keep.txt'), 'utf8'), 'precious');
  const linked = mkdtempSync(join(tmpdir(), 'e2ed-reset-'));
  const data = mkdtempSync(join(tmpdir(), 'e2ed-data-'));
  symlinkSync(data, join(linked, '.e2e-dashboard'));
  await assert.rejects(resetAll(linked, ['data'], { env }), /symlink/);
});

test('POST /api/reset needs the exact word RESET, refuses during a run, and empties the history', async () => {
  const { root, env } = await project();
  const live = createLive();
  const server = http.createServer(createApp({ projectRoot: root, token: 't', uiDir: UI, live, env }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const h = { 'x-e2e-dashboard-token': 't', origin: base, 'content-type': 'application/json' };
  const post = (b) => fetch(`${base}/api/reset`, { method: 'POST', headers: h, body: JSON.stringify(b) });
  const runs = async () => (await (await fetch(`${base}/api/runs`, { headers: h })).json()).length;
  try {
    assert.equal(await runs(), 1);
    assert.equal((await post({ scopes: ['data'] })).status, 400);
    assert.equal((await post({ scopes: ['data'], confirm: 'reset' })).status, 400);
    assert.equal(await runs(), 1, 'nothing deleted without the exact confirmation');
    live.apply({ type: 'run-started', at: new Date().toISOString(), runId: 'r' });
    assert.equal((await post({ scopes: ['data'], confirm: 'RESET' })).status, 409);
    live.apply({ type: 'run-finished', at: new Date().toISOString(), status: 'passed' });
    assert.equal((await post({ scopes: ['nope'], confirm: 'RESET' })).status, 400);
    const ok = await post({ scopes: ['data'], confirm: 'RESET' });
    assert.equal(ok.status, 200);
    assert.ok((await ok.json()).removed.some((x) => x.name === 'runs'));
    assert.equal(await runs(), 0, 'the in-memory caches were dropped too');
  } finally {
    server.close();
  }
});

test('a symlinked parent directory (state/ planted in the repo) is never followed: nothing outside is deleted', async () => {
  const { root, env } = await project();
  const outside = mkdtempSync(join(tmpdir(), 'e2ed-planted-'));
  for (const f of ['settings.json', 'alerts.json', 'triage.json']) put(outside, f, 'precious');
  put(outside, 'longterm/2026.json', 'precious');
  const { rmSync } = await import('node:fs');
  rmSync(join(root, '.e2e-dashboard/state'), { recursive: true, force: true });
  symlinkSync(outside, join(root, '.e2e-dashboard/state'));
  const preview = await resetPreview(root, { env });
  assert.ok(preview.settings.items.every((x) => x.symlink || x.name === 'config.json'), 'files behind the planted link are flagged, not counted');
  const r = await resetAll(root, ['settings', 'data'], { env });
  assert.ok(r.skipped.length >= 4, 'the files behind the symlinked state/ are skipped');
  for (const keep of ['settings.json', 'alerts.json', 'triage.json', 'longterm/2026.json']) assert.equal(readFileSync(join(outside, keep), 'utf8'), 'precious', keep);
  assert.equal(has(root, '.e2e-dashboard/config.json'), false, 'files that really are inside .e2e-dashboard still go');
});
