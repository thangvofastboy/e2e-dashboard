// Regression tests cho đợt review D (qc / triage / system / notify / alerts / cisync / export / mcp …).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { writeState } from '../server/jsonstate.mjs';
import { exportRun, buildExportHtml } from '../server/export.mjs';
import { recordAlerts, readAlerts } from '../server/alerts.mjs';
import { syncCi } from '../server/cisync.mjs';
import { readQuarantine, quarantineFlags } from '../server/quarantine.mjs';
import { readManual, saveManual, manualSummary } from '../server/qc.mjs';
import { readTemplates, saveTemplate, findTemplate } from '../server/qc-templates.mjs';
import { ensureEnvFile } from '../server/system.mjs';
import { notifyCommand } from '../server/notify.mjs';
import { handleMessage } from '../bin/mcp.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'e2ed-'));
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));

test('D-review: export không dùng meta.runId (dữ liệu repo) làm tên file — không ghi ra ngoài exports/', async () => {
  const root = tmp();
  const r = fixture();
  const { runDir } = await archive(root, { source: 'hook', report: r });
  const meta = JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf8'));
  meta.runId = '../../../pwned';
  writeFileSync(join(runDir, 'meta.json'), JSON.stringify(meta));
  const out = await buildExportHtml(root, r.run.id);
  assert.equal(out.runId, r.run.id);
  const p = await exportRun(root, r.run.id);
  assert.equal(dirname(p), join(root, '.e2e-dashboard', 'exports'));
  assert.equal(existsSync(join(root, 'pwned.html')), false);
});

test('D-review: alerts.json có active null không làm hỏng mọi lần ghi cảnh báo', async () => {
  const root = tmp();
  await writeState(root, 'alerts.json', { active: null, log: [] });
  assert.deepEqual(await readAlerts(root), { active: {}, log: [] });
  const r = await recordAlerts(root, [{ id: 'x', title: 'T', owners: [] }]);
  assert.equal(r.fresh.length, 1);
});

test('D-review: ci-sync.json hỏng (imported null, failed số) không làm sync ném lỗi', async () => {
  const root = tmp();
  const runs = JSON.stringify([{ databaseId: 7, headBranch: 'main' }]);
  const execImpl = (_c, _a, _o, cb) => cb(null, runs, '');
  await writeState(root, 'ci-sync.json', { imported: null });
  const a = await syncCi(root, { workflow: 'e2e.yml', limit: 10 }, { execImpl, importImpl: async () => [{ status: 'archived' }] });
  assert.equal(a.imported, 1);
  await writeState(root, 'ci-sync.json', { imported: {}, failed: 5 });
  const b = await syncCi(root, { workflow: 'e2e.yml', limit: 10 }, { execImpl, importImpl: async () => { throw new Error('net'); } });
  assert.equal(b.error, null);
  assert.equal(b.results[0].retry, true);
});

test('D-review: quarantine.json có mục thiếu title / until không làm quarantineFlags ném lỗi', async () => {
  const root = tmp();
  await writeState(root, 'quarantine.json', [{ key: 'a|web|default', title: null, until: 5 }, { key: 'b|web|default', title: 'ok', until: '2999-01-01T00:00:00Z' }]);
  const list = await readQuarantine(root);
  assert.deepEqual(list.map((q) => q.key), ['b|web|default']);
  assert.equal(quarantineFlags(list).active.length, 1);
});

test('D-review: qc-manual.json có phần tử null không làm saveManual / manualSummary ném lỗi', async () => {
  const root = tmp();
  await writeState(root, 'qc-manual.json', [null, 5, { id: 'a', title: 'A', status: 'pass' }]);
  assert.equal(manualSummary(await readManual(root)).pass, 1);
  const r = await saveManual(root, { title: 'B' });
  assert.equal(r.items.length, 2);
});

test('D-review: qc-templates.json có phần tử hỏng không làm findTemplate / saveTemplate ném lỗi', async () => {
  const root = tmp();
  await writeState(root, 'qc-templates.json', [null, { id: 'x', name: 'X', body: 5 }]);
  const list = await readTemplates(root);
  assert.ok(list.length > 0 && list.every((t) => typeof t.body === 'string'));
  assert.equal(findTemplate(list, 'nope'), null);
  await writeState(root, 'qc-templates.json', [null, { id: 'k', name: 'K', kind: 'custom', body: 'giữ nguyên mẫu này' }]);
  const r = await saveTemplate(root, { delete: 'zzz' });
  assert.deepEqual(r.templates.map((t) => t.id), ['k']);
});

test('D-review: setup không chép file mà .env.example (symlink) trỏ tới vào .env', async () => {
  const root = tmp();
  const secret = join(tmp(), 'credentials');
  writeFileSync(secret, 'AWS_SECRET=leak\n');
  symlinkSync(secret, join(root, '.env.example'));
  const lines = await ensureEnvFile(root);
  assert.equal(existsSync(join(root, '.env')), false);
  assert.match(lines[0], /symlink/);
  assert.ok(!readdirSync(root).includes('.env'));
});

test('D-review: notify-send — tiêu đề / nội dung bắt đầu bằng "-" không thành option', () => {
  const [, args] = notifyCommand('e2e 🚨 1 cảnh báo', '-1 giá âm [web] fail 3 run liên tiếp', 'linux');
  assert.deepEqual(args, ['--app-name=e2e-dashboard', '--', 'e2e 🚨 1 cảnh báo', '-1 giá âm [web] fail 3 run liên tiếp']);
  assert.deepEqual(notifyCommand('t', 'b', 'linux')[1], ['--app-name=e2e-dashboard', 't', 'b']);
});

test('D-review: MCP — tin nhắn JSON không phải object (null, số, mảng) trả lỗi, không ném', async () => {
  for (const msg of [null, 5, 'x', []]) {
    const out = await handleMessage(msg, null);
    assert.equal(out.error.code, -32600);
    assert.equal(out.id, null);
  }
});
