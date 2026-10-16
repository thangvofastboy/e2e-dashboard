// Smoke: server thật — chia nhỏ test lớn (AI), quét file test .ts chưa chạy được bằng e2e + AI chuyển, chạy thẳng file
// Playwright (*.spec.ts) qua /api/run (project chưa cài @playwright/test: báo rõ; trộn với *.e2e.ts: từ chối).
import './_home.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';
import { createRunner } from '../server/runner.mjs';

const UI = fileURLToPath(new URL('../ui', import.meta.url));
const TOKEN = 'smoke-token';
const auth = { 'x-e2e-dashboard-token': TOKEN, 'content-type': 'application/json' };
let server, base, root;
const prompts = [];
const ai = { run: async ({ prompt, onEvent }) => {
  prompts.push(prompt);
  onEvent({ type: 'done', result: 'Bản mới:\n```ts\nimport { test } from \'@e2e-dev/web\';\ntest(\'x\', async () => {});\n```\nPATH: tests/login.e2e.ts' });
} };
const post = (p, body) => fetch(base + p, { method: 'POST', headers: auth, body: JSON.stringify(body) });

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'e2ed-smoke-pw-'));
  writeFileSync(join(root, 'e2e.config.ts'), "export default { tests: './tests/**/*.e2e.ts' };\n");
  mkdirSync(join(root, 'tests'));
  writeFileSync(join(root, 'tests', 'login.spec.ts'), "import { test, expect } from '@playwright/test';\ntest('đăng nhập', async ({ page }) => {\n  await page.goto('/');\n});\n");
  writeFileSync(join(root, 'tests', 'helper.ts'), 'export const x = 1;\n');
  const live = createLive({ throttleMs: 1 });
  const runner = createRunner({ projectRoot: root, live }); // bin thật: project tạm không có node_modules
  server = http.createServer(createApp({ projectRoot: root, token: TOKEN, uiDir: UI, live, ai, runner }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('quét file .ts có test, AI chuyển một file sang .e2e.ts rồi lưu; file gốc giữ nguyên', async () => {
  const { files } = await (await fetch(`${base}/api/tests/convertible`, { headers: auth })).json();
  assert.deepEqual(files, [{ path: 'tests/login.spec.ts', target: 'tests/login.e2e.ts', converted: false, runner: 'playwright', tests: 1 }]);
  const r = await post('/api/ai/convert-test', { path: 'tests/login.spec.ts' });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /PATH: tests\/login\.e2e\.ts/);
  assert.match(prompts.at(-1), /page\.goto\('\/'\)/); // nội dung file gốc đi kèm prompt
  assert.equal((await post('/api/tests/draft', { path: 'tests/login.e2e.ts', content: "test('x', async () => {});" })).status, 200);
  const again = await (await fetch(`${base}/api/tests/convertible`, { headers: auth })).json();
  assert.equal(again.files[0].converted, true);
  assert.equal((await post('/api/ai/convert-test', { path: 'tests/helper.ts' })).status, 400);
});

test('chạy file *.spec.ts: thiếu @playwright/test thì 503 có hướng dẫn; trộn với *.e2e.ts thì 400', async () => {
  const miss = await post('/api/run', { tests: ['tests/login.spec.ts'] });
  assert.equal(miss.status, 503);
  assert.match((await miss.json()).error, /@playwright\/test/);
  const mixed = await post('/api/run', { tests: ['tests/login.spec.ts', 'tests/login.e2e.ts'] });
  assert.equal(mixed.status, 400);
  assert.match((await mixed.json()).error, /Không chạy chung/);
});

test('trang Tests: ?unrun=1 hiện test có trong mã nhưng chưa chạy; không có cờ thì như cũ (Overview)', async () => {
  const rows = await (await fetch(`${base}/api/tests?unrun=1`, { headers: auth })).json();
  assert.ok(rows.some((r) => r.unrun && r.file === 'tests/login.spec.ts' && r.title === 'đăng nhập' && r.line === 2));
  assert.deepEqual(await (await fetch(`${base}/api/tests`, { headers: auth })).json(), []);
});

test('chia nhỏ test: chưa có run thì báo rõ; bundle UI có các nút mới', async () => {
  const r = await post('/api/ai/split-tests', {});
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /quá lớn/);
  const js = await (await fetch(`${base}/app.js`, { headers: auth })).text();
  for (const k of ['data-ai-split', 'data-split', 'data-convert', 'data-pw-all', 'data-pw-run']) assert.ok(js.includes(k), k);
});
