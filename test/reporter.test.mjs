import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReporter } from '../reporter/e2e-dashboard.reporter.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));

function project({ server = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  mkdirSync(join(root, '.e2e-dashboard'), { recursive: true });
  if (server) writeFileSync(join(root, '.e2e-dashboard/server.json'), JSON.stringify({ port: 4477, token: 't0k', pid: 1 }));
  return root;
}
const started = (root) => ({ type: 'run-started', seq: 0, at: '2026-07-24T12:00:00.000Z', projectRoot: root, artifactsRoot: join(root, '.e2e/results') });
const finished = (root) => ({ report: fixture(), status: 'failed', exitCode: 1, projectRoot: root, reportPath: undefined, artifactsRoot: join(root, '.e2e/results'), traces: new Map() });

test('posts every event to the running dashboard with the token', async () => {
  const root = project();
  const calls = [];
  const r = createReporter({ env: {}, fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true }; } });
  r.onEvent(started(root));
  r.onEvent({ type: 'plan', seq: 1, total: 2, files: [] });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'http://127.0.0.1:4477/api/events');
  assert.equal(calls[0].init.headers['x-e2e-dashboard-token'], 't0k');
  assert.equal(JSON.parse(calls[1].init.body).type, 'plan');
});

test('does nothing on CI', async () => {
  const root = project();
  const calls = [];
  const r = createReporter({ env: { CI: 'true' }, fetchImpl: async (...a) => calls.push(a) });
  r.onEvent(started(root));
  assert.equal(await r.onRunFinished(finished(root), new AbortController().signal), undefined);
  assert.equal(calls.length, 0);
});

test('never throws: rejected fetch, garbage event, missing server', async () => {
  const root = project({ server: false });
  const r = createReporter({ env: {}, fetchImpl: () => Promise.reject(new Error('ECONNREFUSED')) });
  assert.doesNotThrow(() => r.onEvent(null));
  assert.doesNotThrow(() => r.onEvent(started(root)));
  assert.doesNotThrow(() => r.onEvent({ type: 'plan' }));
});

test('archives the finished run and returns a dashboard row', async () => {
  const root = project();
  const r = createReporter({ env: {}, fetchImpl: async () => ({ ok: true }) });
  r.onEvent(started(root));
  const rows = await r.onRunFinished(finished(root), new AbortController().signal);
  assert.equal(readdirSync(join(root, '.e2e-dashboard/runs')).length, 1);
  assert.equal(rows[0].label, 'Dashboard');
  assert.match(rows[0].text, /^http:\/\/127\.0\.0\.1:4477\/#\/run\//);
});

test('skips archive when the signal is already aborted', async () => {
  const root = project();
  const r = createReporter({ env: {}, fetchImpl: async () => ({ ok: true }) });
  const ac = new AbortController();
  ac.abort();
  assert.equal(await r.onRunFinished(finished(root), ac.signal), undefined);
});
