// Xem / sửa file test trên trang Tests: chỉ file danh sách quét được, không symlink, không ghi đè khi file đã đổi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverTests } from '../server/discover.mjs';
import { readTestSource, writeTestSource } from '../server/testsource.mjs';

const project = () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-src-'));
  mkdirSync(join(root, 'tests'));
  writeFileSync(join(root, 'tests', 'login.e2e.ts'), "test('đăng nhập', async () => {});\n");
  writeFileSync(join(root, 'tests', 'old.spec.ts'), "import { test } from '@playwright/test';\ntest('một', async ({ page }) => {});\n");
  writeFileSync(join(root, 'tests', 'helper.ts'), 'export const x = 1;\n');
  writeFileSync(join(root, 'secret.txt'), 'bí mật\n');
  return root;
};
const status = (s) => (e) => e.status === s;

test('đọc và ghi được file .e2e.ts và .spec.ts trong danh sách', async () => {
  const root = project();
  const { files } = await discoverTests(root);
  for (const f of ['tests/login.e2e.ts', 'tests/old.spec.ts']) {
    const src = await readTestSource(root, f, files);
    assert.match(src.content, /test\(/);
    const next = `${src.content}// sửa\n`;
    const r = await writeTestSource(root, f, next, src.mtime, files);
    assert.equal(readFileSync(join(root, f), 'utf8'), next);
    assert.equal(typeof r.mtime, 'number');
  }
});

test('từ chối file ngoài danh sách, đường dẫn thoát project, symlink', async () => {
  const root = project();
  symlinkSync(join(root, 'secret.txt'), join(root, 'tests', 'link.e2e.ts'));
  const { files } = await discoverTests(root);
  files.set('tests/link.e2e.ts', {}); // giả sử danh sách có nhận symlink: vẫn phải chặn
  files.set('../x.e2e.ts', {});
  for (const f of ['tests/helper.ts', 'secret.txt', '../x.e2e.ts', 'tests/link.e2e.ts', '']) {
    await assert.rejects(readTestSource(root, f, files), status(404), f);
    await assert.rejects(writeTestSource(root, f, 'x', 0, files), status(404), f);
  }
  assert.equal(readFileSync(join(root, 'secret.txt'), 'utf8'), 'bí mật\n');
});

test('file đổi trên đĩa từ lúc mở: 409, không ghi đè; nội dung rỗng: 400', async () => {
  const root = project();
  const { files } = await discoverTests(root);
  const f = 'tests/login.e2e.ts';
  const src = await readTestSource(root, f, files);
  await assert.rejects(writeTestSource(root, f, '   ', src.mtime, files), status(400));
  utimesSync(join(root, f), new Date(), new Date(Date.now() + 5000));
  await assert.rejects(writeTestSource(root, f, 'test("khác")\n', src.mtime, files), status(409));
  assert.equal(readFileSync(join(root, f), 'utf8'), src.content);
});

test('trang Tests: nút Xem / sửa trên dòng file, ẩn ở bản export', () => {
  const src = readFileSync(new URL('../ui/views/tests.js', import.meta.url), 'utf8');
  assert.match(src, /data-edit-file=/);
  assert.match(src, /isExport\(\) \|\| c\.path\.endsWith\('#'\)/);
  assert.match(src, /openSourceDialog\(/);
});

test('HTTP: GET / POST /api/tests/source (route không bị /api/tests nuốt)', async () => {
  const http = await import('node:http');
  const { createApp } = await import('../server/app.mjs');
  const { createLive } = await import('../server/live.mjs');
  const root = project();
  const server = http.createServer(createApp({ projectRoot: root, token: 't', uiDir: new URL('../ui', import.meta.url).pathname, live: createLive({ throttleMs: 1 }) }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'x-e2e-dashboard-token': 't', 'content-type': 'application/json' };
  try {
    const get = await fetch(`${base}/api/tests/source?file=tests/old.spec.ts`, { headers });
    assert.equal(get.status, 200);
    const src = await get.json();
    const post = await fetch(`${base}/api/tests/source`, { method: 'POST', headers, body: JSON.stringify({ file: src.file, content: '// mới\n', mtime: src.mtime }) });
    assert.equal(post.status, 200);
    assert.equal(readFileSync(join(root, 'tests', 'old.spec.ts'), 'utf8'), '// mới\n');
    assert.equal((await fetch(`${base}/api/tests/source?file=secret.txt`, { headers })).status, 404);
  } finally {
    server.close();
  }
});
