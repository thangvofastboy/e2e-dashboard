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
    const ok = await post('/api/run', { tests: ['tests/a.e2e.ts:3'], rerunOf: 'r1' });
    assert.equal(ok.status, 202);
    assert.deepEqual(started[0], { tests: ['tests/a.e2e.ts:3'], rerunOf: 'r1' });
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
