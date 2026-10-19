// Smoke: server thật in-process — Record → analyze → save → AI Gen e2e. codegen và AI giả, file ghi thật vào thư mục tạm.
import './_home.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
const COOKIE_VALUE = 'cookie-secret-value-123';
const LOGIN_STATE = JSON.stringify({ cookies: [{ name: 'sid', value: COOKIE_VALUE, domain: 'shop.test', path: '/' }], origins: [] });
const SPEC_WITH_STATE = SPEC.replace("\n\ntest('test'", "\n\ntest.use({\n  storageState: '.e2e-dashboard/auth/admin.json'\n});\n\ntest('test'");

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
    const after = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
    procs.push({ child, out: after('-o'), storage: after('--save-storage'), loadStorage: after('--load-storage') });
    return child;
  };
  const recorder = createRecorder({ projectRoot: root, spawnImpl, env, os: 'linux', browsers: () => ({ chromium: true }) });
  const prompts = [];
  const ai = { run: async ({ prompt, onEvent }) => { prompts.push(prompt); const path = /PATH: (\S+)\s*$/.exec(prompt)?.[1]; onEvent({ type: 'done', isError: false, result: prompt.includes('runner `e2e`') ? E2E_REPLY.replace(/PATH: \S+/, `PATH: ${path}`) : AI_JSON }); } };
  const server = http.createServer(createApp({ projectRoot: root, token: 't', uiDir: UI, live: createLive({ throttleMs: 1 }), ai, recorder }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => { recorder.close(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body = {}) => fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body) });
  const get = (p) => fetch(base + p, { headers });
  const finish = (i = 0, text = SPEC) => { writeFileSync(procs[i].out, text); procs[i].child.emit('close', 0, null); };
  const finishLogin = (i = 0, state = LOGIN_STATE) => { writeFileSync(procs[i].storage, state); procs[i].child.emit('close', 0, null); };
  return { root, post, get, finish, finishLogin, procs, prompts, base };
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

test('Đăng nhập trước → lưu phiên → Record có phiên → spec mang storageState; cookie không lộ qua API', async () => {
  const { root, post, get, finish, finishLogin, procs, prompts } = await boot();

  assert.deepEqual((await (await get('/api/record/auth')).json()).sessions, []);
  assert.equal((await post('/api/record/start', { url: 'https://shop.test/', name: 'x', auth: 'admin' })).status, 400, 'chưa có phiên thì không dùng được');

  assert.equal((await post('/api/record/login', { url: 'https://shop.test/login', name: 'Admin' })).status, 200);
  const running = await (await get('/api/record/status')).json();
  assert.equal(running.state, 'recording');
  assert.equal(running.kind, 'login');
  finishLogin(0);
  const done = await (await get('/api/record/status')).json();
  assert.equal(done.state, 'done');
  assert.equal(done.kind, 'login');
  assert.equal((await post('/api/record/analyze')).status, 400, 'phiên đăng nhập không có gì để phân tích');
  assert.equal((await post('/api/record/discard')).status, 200);

  const list = await (await get('/api/record/auth')).text();
  assert.ok(!list.includes(COOKIE_VALUE), 'danh sách phiên không chứa cookie');
  assert.deepEqual(JSON.parse(list).sessions.map((s) => s.name), ['admin']);
  assert.equal(statSync(join(root, '.e2e-dashboard/auth/admin.json')).mode & 0o777, 0o600);

  assert.equal((await post('/api/record/start', { url: 'https://shop.test/', name: 'Giỏ hàng', auth: 'admin' })).status, 200);
  assert.equal(procs[1].loadStorage, '.e2e-dashboard/auth/admin.json');
  assert.ok(!JSON.stringify(await (await get('/api/record/status')).json()).includes(COOKIE_VALUE));
  finish(1, SPEC_WITH_STATE);
  const analyzed = await (await post('/api/record/analyze')).json();
  assert.equal(analyzed.testcases.length, 1);
  assert.equal((await post('/api/record/save', { testcases: analyzed.testcases })).status, 200);
  const spec = readFileSync(join(root, 'tests/recorded/gio-hang.spec.ts'), 'utf8');
  assert.match(spec, /storageState: '\.e2e-dashboard\/auth\/admin\.json'/);
  assert.equal(JSON.parse(readFileSync(join(root, 'tests/recorded/gio-hang.cases.json'), 'utf8')).auth, 'admin');
  assert.equal((await post('/api/record/gen-e2e', { slug: 'gio-hang' })).status, 200);
  assert.match(prompts.at(-1), /đăng nhập sẵn/, 'AI Gen e2e được dặn về phiên đăng nhập');
  assert.ok(existsSync(join(root, 'tests/recorded/gio-hang.e2e.ts')));

  assert.equal((await post('/api/record/auth/delete', { name: 'admin' })).status, 200);
  assert.deepEqual((await (await get('/api/record/auth')).json()).sessions, []);
  assert.equal((await post('/api/record/auth/delete', { name: 'admin' })).status, 404);
  assert.equal((await post('/api/record/start', { url: 'https://shop.test/', name: 'y', auth: 'admin' })).status, 400);
});

test('Dán chuỗi Cookie → phiên → Record dùng phiên; cookie không lộ qua API, máy không màn hình vẫn dựng được', async () => {
  const { root, post, get, procs } = await boot({ env: {} }); // không có DISPLAY: Record bị khoá nhưng dựng phiên từ cookie thì không
  const cookie = `Cookie: sid=${COOKIE_VALUE}; theme=dark`;
  assert.equal((await post('/api/record/prepare', { name: 'Admin', url: 'https://shop.test/login', cookie: 'khong-co-dau-bang' })).status, 400);
  const r = await post('/api/record/prepare', { name: 'Admin', url: 'https://shop.test/login', cookie });
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.ok(!text.includes(COOKIE_VALUE), 'response không chứa cookie');
  assert.deepEqual(JSON.parse(text).sessions.map((s) => s.name), ['admin']);
  const file = join(root, '.e2e-dashboard/auth/admin.json');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const state = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(state.cookies.map((c) => [c.name, c.domain, c.secure]), [['sid', 'shop.test', true], ['theme', 'shop.test', true]]);
  assert.ok(!(await (await get('/api/record/auth')).text()).includes(COOKIE_VALUE));
  assert.equal(procs.length, 0, 'không mở trình duyệt');
  assert.equal((await post('/api/record/prepare', { name: 'x', url: 'https://shop.test/', cookie: 'a=1', link: 'javascript:alert(1)' })).status, 400);
});

test('Nhờ AI chuẩn bị phiên: project chưa bật AI thì 400 rõ ràng, đầu vào sai 400, prompt và bí mật không lộ ra phản hồi', async () => {
  const { post, procs } = await boot();
  const ok = { name: 'Admin', url: 'https://shop.test/login', prompt: 'Đăng nhập bằng {{E2E_ADMIN_PASSWORD}}' };
  const r = await post('/api/record/prepare-ai', ok);
  assert.equal(r.status, 400);
  const text = await r.text();
  assert.match(JSON.parse(text).error, /AI/);
  assert.ok(!text.includes('E2E_ADMIN_PASSWORD'), 'phản hồi không lặp lại prompt');
  for (const bad of [{ ...ok, name: '!!!' }, { ...ok, url: 'javascript:x' }, { ...ok, prompt: '' }, { ...ok, prompt: 7 }]) {
    assert.equal((await post('/api/record/prepare-ai', bad)).status, 400);
  }
  assert.equal(procs.length, 0, 'không mở codegen');
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
