// /e2e-dashboard ở thư mục chưa có e2e.config.*: chạy `npx e2e init` trước rồi mở dashboard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { autoInit, main } from '../bin/dashboard.mjs';

test('autoInit: chạy e2e init (không hỏi, web, skill + MCP cho Claude Code, chưa cài thư viện) và báo file đã tạo', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2ed-init-'));
  let seen;
  const r = await autoInit(dir, { home: '/nonexistent-home', run: async (argv, onLine) => {
    seen = argv;
    writeFileSync(join(dir, 'e2e.config.ts'), 'export default {};\n');
    onLine('*  Created e2e.config.ts');
    onLine('|');
    return 0;
  } });
  assert.equal(r.ok, true);
  assert.deepEqual(seen.slice(-11), ['init', '--yes', '--engine', 'web', '--gateway', 'none', '--skills', '.claude/skills', '--mcp', '.mcp.json', '--no-install']);
  assert.ok(r.lines.some((l) => l.includes('*  Created e2e.config.ts')));
  assert.ok(r.lines.some((l) => /1 Click Setup/.test(l)));
});

test('autoInit: lỗi hoặc không tạo được config thì báo lỗi kèm log; không chạy ở home hay thư mục gốc', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2ed-init-'));
  const fail = await autoInit(dir, { home: '/nonexistent-home', run: async (_a, onLine) => (onLine('npm ERR! network'), 1) });
  assert.equal(fail.ok, false);
  assert.ok(fail.lines.some((l) => l.includes('npm ERR! network')));
  let ran = false;
  const run = async () => ((ran = true), 0);
  assert.equal((await autoInit(dir, { home: dir, run })).ok, false);
  assert.equal((await autoInit(parse(dir).root, { home: '/nonexistent-home', run })).ok, false);
  assert.equal(ran, false);
});

test('lệnh khác (status…) ở thư mục chưa có config vẫn báo lỗi, không tự init', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2ed-init-'));
  const r = await main(['status'], dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /npx e2e init/);
});

test('autoInit --engine mobile: e2e init với engine mobile; engine lạ thì báo lỗi, không chạy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2ed-init-m-'));
  let seen;
  await autoInit(dir, { home: '/nonexistent-home', engine: 'mobile', run: async (argv) => ((seen = argv), 1) });
  assert.deepEqual(seen.slice(seen.indexOf('--engine'), seen.indexOf('--engine') + 2), ['--engine', 'mobile']);
  const bad = await autoInit(dir, { home: '/nonexistent-home', engine: 'tv', run: async () => assert.fail('không được chạy') });
  assert.equal(bad.ok, false);
  assert.match(bad.lines[0], /engine/);
});
