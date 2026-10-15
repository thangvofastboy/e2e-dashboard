import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archive, listRunDirsSync } from '../reporter/e2e-dashboard.reporter.mjs';
import { testHistory, cachedCounts, listRuns } from '../server/store.mjs';
import { deleteRun } from '../server/storage.mjs';
import { syncIndex, indexedTestHistory, indexedCounts, indexAvailable, indexPath, closeIndex, sqliteSupport } from '../server/runindex.mjs';
import { writeSettings } from '../server/settings.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));

async function project(n = 3) {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-idx-'));
  for (let i = 0; i < n; i++) {
    const r = fixture();
    r.run.id = `018f0f5c-7b2a-7abc-8abc-00000000010${i}`;
    r.run.startedAt = `2026-10-1${i}T12:00:00.000Z`;
    await archive(root, { source: 'hook', report: r, keep: 100 });
  }
  return root;
}

test('runs are archived as runs/YYYY/MM/DD/<time>_<id>', async () => {
  const root = await project(2);
  assert.deepEqual(listRunDirsSync(join(root, '.e2e-dashboard/runs')), ['2026/10/11/12-00-00-000Z_018f0f5c-7b2a-7abc-8abc-000000000101', '2026/10/10/12-00-00-000Z_018f0f5c-7b2a-7abc-8abc-000000000100']);
});

test('SQLite index answers exactly like reading the files, follows deletions, rebuilds when removed', { skip: !indexAvailable() && 'node:sqlite không có' }, async () => {
  const root = await project(3);
  assert.equal(await syncIndex(root), null, 'mặc định tắt: không có chỉ mục');
  assert.equal(await indexedTestHistory(root, 10), null);
  await writeSettings(root, { sqlite: true });
  assert.deepEqual((await syncIndex(root)), { added: 3, removed: 0, total: 3 });
  assert.deepEqual((await syncIndex(root)).added, 0); // lần hai: không parse lại
  const byKey = (rows) => Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.deepEqual(byKey(await indexedTestHistory(root, 10)), byKey(await testHistory(root, 10)));
  const counts = await indexedCounts(root);
  for (const m of await listRuns(root)) assert.deepEqual(counts.get(m.runId), await cachedCounts(root, m.dir));
  const victim = (await listRuns(root))[0];
  await deleteRun(root, victim.runId);
  assert.equal((await syncIndex(root)).removed, 1);
  assert.equal((await indexedTestHistory(root, 10))[0].history.length, 2);
  closeIndex(root);
  rmSync(indexPath(root));
  assert.equal((await syncIndex(root)).added, 2); // xoá file chỉ mục: tự dựng lại
  assert.ok(existsSync(indexPath(root)));
  assert.ok(!existsSync(join(root, '.e2e-dashboard/runs/2026/10/12')), 'thư mục ngày rỗng được dọn');
});

test('SQLite needs Node ≥ 22.13 with node:sqlite', () => {
  assert.equal(sqliteSupport('22.12.0', true).ok, false);
  assert.match(sqliteSupport('22.12.0', true).reason, /22\.13.*v22\.12\.0/);
  assert.equal(sqliteSupport('22.13.0', true).ok, true);
  assert.equal(sqliteSupport('23.3.0', true).ok, false);
  assert.equal(sqliteSupport('24.0.0', true).ok, true);
  assert.equal(sqliteSupport('24.0.0', false).ok, false);
});

test('a report.json planted as a symlink is not indexed', { skip: !indexAvailable() && 'node:sqlite không có' }, async () => {
  const { renameSync, symlinkSync } = await import('node:fs');
  const root = await project(2);
  const [newest] = await listRuns(root);
  const rep = join(root, '.e2e-dashboard/runs', newest.dir, 'report.json');
  const outside = join(mkdtempSync(join(tmpdir(), 'e2ed-out-')), 'x.json');
  renameSync(rep, outside);
  symlinkSync(outside, rep);
  await writeSettings(root, { sqlite: true });
  assert.deepEqual(await syncIndex(root), { added: 1, removed: 0, total: 2 });
  assert.equal((await indexedCounts(root)).has(newest.runId), false);
  closeIndex(root);
});
