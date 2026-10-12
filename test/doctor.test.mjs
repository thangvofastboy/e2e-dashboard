import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archive, listRunDirsSync, runDirName } from '../reporter/e2e-dashboard.reporter.mjs';
import { listRuns } from '../server/store.mjs';
import { readState } from '../server/jsonstate.mjs';
import { doctor } from '../server/doctor.mjs';
import { main } from '../bin/dashboard.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));

// project theo bố cục cũ: run phẳng, file trạng thái ở gốc .e2e-dashboard
async function legacyProject() {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-doc-'));
  const runs = join(root, '.e2e-dashboard/runs');
  for (let i = 0; i < 2; i++) {
    const r = fixture();
    r.run.id = `018f0f5c-7b2a-7abc-8abc-00000000020${i}`;
    r.run.startedAt = `2026-09-0${i + 1}T08:30:00.000Z`;
    const out = await archive(root, { source: 'hook', report: r, keep: 100 });
    mkdirSync(runs, { recursive: true });
    renameSync(out.runDir, join(runs, runDirName(r))); // giả lập reporter bản cũ: runs/<ISO>_<id>
  }
  writeFileSync(join(root, '.e2e-dashboard/triage.json'), JSON.stringify({ x: { status: 'known' } }));
  writeFileSync(join(root, '.e2e-dashboard/live.json'), '{}');
  return root;
}

test('dashboard reads the old layout before doctor; dry-run changes nothing', async () => {
  const root = await legacyProject();
  assert.equal((await listRuns(root)).length, 2);
  assert.deepEqual(await readState(root, 'triage.json', {}), { x: { status: 'known' } }); // đọc vị trí cũ
  const before = listRunDirsSync(join(root, '.e2e-dashboard/runs'));
  const r = await doctor(root, { dryRun: true });
  assert.match(r.lines.join('\n'), /Sẽ chuyển 2 run/);
  assert.deepEqual(listRunDirsSync(join(root, '.e2e-dashboard/runs')), before);
  assert.ok(existsSync(join(root, '.e2e-dashboard/triage.json')));
});

test('doctor moves runs into runs/YYYY/MM/DD and state / runtime files, keeps data readable, is idempotent', async () => {
  const root = await legacyProject();
  const r = await doctor(root);
  assert.match(r.lines.join('\n'), /Đã chuyển 2 run/);
  assert.match(r.lines.join('\n'), /Đã chuyển 2 file/);
  assert.deepEqual(listRunDirsSync(join(root, '.e2e-dashboard/runs')), ['2026/09/02/08-30-00-000Z_018f0f5c-7b2a-7abc-8abc-000000000201', '2026/09/01/08-30-00-000Z_018f0f5c-7b2a-7abc-8abc-000000000200']);
  assert.ok(existsSync(join(root, '.e2e-dashboard/state/triage.json')) && !existsSync(join(root, '.e2e-dashboard/triage.json')));
  assert.ok(existsSync(join(root, '.e2e-dashboard/runtime/live.json')));
  assert.equal((await listRuns(root)).length, 2);
  assert.deepEqual(await readState(root, 'triage.json', {}), { x: { status: 'known' } });
  assert.match((await doctor(root)).lines.join('\n'), /không có gì để chuyển|chỉ mục/);
});

test('doctor never follows symlinks and never overwrites the new location', async () => {
  const root = await legacyProject();
  const outside = mkdtempSync(join(tmpdir(), 'victim-'));
  symlinkSync(outside, join(root, '.e2e-dashboard/runs/2026-09-09T00-00-00-000Z_018f0f5c-7b2a-7abc-8abc-000000000299'));
  mkdirSync(join(root, '.e2e-dashboard/state'), { recursive: true });
  writeFileSync(join(root, '.e2e-dashboard/state/triage.json'), '{"new":1}');
  const r = await doctor(root);
  assert.match(r.warn.join('\n'), /Bỏ qua .*2026-09-09/);
  assert.match(r.warn.join('\n'), /Đã có ở chỗ mới.*triage\.json/);
  assert.equal(readFileSync(join(root, '.e2e-dashboard/state/triage.json'), 'utf8'), '{"new":1}');
});

test('CLI: /e2e-dashboard doctor --dry-run', async () => {
  const root = await legacyProject();
  writeFileSync(join(root, 'e2e.config.ts'), 'export default {};\n');
  const r = await main(['doctor', '--dry-run'], root);
  assert.equal(r.code, 0);
  assert.match(r.out, /xem trước[\s\S]*Sẽ chuyển 2 run/);
});

test('cleanup: preview then delete runs in a date range / older than N days, by status; pinned runs never', async () => {
  const { cleanupRuns } = await import('../server/storage.mjs');
  const root = mkdtempSync(join(tmpdir(), 'e2ed-clean-'));
  const days = ['2026-09-01', '2026-09-10', '2026-09-20', '2026-10-01'];
  for (const [i, d] of days.entries()) {
    const r = fixture();
    r.run.id = `018f0f5c-7b2a-7abc-8abc-00000000030${i}`;
    r.run.startedAt = `${d}T10:00:00.000Z`;
    if (i === 1) {
      r.run.status = 'passed';
      r.run.results = r.run.results.map((x) => ({ ...x, status: 'passed' }));
    }
    await archive(root, { source: 'hook', report: r, keep: 100 });
  }
  const metas = await listRuns(root);
  const pin = metas.find((m) => m.startedAt.startsWith('2026-09-20'));
  const metaPath = join(root, '.e2e-dashboard/runs', pin.dir, 'meta.json');
  writeFileSync(metaPath, JSON.stringify({ ...JSON.parse(readFileSync(metaPath, 'utf8')), pinned: true }));
  await assert.rejects(cleanupRuns(root, {}), /khoảng thời gian/);
  await assert.rejects(cleanupRuns(root, { from: '2026-10-01', to: '2026-09-01' }), /rỗng/);
  const p = await cleanupRuns(root, { from: '2026-09-01', to: '2026-09-20' });
  assert.deepEqual(p.runs.map((x) => x.startedAt.slice(0, 10)).sort(), ['2026-09-01', '2026-09-10']);
  assert.equal(p.pinnedSkipped, 1);
  assert.ok(p.bytes > 0);
  const passedOnly = await cleanupRuns(root, { from: '2026-09-01', to: '2026-09-30', status: 'passed' });
  assert.deepEqual(passedOnly.runs.map((x) => x.startedAt.slice(0, 10)), ['2026-09-10']);
  assert.equal((await listRuns(root)).length, 4, 'xem trước không xoá');
  const done = await cleanupRuns(root, { olderThanDays: 20 }, { preview: false, now: Date.parse('2026-10-05T00:00:00Z') });
  assert.equal(done.deleted, 2); // 09-01, 09-10 (09-20 ghim)
  assert.deepEqual((await listRuns(root)).map((m) => m.startedAt.slice(0, 10)).sort(), ['2026-09-20', '2026-10-01']);
});
