// Regression tests for the final whole-branch review (C1, C2, I1–I6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive, applyRetention } from '../reporter/e2e-dashboard.reporter.mjs';
import { exportRun, buildExportHtml } from '../server/export.mjs';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';
import { testHistory } from '../server/store.mjs';
import { patchConfig } from '../bin/dashboard.mjs';
import { mediaSrc } from '../ui/views/run.js';
import { createHash } from 'node:crypto';

const UI = fileURLToPath(new URL('../ui', import.meta.url));
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));
const put = (root, rel, c) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), c); };
const victim = () => { const d = mkdtempSync(join(tmpdir(), 'victim-')); writeFileSync(join(d, 'secret'), 'TOPSECRET-123'); return join(d, 'secret'); };
const tmp = () => mkdtempSync(join(tmpdir(), 'e2ed-'));

test('C1: export replaces a planted symlink instead of writing through it', async () => {
  const root = tmp();
  const r = fixture();
  await archive(root, { source: 'hook', report: r });
  const target = victim();
  mkdirSync(join(root, '.e2e-dashboard/exports'), { recursive: true });
  symlinkSync(target, join(root, `.e2e-dashboard/exports/run-${r.run.id}.html`));
  await exportRun(root, r.run.id);
  assert.equal(readFileSync(target, 'utf8'), 'TOPSECRET-123');
});

test('C1: archive refuses a symlinked data or runs directory', async () => {
  for (const link of ['.e2e-dashboard', '.e2e-dashboard/runs']) {
    const root = tmp();
    const outside = mkdtempSync(join(tmpdir(), 'victim-'));
    mkdirSync(dirname(join(root, link)), { recursive: true });
    symlinkSync(outside, join(root, link));
    const res = await archive(root, { source: 'hook', report: fixture() });
    assert.equal(res.status, 'skipped', link);
    assert.deepEqual(readdirSync(outside), [], link);
  }
});

test('C1: retention ignores a non-positive or non-numeric keep', async () => {
  const root = tmp();
  await archive(root, { source: 'hook', report: fixture() });
  assert.deepEqual(await applyRetention(root, 0), []);
  assert.deepEqual(await applyRetention(root, 'all'), []);
});

test('C2: artifacts and traces that are symlinks out of the results dir are not copied', async () => {
  const root = tmp();
  const r = fixture();
  r.run.results[0].status = 'failed';
  const a = r.run.results[0].attempts[0];
  a.artifacts = [{ id: 'n', kind: 'log', mediaType: 'text/plain', path: 'x/notes.txt', redaction: 'complete', producer: { kind: 'attempt' } }];
  put(root, '.e2e/report.json', JSON.stringify(r));
  mkdirSync(join(root, '.e2e/results/x'), { recursive: true });
  symlinkSync(victim(), join(root, '.e2e/results/x/notes.txt'));
  mkdirSync(join(root, `.e2e/results/t-${r.run.results[0].id.slice(0, 16)}`), { recursive: true });
  symlinkSync(victim(), join(root, `.e2e/results/t-${r.run.results[0].id.slice(0, 16)}/trace.md`));
  const res = await archive(root, { source: 'hook' });
  assert.equal(existsSync(join(res.runDir, 'artifacts/x/notes.txt')), false);
  assert.deepEqual(JSON.parse(readFileSync(join(res.runDir, 'meta.json'), 'utf8')).traces, {});
});

test('C2: export and /files never follow symlinks planted inside a run directory', async () => {
  const root = tmp();
  const r = fixture();
  const { runDir } = await archive(root, { source: 'hook', report: r });
  mkdirSync(join(runDir, 'artifacts'), { recursive: true });
  symlinkSync(victim(), join(runDir, 'artifacts/leak.txt'));
  const { html } = await buildExportHtml(root, r.run.id);
  assert.ok(!html.includes(Buffer.from('TOPSECRET-123').toString('base64')));
  const server = http.createServer(createApp({ projectRoot: root, token: 't', uiDir: UI, live: createLive() }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/files/runs/${r.run.id}/artifacts/leak.txt`, { headers: { 'x-e2e-dashboard-token': 't' } });
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});

test('I1: screenshot/video urls must be http(s)', () => {
  assert.equal(mediaSrc('r', { url: 'javascript:alert(1)' }), null);
  assert.equal(mediaSrc('r', { url: '\u0001https://x' }), null);
  assert.equal(mediaSrc('r', { url: 'https://cdn/v.mp4' }), 'https://cdn/v.mp4');
});

test('I1: export carries a CSP whose hashes match its inline scripts', async () => {
  const root = tmp();
  const r = fixture();
  await archive(root, { source: 'hook', report: r });
  const { html } = await buildExportHtml(root, r.run.id);
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1];
  assert.ok(csp, 'csp meta present');
  assert.match(csp, /default-src 'none'/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 2);
  for (const s of scripts) assert.ok(csp.includes(`'sha256-${createHash('sha256').update(s).digest('base64')}'`));
});

test('I2: patchConfig refuses reporters arrays it cannot edit safely', () => {
  for (const src of [
    "export default {\n  reporters: [['list', { verbose: true }], 'json'],\n};\n",
    "export default {\n  reporters: ['list', upload({ url: 'x' })],\n};\n",
    "export default {\n  reporters: ['list', // keep\n  ],\n};\n",
  ]) assert.equal(patchConfig(src).reason, 'unknown-shape', src);
});

test('I3: serial-group tests get their duration from member attempts', async () => {
  const root = tmp();
  const r = fixture();
  const res0 = r.run.results[0];
  res0.attempts = [];
  res0.serialGroupId = 'g1';
  r.run.serialGroups = [{ id: 'g1', serialId: 's', declarationIndex: 0, file: res0.file, source: res0.source, titlePath: ['g'], targetId: 'web', platform: 'web', memberTestIds: [res0.testId], status: 'passed',
    attempts: [{ id: 'ga', index: 0, status: 'passed', startedAt: r.run.startedAt, durationMs: 700, artifacts: [], secondaryErrors: [], cleanup: 'complete',
      members: [{ id: 'm', index: 0, testId: res0.testId, status: 'passed', startedAt: r.run.startedAt, durationMs: 700, steps: [], secondaryErrors: [] }] }] }];
  await archive(root, { source: 'hook', report: r });
  const row = (await testHistory(root)).find((x) => x.testId === res0.testId);
  assert.equal(row.avgDurationMs, 700);
});

test('I3: live falls back to wall-clock duration when a finished result has no attempts', () => {
  const live = createLive();
  live.apply({ type: 'run-started', at: '2026-07-24T12:00:00.000Z', runId: 'r' });
  live.apply({ type: 'test-started', at: '2026-07-24T12:00:01.000Z', testId: 'A', agent: 'default', repeat: 0, title: 'A', file: 'a', target: 'web' });
  live.apply({ type: 'test-finished', at: '2026-07-24T12:00:03.500Z', result: { testId: 'A', targetId: 'web', agent: 'default', repeat: 0, status: 'passed', attempts: [] } });
  assert.equal(live.snapshot().tests[0].durationMs, 2500);
});

test('I4/I5: cookie is per port; /api/info reports the last skipped archive', async () => {
  const root = tmp();
  const server = http.createServer(createApp({ projectRoot: root, token: 'tok', uiDir: UI, live: createLive(), lastArchive: () => ({ status: 'skipped', reason: 'unsupported-schema' }) }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const red = await fetch(`${base}/?token=tok`, { redirect: 'manual' });
    assert.match(red.headers.get('set-cookie'), new RegExp(`^e2ed_${server.address().port}=tok;`));
    const info = await (await fetch(`${base}/api/info`, { headers: { cookie: `e2ed_${server.address().port}=tok` } })).json();
    assert.deepEqual(info.lastArchive, { status: 'skipped', reason: 'unsupported-schema' });
  } finally {
    server.close();
  }
});

test('I6: the data directory ignores itself in git', async () => {
  const root = tmp();
  await archive(root, { source: 'hook', report: fixture() });
  assert.equal(readFileSync(join(root, '.e2e-dashboard/.gitignore'), 'utf8'), '*\n');
});

test('/api/info passes thresholds from .e2e-dashboard/config.json to the UI', async () => {
  const root = tmp();
  put(root, '.e2e-dashboard/config.json', JSON.stringify({ thresholds: { passRate: { good: 0.99 } } }));
  const server = http.createServer(createApp({ projectRoot: root, token: 't', uiDir: UI, live: createLive() }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const info = await (await fetch(`http://127.0.0.1:${server.address().port}/api/info`, { headers: { 'x-e2e-dashboard-token': 't' } })).json();
    assert.deepEqual(info.thresholds, { passRate: { good: 0.99 } });
  } finally {
    server.close();
  }
});
