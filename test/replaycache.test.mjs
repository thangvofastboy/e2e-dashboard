import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { listCache, clearCache } from '../server/replaycache.mjs';

const UI = fileURLToPath(new URL('../ui', import.meta.url));
const hex = (n) => n.toString(16).padStart(64, '0');
const entry = (testId, createdAt, actions = 2) => JSON.stringify({ schemaVersion: 'trace-1', createdAt, payload: { actions: Array.from({ length: actions }, () => ({})), summary: 'did it', recordedFor: { testId, targetId: 'web', instructionDigest: 'ab'.repeat(32), agent: 'default' } } });

function project() {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-cache-'));
  const dir = join(root, '.e2e/cache');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${hex(1)}.json`), entry('tests/a.e2e.ts::t1', '2026-10-12T00:00:00Z'));
  writeFileSync(join(dir, `${hex(2)}.json`), entry('tests/a.e2e.ts::gone', '2026-01-01T00:00:00Z', 5));
  writeFileSync(join(dir, `${hex(3)}.json`), '{ not json');
  writeFileSync(join(dir, 'notes.txt'), 'ignored');
  return { root, dir };
}
const NOW = Date.parse('2026-10-13T00:00:00Z');

test('listCache reads entries, flags stale and orphan ones, counts unreadable files', async () => {
  const { root } = project();
  const out = await listCache(root, { now: NOW, testIds: new Set(['tests/a.e2e.ts::t1']) });
  assert.equal(out.entries.length, 2);
  assert.equal(out.unreadable, 1);
  const [a, b] = out.entries;
  assert.deepEqual([a.testId, a.actions, a.stale, a.orphan, a.instruction], ['tests/a.e2e.ts::t1', 2, false, false, 'abababababab']);
  assert.deepEqual([b.actions, b.stale, b.orphan], [5, true, true]);
});

test('clearCache removes by id, by test, orphans or everything, and only digest-named files', async () => {
  const { root, dir } = project();
  assert.equal(await clearCache(root, { ids: [hex(1)] }), 1);
  assert.equal(await clearCache(root, { orphansOf: new Set(['tests/a.e2e.ts::t1']) }), 1); // the orphan, not the unreadable file
  assert.deepEqual(readdirSync(dir).sort(), [`${hex(3)}.json`, 'notes.txt']);
  assert.equal(await clearCache(root, {}), 0); // unreadable entries are left for `e2e cache clear`
});

test('a symlinked cache directory is not followed outside the project', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-cache-'));
  const outside = mkdtempSync(join(tmpdir(), 'e2ed-out-'));
  writeFileSync(join(outside, `${hex(9)}.json`), entry('x', '2026-10-12T00:00:00Z'));
  mkdirSync(join(root, '.e2e'));
  symlinkSync(outside, join(root, '.e2e/cache'));
  assert.equal((await listCache(root, { now: NOW })).entries.length, 0);
  assert.equal(await clearCache(root, { all: true }), 0);
  assert.equal(readdirSync(outside).length, 1);
});

test('GET /api/cache and POST /api/cache/clear', async () => {
  const { root, dir } = project();
  const server = http.createServer(createApp({ projectRoot: root, token: 't', uiDir: UI, live: createLive() }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const h = { 'x-e2e-dashboard-token': 't', origin: base, 'content-type': 'application/json' };
  try {
    const v = await (await fetch(`${base}/api/cache`, { headers: h })).json();
    assert.equal(v.entries.length, 2);
    assert.equal(v.tests.length, 2);
    const post = (b) => fetch(`${base}/api/cache/clear`, { method: 'POST', headers: h, body: JSON.stringify(b) });
    assert.equal((await post({})).status, 400); // never clears everything by accident
    assert.equal((await post({ ids: ['../x'] })).status, 400);
    assert.deepEqual(await (await post({ testId: 'tests/a.e2e.ts::gone' })).json(), { removed: 1 });
    assert.equal((await post({ orphans: true })).status, 409); // no run archived yet: nothing says which tests exist
    assert.deepEqual(await (await post({ all: true })).json(), { removed: 1 });
    assert.deepEqual(readdirSync(dir).sort(), [`${hex(3)}.json`, 'notes.txt']);
  } finally {
    server.close();
  }
});
