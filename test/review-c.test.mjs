// Regression tests cho đợt review C (reporter + store / longterm / storage / reports).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { getRun, listRuns, loadHistory } from '../server/store.mjs';
import { sendMail } from '../server/reports.mjs';
import { emptyIndex, reliability, lifecycle } from '../server/longterm.mjs';
import { storageUsage } from '../server/storage.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));
const tmp = () => mkdtempSync(join(tmpdir(), 'e2ed-'));

test('C-review: sendmail thoát sớm (EPIPE trên stdin) không làm sập tiến trình', async () => {
  const big = 'x'.repeat(5_000_000); // lớn hơn buffer pipe: chắc chắn ghi vào pipe đã đóng
  const res = await sendMail(big, { execImpl: (_c, _a, o, cb) => execFile(process.execPath, ['-e', 'process.exit(3)'], o, cb) });
  assert.equal(res.ok, false);
  await new Promise((r) => setTimeout(r, 200)); // lỗi 'error' chưa bắt sẽ nổ ở tick sau
});

test('C-review: report.json / meta.json là symlink trong thư mục run thì không được đọc theo', async () => {
  const root = tmp();
  const r = fixture();
  const { runDir } = await archive(root, { source: 'hook', report: r });
  const secret = join(tmp(), 'secret.json');
  writeFileSync(secret, JSON.stringify({ ...r, leaked: 'SECRET' }));
  rmSync(join(runDir, 'report.json'));
  symlinkSync(secret, join(runDir, 'report.json'));
  await assert.rejects(getRun(root, r.run.id));
  assert.deepEqual(await loadHistory(root, 10), []);

  const root2 = tmp();
  const { runDir: d2 } = await archive(root2, { source: 'hook', report: r });
  const metaSecret = join(tmp(), 'meta.json');
  writeFileSync(metaSecret, JSON.stringify({ runId: r.run.id, leaked: 'SECRET' }));
  rmSync(join(d2, 'meta.json'));
  symlinkSync(metaSecret, join(d2, 'meta.json'));
  assert.deepEqual(await listRuns(root2), []);
  assert.equal(await getRun(root2, r.run.id), null);
});

test('C-review: reliability / lifecycle không vỡ stack khi index.seen rất lớn', () => {
  const index = emptyIndex();
  const base = Date.parse('2024-01-01T00:00:00Z');
  for (let i = 0; i < 200_000; i++) index.seen[`run-${i}`] = new Date(base + i * 60_000).toISOString();
  index.tests.k = { title: 't', file: 'a.e2e.ts', line: 1, target: 'web', firstSeen: new Date(base).toISOString(), lastSeen: new Date(base + 199_999 * 60_000).toISOString(), runs: 1, fails: 0, flaky: 0, durMs: 0, incidents: [] };
  const now = base + 200_000 * 60_000;
  assert.doesNotThrow(() => reliability(index, { now }));
  const l = lifecycle(index, { now });
  assert.equal(l.active, 1, 'latest tính đúng: test vừa chạy vẫn còn hoạt động');
});

test('C-review: storageUsage không hỏng khi một file không lstat được (bị xoá giữa chừng)', { skip: process.getuid?.() === 0 }, async () => {
  const root = tmp();
  const { runDir } = await archive(root, { source: 'hook', report: fixture() });
  const locked = join(runDir, 'artifacts');
  mkdirSync(locked, { recursive: true });
  writeFileSync(join(locked, 'a.webm'), 'v');
  chmodSync(locked, 0o444); // readdir được, lstat từng file thì không (như file vừa bị xoá)
  try {
    const u = await storageUsage(root);
    assert.equal(u.runs.length, 1);
    assert.ok(u.totals.report > 0);
  } finally {
    chmodSync(locked, 0o755);
  }
});
