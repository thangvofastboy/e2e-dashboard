import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { annotateRun, getRun } from '../server/store.mjs';

const UI = fileURLToPath(new URL('../ui', import.meta.url));
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));

async function serve(runner) {
  const server = http.createServer(createApp({ projectRoot: mkdtempSync(join(tmpdir(), 'e2ed-')), token: 't', uiDir: UI, live: createLive(), runner }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'x-e2e-dashboard-token': 't', origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { server, base, post };
}

test('POST /api/run starts, validates and refuses a second run', async () => {
  const started = [];
  let running = false;
  const runner = {
    start(o) { if (running) return { ok: false, error: 'busy' }; if (o.tests?.[0]?.startsWith('-')) throw new Error('invalid tests'); running = true; started.push(o); return { ok: true, pid: 1 }; },
    stop: () => running && !(running = false),
    state: () => ({ running, pid: running ? 1 : null }),
  };
  const { server, base, post } = await serve(runner);
  try {
    assert.equal((await post('/api/run', { tests: ['--evil'] })).status, 400);
    const ok = await post('/api/run', { tests: ['tests/a.e2e.ts:3'], rerunOf: '018f0f5c-7b2a-7abc-8abc-0123456789ab' });
    assert.equal(ok.status, 202);
    assert.deepEqual(started[0], { tests: ['tests/a.e2e.ts:3'], rerunOf: '018f0f5c-7b2a-7abc-8abc-0123456789ab', browser: 'chromium' }); // trình duyệt mặc định ở Settings
    assert.equal((await post('/api/run', {})).status, 409);
    const info = await (await fetch(`${base}/api/info`, { headers: { 'x-e2e-dashboard-token': 't' } })).json();
    assert.deepEqual(info.runner, { running: true, pid: 1 });
    assert.deepEqual(await (await post('/api/run/stop', {})).json(), { stopped: true });
  } finally {
    server.close();
  }
});

test('POST /api/run needs a same-origin request like every write', async () => {
  const { server, base } = await serve({ start: () => ({ ok: true }), stop: () => false, state: () => ({ running: false }) });
  try {
    const res = await fetch(`${base}/api/run`, { method: 'POST', headers: { 'x-e2e-dashboard-token': 't', origin: 'http://evil.example', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});

test('annotateRun records who launched a run and what it reran, nothing else', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  const r = fixture();
  await archive(root, { source: 'reporter', report: r });
  await annotateRun(root, r.run.id, { launchedBy: 'dashboard', rerunOf: 'old', pinned: true });
  const { meta } = await getRun(root, r.run.id);
  assert.equal(meta.launchedBy, 'dashboard');
  assert.equal(meta.rerunOf, 'old');
  assert.equal(meta.pinned, false);
  assert.equal(meta.source, 'reporter');
});

test('settings: default workers is saved, validated and applied to dashboard runs; null means auto', async () => {
  const started = [];
  const runner = { start(o) { started.push(o); return { ok: true, pid: 1 }; }, stop: () => false, state: () => ({ running: false, pid: null }) };
  const { server, base, post } = await serve(runner);
  const get = async (p) => (await fetch(base + p, { headers: { 'x-e2e-dashboard-token': 't' } })).json();
  try {
    const s0 = await get('/api/settings');
    assert.equal(s0.workers, null);
    assert.ok(s0.autoWorkers >= 1);
    assert.equal((await post('/api/settings', { workers: 0 })).status, 400);
    assert.equal((await post('/api/settings', { workers: 2.5 })).status, 400);
    assert.equal((await (await post('/api/settings', { workers: 3 })).json()).workers, 3);
    assert.equal((await get('/api/settings')).workers, 3);
    await post('/api/run', { tests: ['tests/a.e2e.ts'] }); // no workers sent: the saved default
    await post('/api/run', { tests: ['tests/a.e2e.ts'], workers: 6 }); // per-run override
    await post('/api/run', { tests: ['tests/a.e2e.ts'], workers: null }); // auto for this run
    assert.deepEqual(started.map((o) => o.workers), [3, 6, undefined]);
    assert.equal('workers' in started[2], false);
    assert.equal((await (await post('/api/settings', { workers: null })).json()).workers, null);
    await post('/api/run', { tests: ['tests/a.e2e.ts'] });
    assert.equal('workers' in started[3], false, 'auto default sends no --workers');
  } finally {
    server.close();
  }
});

test('POST /api/run/stop: own run, terminal run (external) and nothing running', async () => {
  let child = false;
  let liveRunning = false;
  const runner = {
    start() { child = true; liveRunning = true; return { ok: true, pid: 1 }; },
    stop() { if (child) { child = false; return true; } if (liveRunning) { liveRunning = false; return true; } return false; },
    state: () => ({ running: child, pid: child ? 1 : null }),
  };
  const { server, post } = await serve(runner);
  try {
    await post('/api/run', {});
    assert.deepEqual(await (await post('/api/run/stop', {})).json(), { stopped: true });
    liveRunning = true; // a run started with `npx e2e run` in a terminal
    assert.deepEqual(await (await post('/api/run/stop', {})).json(), { stopped: true, external: true });
    assert.deepEqual(await (await post('/api/run/stop', {})).json(), { stopped: false });
  } finally {
    server.close();
  }
});
