import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverTests, reconcile } from '../server/discover.mjs';
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
  const { tests, files } = await discoverTests(root, 'tests');
  assert.deepEqual(tests, [
    { file: 'tests/a/login.e2e.ts', title: 'đăng nhập', line: 3, runner: 'e2e' },
    { file: 'tests/a/login.e2e.ts', title: "quên 'mật khẩu'", line: 4, runner: 'e2e' },
    { file: 'tests/old.spec.ts', title: 'một', line: 3, runner: 'playwright' },
  ]);
  assert.deepEqual([...files.keys()], ['tests/a/login.e2e.ts', 'tests/old.spec.ts']);
  assert.equal((await discoverTests(root)).tests.length, 4); // không đặt thư mục test: cả project
  assert.deepEqual((await discoverTests(root, '../')).tests, []); // ngoài project
});

const hist = (file, title, line, extra = {}) => ({ key: `${file}::${title}|web|default`, title, file, line, tags: [], target: 'web', agent: 'default', history: [{ status: 'passed' }], ...extra });

test('reconcile: sửa file test là thấy ngay — dòng mới, test xoá / file xoá ẩn đi, test mới hiện "chưa chạy"', async () => {
  const root = project();
  const rows = [
    hist('tests/a/login.e2e.ts', 'Nhóm › đăng nhập', 3),
    hist('tests/a/login.e2e.ts', 'tên cũ đã đổi', 9),
    hist('tests/da-xoa.e2e.ts', 'file đã xoá', 1),
    hist('ngoai/x.e2e.ts', 'ngoài thư mục test', 1), // không quét, file còn: giữ
  ];
  mkdirSync(join(root, 'ngoai'));
  writeFileSync(join(root, 'ngoai', 'x.e2e.ts'), "test('ngoài thư mục test', async () => {});\n");
  // sửa file: chèn 2 dòng, đổi tên một test
  writeFileSync(join(root, 'tests', 'a', 'login.e2e.ts'), "import { test } from 'e2e';\n// mới\n// mới\n\ntest('đăng nhập', async () => {});\ntest('tên mới', async () => {});\n");
  const out = reconcile(rows, await discoverTests(root, 'tests'), root);
  assert.deepEqual(out.map((r) => [r.file, r.title, r.line, Boolean(r.unrun)]), [
    ['tests/a/login.e2e.ts', 'Nhóm › đăng nhập', 5, false],
    ['ngoai/x.e2e.ts', 'ngoài thư mục test', 1, false],
    ['tests/a/login.e2e.ts', 'tên mới', 6, true],
    ['tests/old.spec.ts', 'một', 3, true],
  ]);
  assert.equal(reconcile(rows, await discoverTests(root, 'tests'), root, { addUnrun: false }).some((r) => r.unrun), false);
  const u = out.find((r) => r.title === 'tên mới');
  assert.deepEqual(selectionToRun(out.map((r) => ({ ...r, id: r.key })), new Set([u.key])), { tests: ['tests/a/login.e2e.ts:6'], targets: [], agents: [] });
});

test('reconcile: file có tiêu đề động (`${…}`) không ẩn test lịch sử, không thêm dòng template trùng', async () => {
  const root = project();
  writeFileSync(join(root, 'tests', 'dyn.e2e.ts'), "for (const s of list) {\n  test(`${s}: mở được`, async () => {});\n}\n");
  const rows = [hist('tests/dyn.e2e.ts', 'Clients: mở được', 2)];
  const out = reconcile(rows, await discoverTests(root, 'tests'), root).filter((r) => r.file === 'tests/dyn.e2e.ts');
  assert.deepEqual(out.map((r) => r.title), ['Clients: mở được']);
});
