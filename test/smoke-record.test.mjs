// Smoke: server thật in-process — Record → analyze → save → AI Gen e2e. codegen và AI giả, file ghi thật vào thư mục tạm.
import './_home.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';
import { createRecorder } from '../server/recorder-session.mjs';

const UI = fileURLToPath(new URL('../ui', import.meta.url));
const SECRET = 'S3cr3t!';
const SPEC = `import { test, expect } from '@playwright/test';\n\ntest('test', async ({ page }) => {\n  await page.goto('https://shop.test/login');\n  await page.getByLabel('Email').fill('a@shop.test');\n  await page.getByLabel('Password').fill('${SECRET}');\n  await page.getByRole('button', { name: 'Đăng nhập' }).click();\n  await expect(page.getByText('Xin chào')).toBeVisible();\n});\n`;
const AI_JSON = '```json\n{"testcases":[{"title":"Đăng nhập thành công","steps":["Mở trang đăng nhập","Nhập email và mật khẩu","Bấm Đăng nhập"],"expected":"Thấy lời chào"}]}\n```';
const E2E_REPLY = '```ts\nimport { test } from "@e2e-dev/web";\ntest("đăng nhập", async () => {});\n```\nPATH: tests/recorded/dang-nhap.e2e.ts';
const headers = { 'x-e2e-dashboard-token': 't', 'content-type': 'application/json' };

const closers = [];
async function boot({ env = { DISPLAY: ':0' } } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-smoke-rec-'));
  writeFileSync(join(root, 'e2e.config.ts'), 'export default {};\n');
  mkdirSync(join(root, 'node_modules', 'playwright-core'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'playwright-core', 'cli.js'), '');
  const procs = [];
  const spawnImpl = (_cmd, args) => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    procs.push({ child, out: args[args.indexOf('-o') + 1] });
    return child;
  };
  const recorder = createRecorder({ projectRoot: root, spawnImpl, env, os: 'linux', browsers: () => ({ chromium: true }) });
  const prompts = [];
  const ai = { run: async ({ prompt, onEvent }) => { prompts.push(prompt); onEvent({ type: 'done', isError: false, result: prompt.includes('runner `e2e`') ? E2E_REPLY : AI_JSON }); } };
  const server = http.createServer(createApp({ projectRoot: root, token: 't', uiDir: UI, live: createLive({ throttleMs: 1 }), ai, recorder }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => { recorder.close(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body = {}) => fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body) });
  const get = (p) => fetch(base + p, { headers });
  const finish = (i = 0) => { writeFileSync(procs[i].out, SPEC); procs[i].child.emit('close', 0, null); };
  return { root, post, get, finish, prompts, base };
}
after(() => closers.forEach((c) => c()));

test('Record → analyze → save → AI Gen e2e: file xuất hiện, bí mật không lọt ra đâu', async () => {
  const { root, post, get, finish, prompts } = await boot();

  const idle = await (await get('/api/record/status')).json();
  assert.equal(idle.state, 'idle');
  assert.equal(idle.canRecord, true);

  assert.equal((await post('/api/record/start', { url: 'javascript:alert(1)', name: 'x' })).status, 400);
  const started = await post('/api/record/start', { url: 'https://shop.test/login', name: 'Đăng nhập' });
  assert.equal(started.status, 200);
  assert.equal((await post('/api/record/start', { url: 'https://shop.test/', name: 'khác' })).status, 409);
  assert.equal((await (await get('/api/record/status')).json()).state, 'recording');
  assert.equal((await post('/api/record/analyze')).status, 400, 'chưa xong thì chưa phân tích được');

  finish(); // người dùng đóng cửa sổ browser
  const done = await (await get('/api/record/status')).json();
  assert.equal(done.state, 'done');

  const analyzed = await (await post('/api/record/analyze')).json();
  assert.equal(analyzed.slug, 'dang-nhap');
  assert.deepEqual(analyzed.secrets, ['E2E_SECRET_1']);
  assert.equal(analyzed.testcases[0].expected, 'Thấy lời chào');
  assert.ok(!analyzed.aiError);
  assert.ok(prompts.length === 1 && !prompts[0].includes(SECRET), 'prompt gửi AI không có mật khẩu');
  assert.match(prompts[0], /bằng chứng chắc chắn/, 'assert từ inspector được đưa cho AI');

  const saved = await post('/api/record/save', { testcases: analyzed.testcases });
  assert.equal(saved.status, 200);
  const sv = await saved.json();
  assert.equal(sv.specPath, 'tests/recorded/dang-nhap.spec.ts');
  const spec = readFileSync(join(root, sv.specPath), 'utf8');
  assert.ok(!spec.includes(SECRET));
  assert.match(spec, /fill\(process\.env\.E2E_SECRET_1\)/);
  assert.match(spec, /@playwright\/test/);
  assert.equal((await (await get('/api/record/status')).json()).state, 'idle', 'lưu xong phiên được dọn');

  assert.equal((await post('/api/record/save', { testcases: analyzed.testcases })).status, 400, 'phiên đã dọn nên lưu lại là 400');

  const gen = await post('/api/record/gen-e2e', { slug: 'dang-nhap' });
  assert.equal(gen.status, 200);
  assert.deepEqual(await gen.json(), { saved: 'tests/recorded/dang-nhap.e2e.ts' });
  assert.ok(existsSync(join(root, 'tests/recorded/dang-nhap.e2e.ts')));
  assert.equal((await post('/api/record/gen-e2e', { slug: 'dang-nhap' })).status, 409);
  const cases = JSON.parse(readFileSync(join(root, 'tests/recorded/dang-nhap.cases.json'), 'utf8'));
  assert.equal(cases.e2ePath, 'tests/recorded/dang-nhap.e2e.ts');
  assert.ok(!JSON.stringify(cases).includes(SECRET));
  assert.ok(!prompts.at(-1).includes(SECRET));

  // file mới nằm trong danh sách test của dashboard (chạy bằng runner Playwright có sẵn)
  const tests = JSON.stringify(await (await get('/api/tests?unrun=1')).json());
  assert.ok(tests.includes('tests/recorded/dang-nhap.spec.ts'), 'danh sách test thấy file .spec.ts mới');

  // bundle UI mang trang Record
  const js = await (await get('/app.js')).text();
  assert.match(js, /function renderRecord/);
  assert.match(js, /\/api\/record\/start/);
});

test('trùng tên: 409 giữ phiên, đổi tên thì lưu được', async () => {
  const { root, post, get, finish } = await boot();
  await post('/api/record/start', { url: 'https://shop.test/', name: 'Giỏ hàng' });
  finish(0);
  const first = await (await post('/api/record/analyze')).json();
  assert.equal((await post('/api/record/save', { testcases: first.testcases })).status, 200);

  await post('/api/record/start', { url: 'https://shop.test/', name: 'Giỏ hàng' });
  finish(1);
  const second = await (await post('/api/record/analyze')).json();
  const clash = await post('/api/record/save', { testcases: second.testcases });
  assert.equal(clash.status, 409);
  assert.equal((await (await get('/api/record/status')).json()).state, 'done', 'phiên còn nguyên để đổi tên');
  const renamed = await post('/api/record/save', { testcases: second.testcases, name: 'Giỏ hàng 2' });
  assert.equal(renamed.status, 200);
  assert.ok(existsSync(join(root, 'tests/recorded/gio-hang.spec.ts')));
  assert.ok(existsSync(join(root, 'tests/recorded/gio-hang-2.spec.ts')));
});

test('máy không có màn hình: start 400 kèm lý do, status báo canRecord=false', async () => {
  const { post, get } = await boot({ env: {} });
  const r = await post('/api/record/start', { url: 'https://shop.test/', name: 'a' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /màn hình/);
  const st = await (await get('/api/record/status')).json();
  assert.equal(st.canRecord, false);
  assert.match(st.reason, /màn hình/);
});

test('không có token thì 401', async () => {
  const { base } = await boot();
  assert.equal((await fetch(`${base}/api/record/status`)).status, 401);
});
