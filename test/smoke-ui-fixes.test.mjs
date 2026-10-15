// Smoke: server thật — xuất trang tĩnh rồi tải zip, và bundle UI mang các sửa giao diện (cuộn, ô nhập, form Linear).
import './_home.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';
import { publishSite } from '../server/site.mjs';

const UI = fileURLToPath(new URL('../ui', import.meta.url));
const auth = { 'x-e2e-dashboard-token': 't', 'content-type': 'application/json' };
let server, base, root;
before(async () => {
  root = mkdtempSync(join(tmpdir(), 'e2ed-smoke-ui-'));
  writeFileSync(join(root, 'e2e.config.ts'), 'export default {};\n');
  server = http.createServer(createApp({ projectRoot: root, token: 't', uiDir: UI, live: createLive({ throttleMs: 1 }), tracking: { publish: () => publishSite(root) } }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
const post = (p, body) => fetch(base + p, { method: 'POST', headers: auth, body: JSON.stringify(body) });
const get = (p) => fetch(base + p, { headers: auth });

test('xuất trang tĩnh → tải zip; chưa xuất thì 404', async () => {
  assert.equal((await get('/api/publish/site.zip')).status, 404);
  assert.equal((await post('/api/publish', {})).status, 200);
  const r = await get('/api/publish/site.zip');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/zip');
  assert.match(r.headers.get('content-disposition'), /attachment; filename="e2e-report.zip"/);
  const zip = Buffer.from(await r.arrayBuffer());
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.ok(zip.includes('e2e-report/index.html'));
  assert.match(await (await get('/app.js')).text(), /\/api\/publish\/site\.zip/); // nút Xuất trang tĩnh tải zip về
});

test('CSS: main chứa phần tử absolute, ô nhập có giới hạn, form Linear xếp dọc', async () => {
  const css = await (await get('/style.css')).text();
  assert.match(css, /#main \{ position: relative; height: 100vh; overflow: auto/);
  assert.match(css, /\.form-row input:where\([^)]*\[type="date"\][^{]*\{[^}]*max-width: 560px/);
  assert.match(css, /\.tpick-pop \.tpick-q \{ flex: none/);
  assert.match(css, /form\[data-linear-issues\] \{ display: grid/);
  assert.match(css, /\.tpl-form \{ display: grid; gap: 14px; \}/);
  assert.doesNotMatch(css, /\.digest \{ max-width/);
});

test('sửa project: đổi tên + thư mục; project đang mở chỉ đổi tên', async () => {
  const other = mkdtempSync(join(tmpdir(), 'e2ed-smoke-proj-'));
  const moved = mkdtempSync(join(tmpdir(), 'e2ed-smoke-proj-'));
  assert.equal((await post('/api/projects/add', { root: other })).status, 200);
  const r = await post('/api/projects/update', { root: other, name: 'Web shop', newRoot: moved });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { root: moved, name: 'Web shop' });
  const list = (await (await get('/api/projects')).json()).projects;
  assert.ok(list.some((p) => p.root === moved && p.name === 'Web shop'));
  assert.equal((await post('/api/projects/update', { root, newRoot: other })).status, 400);
  assert.equal((await post('/api/projects/update', { root: moved, name: 5 })).status, 400);
  const js = await (await get('/app.js')).text();
  assert.match(js, /\/api\/projects\/update/);
  assert.match(js, /name="navShow"/); // ẩn mục menu ở Cài đặt hệ thống → Giao diện
});
