import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverTests, withUnrun } from '../server/discover.mjs';
import { selectionToRun } from '../ui/model.js';

const project = () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-disc-'));
  mkdirSync(join(root, 'tests', 'a'), { recursive: true });
  mkdirSync(join(root, 'other'));
  writeFileSync(join(root, 'tests', 'a', 'login.e2e.ts'), "import { test } from 'e2e';\n\ntest('đăng nhập', async () => {});\ntest.skip(\"quên 'mật khẩu'\", async () => {});\n");
  writeFileSync(join(root, 'tests', 'old.spec.ts'), "import { test } from '@playwright/test';\ntest.describe('nhóm', () => {\n  test('một', async ({ page }) => {});\n});\n");
  writeFileSync(join(root, 'tests', 'sum.test.ts'), "import { test } from 'vitest';\ntest('cộng', () => {});\n");
  writeFileSync(join(root, 'tests', 'helper.ts'), "export const test = (n) => n;\ntest('không phải test');\n");
  writeFileSync(join(root, 'other', 'x.e2e.ts'), "test('ngoài thư mục test', async () => {});\n");
  return root;
};

test('discoverTests: tiêu đề + dòng của *.e2e.ts và file Playwright; bỏ vitest, helper; giới hạn trong thư mục test', async () => {
  const root = project();
  const all = await discoverTests(root, 'tests');
  assert.deepEqual(all, [
    { file: 'tests/a/login.e2e.ts', title: 'đăng nhập', line: 3, runner: 'e2e' },
    { file: 'tests/a/login.e2e.ts', title: "quên 'mật khẩu'", line: 4, runner: 'e2e' },
    { file: 'tests/old.spec.ts', title: 'một', line: 3, runner: 'playwright' },
  ]);
  assert.equal((await discoverTests(root)).length, 4); // không đặt thư mục test: cả project
  assert.deepEqual(await discoverTests(root, '../'), []); // ngoài project
});

test('withUnrun: chỉ thêm file chưa có trong lịch sử; chọn chạy không mang target / agent rỗng', async () => {
  const root = project();
  const hist = [{ key: 'k', title: 'đăng nhập', file: 'tests/a/login.e2e.ts', line: 3, tags: [], target: 'web', agent: 'default', history: [{ status: 'passed' }] }];
  const rows = withUnrun(hist, await discoverTests(root, 'tests'));
  assert.equal(rows.length, 2);
  const u = rows[1];
  assert.deepEqual([u.file, u.unrun, u.runner, u.history], ['tests/old.spec.ts', true, 'playwright', []]);
  assert.deepEqual(selectionToRun(rows.map((r) => ({ ...r, id: r.key })), new Set([u.key])), { tests: ['tests/old.spec.ts:3'], targets: [], agents: [] });
  assert.equal(withUnrun(hist, []), hist);
});
