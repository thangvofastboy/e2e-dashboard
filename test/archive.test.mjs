import { listRunDirsSync } from '../reporter/e2e-dashboard.reporter.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { archive, applyRetention, safeJoin } from '../reporter/e2e-dashboard.reporter.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));
const VIDEO = 'web/tests_example.e2e.ts__opens_app/attempt-0/video/video.webm';

function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

// Project with .e2e/report.json, a video artifact and a trace page next to it.
function makeProject(mutate = (r) => r) {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  const report = mutate(fixture());
  put(root, '.e2e/report.json', JSON.stringify(report));
  put(root, `.e2e/results/${VIDEO}`, 'webm');
  put(root, '.e2e/results/web/tests_example.e2e.ts__opens_app/trace.md', '# trace');
  return { root, report };
}

const runs = (root) => listRunDirsSync(join(root, '.e2e-dashboard/runs')).filter((n) => !n.startsWith('.'));
const failFirst = (r) => { r.run.results[0].status = 'failed'; return r; };

test('archives report from disk with artifacts and trace of non-passed results', async () => {
  const { root, report } = makeProject(failFirst);
  const res = await archive(root, { source: 'hook' });
  assert.equal(res.status, 'archived');
  const meta = JSON.parse(readFileSync(join(res.runDir, 'meta.json'), 'utf8'));
  assert.equal(meta.source, 'hook');
  assert.ok(existsSync(join(res.runDir, 'report.json')));
  assert.ok(existsSync(join(res.runDir, 'artifacts', VIDEO)));
  const id = report.run.results[0].id;
  assert.equal(meta.traces[id], `traces/${id}.md`);
  assert.equal(readFileSync(join(res.runDir, meta.traces[id]), 'utf8'), '# trace');
});

test('does not copy artifacts of passed results', async () => {
  const { root } = makeProject((r) => { r.run.results[1].attempts[0].artifacts = []; return r; });
  const res = await archive(root, { source: 'hook' });
  assert.equal(existsSync(join(res.runDir, 'artifacts', VIDEO)), false);
});

test('second archive of the same run is a no-op', async () => {
  const { root } = makeProject();
  await archive(root, { source: 'hook' });
  assert.equal((await archive(root, { source: 'watcher' })).status, 'exists');
  assert.equal(runs(root).length, 1);
});

test('concurrent archives of the same run produce one run directory', async () => {
  const { root } = makeProject();
  const results = await Promise.all([archive(root, { source: 'reporter' }), archive(root, { source: 'watcher' })]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['archived', 'exists']);
  assert.equal(runs(root).length, 1);
});

test('artifact paths escaping the artifacts root are ignored', async () => {
  const { root } = makeProject((r) => {
    failFirst(r);
    r.run.results[0].attempts[0].artifacts[0].path = '../../../outside.txt';
    return r;
  });
  put(root, 'outside.txt', 'secret');
  const res = await archive(root, { source: 'hook' });
  assert.equal(res.status, 'archived');
  assert.equal(existsSync(join(res.runDir, 'outside.txt')), false);
  assert.equal(safeJoin('/a/b', '../c'), null);
  assert.equal(safeJoin('/a/b', '/etc/passwd'), null);
  assert.equal(safeJoin('/a/b', 'c/d'), '/a/b/c/d');
});

test('unsupported schema and half-written report are skipped', async () => {
  const { root } = makeProject((r) => { r.schemaVersion = 'report-2'; return r; });
  assert.deepEqual(await archive(root, { source: 'hook' }), { status: 'skipped', reason: 'unsupported-schema' });
  writeFileSync(join(root, '.e2e/report.json'), '{"schemaVersion":"rep');
  assert.deepEqual(await archive(root, { source: 'hook' }), { status: 'skipped', reason: 'unreadable' });
  const empty = mkdtempSync(join(tmpdir(), 'e2ed-'));
  assert.deepEqual(await archive(empty, { source: 'hook' }), { status: 'skipped', reason: 'no-report' });
});

test('in-memory report archives even when reportPath is undefined', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  const res = await archive(root, { source: 'reporter', report: fixture(), reportPath: undefined });
  assert.equal(res.status, 'archived');
});

test('explicit traces map is used when given', async () => {
  const { root, report } = makeProject(failFirst);
  put(root, 'custom/trace.md', '# custom');
  const id = report.run.results[0].id;
  const res = await archive(root, { source: 'reporter', report, traces: new Map([[id, 'custom/trace.md']]) });
  assert.equal(readFileSync(join(res.runDir, `traces/${id}.md`), 'utf8'), '# custom');
});

test('retention keeps the newest N and every pinned run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  const dirs = [];
  for (let i = 0; i < 4; i++) {
    const r = fixture();
    r.run.id = `018f0f5c-7b2a-7abc-8abc-00000000000${i}`;
    r.run.startedAt = `2026-07-2${i}T12:00:00.000Z`;
    dirs.push((await archive(root, { source: 'hook', report: r, keep: 100 })).runDir);
  }
  const metaPath = join(dirs[0], 'meta.json');
  writeFileSync(metaPath, JSON.stringify({ ...JSON.parse(readFileSync(metaPath, 'utf8')), pinned: true }));
  const removed = await applyRetention(root, 2);
  assert.equal(removed.length, 1);
  assert.ok(removed[0].includes('00000000001'));
  assert.equal(runs(root).length, 3);
  assert.deepEqual(await applyRetention(root, 2), []);
});

test('run ids that are not uuids are rejected before touching the filesystem', async () => {
  const { root } = makeProject((r) => { r.run.id = '../../escape'; return r; });
  assert.deepEqual(await archive(root, { source: 'hook' }), { status: 'skipped', reason: 'unsupported-schema' });
  assert.equal(existsSync(join(root, 'escape')), false);
  assert.equal(existsSync(join(root, '.e2e-dashboard', 'escape')), false);
});

test('startedAt cannot inject path segments into the run directory name', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  const r = fixture();
  r.run.startedAt = '2026/../../x';
  const res = await archive(root, { source: 'reporter', report: r });
  assert.equal(res.status, 'archived');
  assert.equal(dirname(res.runDir), join(root, '.e2e-dashboard/runs'));
});

test('result ids that are not hex digests never become trace file names', async () => {
  const { root, report } = makeProject(failFirst);
  put(root, 'custom/trace.md', '# custom');
  const res = await archive(root, { source: 'reporter', report, traces: new Map([['../../../pwned', 'custom/trace.md']]) });
  assert.equal(res.status, 'archived');
  assert.equal(existsSync(join(root, '.e2e-dashboard', 'pwned.md')), false);
  assert.equal(existsSync(join(root, 'pwned.md')), false);
  assert.deepEqual(JSON.parse(readFileSync(join(res.runDir, 'meta.json'), 'utf8')).traces, {});
});

test('without a traces map, a trace is matched by the result id suffix of its directory (passed tests too)', async () => {
  const { root, report } = makeProject();
  const passed = report.run.results.find((r) => r.status === 'passed');
  put(root, `.e2e/results/example-opens-app-${passed.id.slice(0, 16)}/trace.md`, '# by id');
  const res = await archive(root, { source: 'hook' });
  const meta = JSON.parse(readFileSync(join(res.runDir, 'meta.json'), 'utf8'));
  assert.equal(readFileSync(join(res.runDir, meta.traces[passed.id]), 'utf8'), '# by id');
});

test('meta.unredacted counts archived videos / downloads whose redaction is incomplete', async () => {
  const { root } = makeProject(failFirst); // the fixture's local video and its hosted copy are both "incomplete"
  const res = await archive(root, { source: 'hook' });
  assert.equal(JSON.parse(readFileSync(join(res.runDir, 'meta.json'), 'utf8')).unredacted, 2);
  const clean = makeProject((r) => { failFirst(r); for (const x of r.run.results) for (const at of x.attempts) for (const a of at.artifacts ?? []) a.redaction = 'complete'; return r; });
  assert.equal(JSON.parse(readFileSync(join((await archive(clean.root, { source: 'hook' })).runDir, 'meta.json'), 'utf8')).unredacted, undefined);
});
