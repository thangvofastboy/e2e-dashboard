import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, utimesSync, symlinkSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';
import { scanJunk, cleanJunk, JUNK } from '../server/junk.mjs';

const UI = fileURLToPath(new URL('../ui', import.meta.url));
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));
const put = (root, rel, c = '{}') => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), c); };
// the scan runs at SCAN; "old" and "fresh" are measured from it
const SCAN = Date.parse('2026-10-16T12:00:00Z');
const old = (path, days = 2) => { const t = new Date(SCAN - days * 86_400_000); utimesSync(path, t, t); };
const fresh = (path) => { const t = new Date(SCAN - 10 * 60_000); utimesSync(path, t, t); };
const entry = (testId, createdAt) => JSON.stringify({ schemaVersion: 'trace-1', createdAt, payload: { actions: [{}], recordedFor: { testId } } });
const hex = (n) => n.toString(16).padStart(64, '0');

async function project() {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-junk-'));
  put(root, '.e2e/report.json', JSON.stringify(fixture()));
  await archive(root, { source: 'hook' }); // one healthy run
  const d = (rel) => join(root, '.e2e-dashboard', rel);
  // half-written temp names: an old one (junk) and a fresh one (maybe still being written)
  put(root, '.e2e-dashboard/runs/.tmp-aaaaaaaaaaaa/x', 'half'); old(d('runs/.tmp-aaaaaaaaaaaa'));
  put(root, '.e2e-dashboard/runs/.tmp-bbbbbbbbbbbb/x', 'fresh'); fresh(d('runs/.tmp-bbbbbbbbbbbb'));
  put(root, '.e2e-dashboard/state/settings.json', '{}');
  put(root, '.e2e-dashboard/state/settings.json.tmp-0123456789ab', '{'); old(d('state/settings.json.tmp-0123456789ab'));
  // a run directory that never got its files, and an old one
  put(root, '.e2e-dashboard/runs/2026/10/01/broken_run/meta.json', '{}'); old(d('runs/2026/10/01/broken_run'));
  put(root, '.e2e-dashboard/runtime/server.log', 'x'.repeat(2 * 1024 * 1024));
  put(root, '.e2e-dashboard/runtime/selfheal-crash.jsonl', '{}\n');
  put(root, '.e2e-dashboard/exports/run-old.html', '<html>'); old(d('exports/run-old.html'), 8);
  put(root, '.e2e-dashboard/exports/run-new.html', '<html>'); fresh(d('exports/run-new.html'));
  put(root, '.e2e/cache/' + hex(1) + '.json', entry('tests/example.e2e.ts::opens%20app', new Date(SCAN - 86_400_000).toISOString())); // live
  put(root, '.e2e/cache/' + hex(2) + '.json', entry('tests/example.e2e.ts::deleted', new Date(SCAN - 86_400_000).toISOString())); // orphan
  put(root, '.e2e/cache/' + hex(3) + '.json', entry('tests/example.e2e.ts::opens%20app', new Date(SCAN - 90 * 86_400_000).toISOString())); // stale
  return { root, d };
}
const testIds = new Set(['tests/example.e2e.ts::opens%20app']);
const by = (scan) => Object.fromEntries(scan.categories.map((c) => [c.id, c.count]));

test('scan finds old leftovers only; the healthy run, fresh temp files and live cache entries are not junk', async () => {
  const { root } = await project();
  const scan = await scanJunk(root, { now: SCAN, testIds });
  assert.deepEqual(by(scan), { 'temp-files': 2, 'broken-runs': 1, logs: 2, exports: 1, 'replay-cache': 2, 'os-tmp': 0 });
  assert.ok(scan.bytes > 2 * 1024 * 1024);
  assert.deepEqual(Object.keys(by(scan)).sort(), Object.keys(JUNK).sort());
});

test('clean removes exactly the chosen categories and leaves everything else', async () => {
  const { root, d } = await project();
  const at = { now: SCAN, testIds };
  const r = await cleanJunk(root, ['temp-files', 'broken-runs', 'logs', 'exports', 'replay-cache'], at);
  assert.ok(r.freed > 2 * 1024 * 1024);
  assert.equal(existsSync(d('runs/.tmp-aaaaaaaaaaaa')), false);
  assert.equal(existsSync(d('state/settings.json.tmp-0123456789ab')), false);
  assert.equal(existsSync(d('runs/2026/10/01/broken_run')), false);
  assert.equal(statSync(d('runtime/server.log')).size, 0, 'the log is truncated, not deleted (the server keeps it open)');
  assert.equal(existsSync(d('runtime/selfheal-crash.jsonl')), false);
  assert.equal(existsSync(d('exports/run-old.html')), false);
  assert.equal(existsSync(join(root, '.e2e/cache/' + hex(2) + '.json')), false);
  assert.equal(existsSync(join(root, '.e2e/cache/' + hex(3) + '.json')), false);
  for (const keep of ['runs/.tmp-bbbbbbbbbbbb', 'state/settings.json', 'exports/run-new.html']) assert.ok(existsSync(d(keep)), keep);
  assert.ok(existsSync(join(root, '.e2e/cache/' + hex(1) + '.json')), 'a live replay entry stays');
  assert.equal((await (await import('../server/store.mjs')).listRuns(root)).length, 1, 'the healthy run is still there');
  assert.equal(by(await scanJunk(root, at))['temp-files'], 0, 'a second scan finds nothing left');
});

test('an unchosen category is left alone; unknown categories are refused', async () => {
  const { root, d } = await project();
  await cleanJunk(root, ['exports'], { now: SCAN, testIds });
  assert.ok(existsSync(d('runs/.tmp-aaaaaaaaaaaa')), 'temp-files was not chosen');
  await assert.rejects(cleanJunk(root, ['everything'], {}), /nhóm/);
  await assert.rejects(cleanJunk(root, [], {}), /nhóm/);
  await assert.rejects(cleanJunk(root, ['../runs'], {}), /nhóm/);
});

test('os-tmp: only old e2ed-gh-* directories we own are removed, other names are never touched', async () => {
  const { root } = await project();
  const fake = mkdtempSync(join(tmpdir(), 'e2ed-ostmp-'));
  const was = process.env.TMPDIR;
  process.env.TMPDIR = fake;
  try {
    for (const n of ['e2ed-gh-abc123', 'e2ed-gh-new123', 'other-abc123', 'e2ed-gh-toolongname']) put(fake, `${n}/f`, 'x');
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000); // this test uses the real clock
    for (const n of ['e2ed-gh-abc123', 'other-abc123', 'e2ed-gh-toolongname']) utimesSync(join(fake, n), twoDaysAgo, twoDaysAgo);
    utimesSync(join(fake, 'e2ed-gh-new123'), new Date(), new Date());
    const now = Date.now();
    assert.equal(by(await scanJunk(root, { now, testIds }))['os-tmp'], 1);
    await cleanJunk(root, ['os-tmp'], { now, testIds });
    assert.equal(existsSync(join(fake, 'e2ed-gh-abc123')), false);
    for (const keep of ['e2ed-gh-new123', 'other-abc123', 'e2ed-gh-toolongname']) assert.ok(existsSync(join(fake, keep)), keep);
  } finally {
    if (was === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = was;
  }
});

test('a symlinked exports/ or runtime/ is never followed', async () => {
  const { root, d } = await project();
  const { rmSync } = await import('node:fs');
  const outside = mkdtempSync(join(tmpdir(), 'e2ed-planted-'));
  put(outside, 'run-old.html', 'precious'); old(join(outside, 'run-old.html'), 30);
  put(outside, 'server.log', 'y'.repeat(2 * 1024 * 1024));
  rmSync(d('exports'), { recursive: true, force: true });
  rmSync(d('runtime'), { recursive: true, force: true });
  symlinkSync(outside, d('exports'));
  symlinkSync(outside, d('runtime'));
  await cleanJunk(root, ['exports', 'logs'], { now: SCAN + 30 * 86_400_000, testIds });
  assert.equal(readFileSync(join(outside, 'run-old.html'), 'utf8'), 'precious');
  assert.equal(statSync(join(outside, 'server.log')).size, 2 * 1024 * 1024);
});

test('GET /api/junk and POST /api/junk/clean', async () => {
  const { root } = await project();
  const server = http.createServer(createApp({ projectRoot: root, token: 't', uiDir: UI, live: createLive() }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const h = { 'x-e2e-dashboard-token': 't', origin: base, 'content-type': 'application/json' };
  try {
    const scan = await (await fetch(`${base}/api/junk`, { headers: h })).json();
    assert.equal(scan.categories.length, Object.keys(JUNK).length);
    assert.equal(scan.categories.every((c) => !('path' in c) && !('items' in c)), true, 'no server paths are sent to the page');
    const bad = await fetch(`${base}/api/junk/clean`, { method: 'POST', headers: h, body: JSON.stringify({ categories: ['x'] }) });
    assert.equal(bad.status, 400);
    const ok = await fetch(`${base}/api/junk/clean`, { method: 'POST', headers: h, body: JSON.stringify({ categories: ['os-tmp'] }) });
    assert.equal(ok.status, 200);
  } finally {
    server.close();
  }
});
