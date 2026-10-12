import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { listRuns, getRun, setFlag, testHistory, findRunDir } from '../server/store.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));
const id = (i) => `018f0f5c-7b2a-7abc-8abc-00000000000${i}`;

async function projectWithRuns(n) {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  for (let i = 0; i < n; i++) {
    const r = fixture();
    r.run.id = id(i);
    r.run.startedAt = `2026-07-2${i}T12:00:00.000Z`;
    r.run.results[0].status = i % 2 ? 'failed' : 'passed';
    await archive(root, { source: 'hook', report: r });
  }
  return root;
}

test('listRuns returns newest first', async () => {
  const root = await projectWithRuns(3);
  assert.deepEqual((await listRuns(root)).map((m) => m.runId), [id(2), id(1), id(0)]);
  assert.deepEqual(await listRuns(mkdtempSync(join(tmpdir(), 'e2ed-'))), []);
});

test('getRun returns meta and report; unknown or malicious ids return null', async () => {
  const root = await projectWithRuns(1);
  const run = await getRun(root, id(0));
  assert.equal(run.report.run.id, id(0));
  assert.equal(run.meta.runId, id(0));
  assert.equal(await getRun(root, id(9)), null);
  assert.equal(await findRunDir(root, '../../etc'), null);
});

test('pin persists and baseline is exclusive', async () => {
  const root = await projectWithRuns(2);
  assert.equal((await setFlag(root, id(0), 'pinned', true)).pinned, true);
  await setFlag(root, id(0), 'baseline', true);
  await setFlag(root, id(1), 'baseline', true);
  const metas = await listRuns(root);
  assert.deepEqual(metas.filter((m) => m.baseline).map((m) => m.runId), [id(1)]);
  assert.equal(metas.find((m) => m.runId === id(0)).pinned, true);
  await assert.rejects(setFlag(root, id(0), 'dir', true));
});

test('testHistory lists each test with per-run statuses, newest first', async () => {
  const root = await projectWithRuns(3);
  const rows = await testHistory(root, 10);
  const row = rows.find((r) => r.testId === fixture().run.results[0].testId);
  assert.deepEqual(row.history.map((h) => h.status), ['passed', 'failed', 'passed']);
  assert.equal(row.target, 'web');
  assert.equal(row.title, 'opens app');
  assert.equal(row.line, 3);
  assert.ok(row.avgDurationMs > 0);
});

test('report cache is capped by bytes (LRU) and does not keep a broken report', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const store = await import('../server/store.mjs');
  const root = mkdtempSync(join(tmpdir(), 'rc-'));
  const runs = join(root, '.e2e-dashboard', 'runs');
  const big = JSON.stringify({ run: { results: [], pad: 'x'.repeat(Math.ceil(store.REPORT_CACHE_BYTES / 2.5)) } });
  for (const [i, d] of ['a', 'b', 'c'].entries()) {
    mkdirSync(join(runs, d), { recursive: true });
    writeFileSync(join(runs, d, 'meta.json'), JSON.stringify({ runId: d, startedAt: `2026-10-0${i + 1}T00:00:00Z`, status: 'passed' }));
    writeFileSync(join(runs, d, 'report.json'), big);
  }
  const h = await store.loadHistory(root, 3); // 3 × 40% budget: chỉ giữ 2 report mới nhất
  assert.equal(h.length, 3);
  writeFileSync(join(runs, 'a', 'report.json'), '{broken'); // a đã bị đẩy khỏi cache → đọc lại từ đĩa, fail
  assert.equal((await store.loadHistory(root, 3)).length, 2);
  writeFileSync(join(runs, 'a', 'report.json'), big); // lỗi không bị cache: sửa file là đọc lại được
  assert.equal((await store.loadHistory(root, 3)).length, 3);
});
