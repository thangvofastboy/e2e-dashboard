// Đăng nhập trước, lưu phiên: parseSpec bỏ khối test.use, phiên codegen login / load-storage, route auth, UI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSpec } from '../server/recorder-spec.mjs';
import { redactSpec } from '../server/recorder-redact.mjs';
import { createRecorder } from '../server/recorder-session.mjs';
import { createRecorderApi } from '../server/recorder-api.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'e2ed-auth-'));
const SPEC_AUTH = "import { test, expect } from '@playwright/test';\n\ntest.use({\n  storageState: '.e2e-dashboard/auth/admin.json'\n});\n\ntest('test', async ({ page }) => {\n  await page.goto('https://a.test/');\n});\n";
const GOOD_STATE = JSON.stringify({ cookies: [{ name: 'sid', value: 'abc', domain: 'a.test', path: '/' }], origins: [] });
const EMPTY_STATE = JSON.stringify({ cookies: [], origins: [] });
const rejectsWith = (p, status, re) => assert.rejects(p, (e) => e.status === status && (!re || re.test(e.message)));

test('T1: parseSpec bỏ qua khối test.use nhiều dòng do --load-storage chèn', () => {
  const { steps, url } = parseSpec(SPEC_AUTH);
  assert.deepEqual(steps.map((s) => s.kind), ['goto']);
  assert.equal(url, 'https://a.test/');
  assert.equal(redactSpec(SPEC_AUTH).spec, SPEC_AUTH);
});

function setup(over = {}) {
  const projectRoot = tmp();
  mkdirSync(join(projectRoot, 'node_modules', 'playwright-core'), { recursive: true });
  writeFileSync(join(projectRoot, 'node_modules', 'playwright-core', 'cli.js'), '');
  const calls = [];
  const spawnImpl = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (sig) => { child.killedWith = sig; return true; };
    calls.push({ cmd, args, opts, child, out: args.includes('-o') ? args[args.indexOf('-o') + 1] : null, storage: args.includes('--save-storage') ? args[args.indexOf('--save-storage') + 1] : null });
    return child;
  };
  const rec = createRecorder({ projectRoot, spawnImpl, env: { DISPLAY: ':0' }, os: 'linux', tmpRoot: tmp(), browsers: () => ({ chromium: true }), ...over });
  const authFile = (name) => join(projectRoot, '.e2e-dashboard', 'auth', `${name}.json`);
  const seed = (name, text = GOOD_STATE) => { mkdirSync(join(projectRoot, '.e2e-dashboard', 'auth'), { recursive: true }); writeFileSync(authFile(name), text); };
  return { rec, calls, projectRoot, authFile, seed };
}

test('T2: spawn luôn chạy với cwd là gốc project', async () => {
  const { rec, calls, projectRoot } = setup();
  await rec.start({ url: 'https://a.test', name: 'a' });
  assert.equal(calls[0].opts.cwd, projectRoot);
});

test('T2: start không có auth thì không có --load-storage', async () => {
  const { rec, calls } = setup();
  await rec.start({ url: 'https://a.test', name: 'a' });
  assert.ok(!calls[0].args.includes('--load-storage'));
  assert.equal(rec.status().kind, 'record');
  assert.equal(rec.status().auth ?? null, null);
});

test('T2: start với auth dùng --load-storage đường dẫn tương đối; chưa có phiên hoặc tên sai thì 400', async () => {
  const { rec, calls, seed } = setup();
  await rejectsWith(rec.start({ url: 'https://a.test', name: 'a', auth: 'admin' }), 400, /chưa có phiên/i);
  await rejectsWith(rec.start({ url: 'https://a.test', name: 'a', auth: '../x' }), 400);
  assert.equal(calls.length, 0);
  seed('admin');
  await rec.start({ url: 'https://a.test', name: 'a', auth: 'admin' });
  const i = calls[0].args.indexOf('--load-storage');
  assert.equal(calls[0].args[i + 1], '.e2e-dashboard/auth/admin.json');
  assert.equal(rec.status().auth, 'admin');
});

test('T2: login chạy --save-storage vào file tạm, không có -o, url đứng cuối', async () => {
  const { rec, calls, projectRoot } = setup();
  await rec.login({ url: 'https://a.test', name: 'Admin' });
  const c = calls[0];
  assert.ok(c.storage && !c.storage.startsWith(projectRoot), 'file tạm nằm ngoài project');
  assert.ok(!c.args.includes('-o'));
  assert.equal(c.args.at(-1), 'https://a.test/');
  assert.equal(c.opts.cwd, projectRoot);
  const st = rec.status();
  assert.equal(st.state, 'recording');
  assert.equal(st.kind, 'login');
  assert.equal(st.auth, 'admin');
});

test('T2: login xong (Xong, lưu phiên = SIGINT) chuyển file vào auth/ với quyền 0600, thư mục 0700', async () => {
  const { rec, calls, authFile, projectRoot } = setup();
  await rec.login({ url: 'https://a.test', name: 'Admin' });
  const p = rec.stop();
  assert.equal(calls[0].child.killedWith, 'SIGINT');
  writeFileSync(calls[0].storage, GOOD_STATE);
  calls[0].child.emit('close', 130, 'SIGINT');
  const st = await p;
  assert.equal(st.state, 'done');
  assert.equal(st.kind, 'login');
  assert.equal(readFileSync(authFile('admin'), 'utf8'), GOOD_STATE);
  assert.equal(statSync(authFile('admin')).mode & 0o777, 0o600);
  assert.equal(statSync(join(projectRoot, '.e2e-dashboard', 'auth')).mode & 0o777, 0o700);
  assert.equal(rec.result(), null, 'phiên login không có spec để phân tích');
  const list = rec.listAuth();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'admin');
  assert.match(list[0].savedAt, /^\d{4}-\d\d-\d\dT/);
  assert.ok(!existsSync(calls[0].storage), 'file tạm được dọn');
});

test('T2: login không thấy cookie nào → failed, phiên cũ còn nguyên', async () => {
  const { rec, calls, seed, authFile } = setup();
  seed('admin', GOOD_STATE);
  await rec.login({ url: 'https://a.test', name: 'admin' });
  writeFileSync(calls[0].storage, EMPTY_STATE);
  calls[0].child.emit('close', 0, null);
  const st = rec.status();
  assert.equal(st.state, 'failed');
  assert.match(st.error, /đăng nhập chưa/);
  assert.equal(readFileSync(authFile('admin'), 'utf8'), GOOD_STATE);
});

test('T2: login không ghi file hoặc thoát lỗi → failed, phiên cũ còn nguyên', async () => {
  const { rec, calls, seed, authFile } = setup();
  seed('admin', GOOD_STATE);
  await rec.login({ url: 'https://a.test', name: 'admin' });
  calls[0].child.stderr.emit('data', Buffer.from('boom'));
  calls[0].child.emit('close', 1, null);
  assert.equal(rec.status().state, 'failed');
  assert.match(rec.status().error, /boom/);
  assert.equal(readFileSync(authFile('admin'), 'utf8'), GOOD_STATE);
});

test('T2: login tên vô nghĩa → 400; đang ghi thì login lần hai → 409', async () => {
  const { rec } = setup();
  await rejectsWith(rec.login({ url: 'https://a.test', name: '!!!' }), 400);
  await rec.login({ url: 'https://a.test', name: 'a' });
  await rejectsWith(rec.login({ url: 'https://a.test', name: 'b' }), 409);
});

test('T2: removeAuth xoá phiên; tên sai 400, không có 404; listAuth rỗng khi chưa có thư mục', () => {
  const { rec, seed, authFile } = setup();
  assert.deepEqual(rec.listAuth(), []);
  seed('admin');
  rec.removeAuth('admin');
  assert.ok(!existsSync(authFile('admin')));
  assert.throws(() => rec.removeAuth('admin'), (e) => e.status === 404);
  assert.throws(() => rec.removeAuth('../x'), (e) => e.status === 400);
});

// ---- API ----
const body = (b = {}) => async () => b;
function fakeRecorder(over = {}) {
  const calls = { start: [], login: [], removeAuth: [] };
  const rec = {
    calls,
    status: () => ({ state: 'idle', canRecord: true, reason: null }),
    start: async (a) => { calls.start.push(a); return { id: 'r1' }; },
    login: async (a) => { calls.login.push(a); return { id: 'l1' }; },
    stop: async () => ({ state: 'done' }),
    result: () => ({ id: 'r1', name: 'Đăng nhập', url: 'https://a.test/', specText: SPEC_AUTH, auth: 'admin' }),
    clear: () => {},
    listAuth: () => [{ name: 'admin', savedAt: '2026-10-19T07:00:00.000Z' }],
    removeAuth: (n) => { calls.removeAuth.push(n); },
    ...over,
  };
  return rec;
}
const AI_JSON = '```json\n{"testcases":[{"title":"t","steps":["a"],"expected":"e"}]}\n```';
const E2E_REPLY = '```ts\nimport x;\n```\nPATH: tests/recorded/dang-nhap.e2e.ts';
function makeApi(over = {}) {
  const root = tmp();
  const prompts = [];
  const recorder = fakeRecorder(over);
  const api = createRecorderApi({ projectRoot: root, recorder, runAi: async (p) => { prompts.push(p); return p.includes('runner `e2e`') ? E2E_REPLY : AI_JSON; } });
  const call = (method, path, b = {}) => api({}, `/api/record/${path}`, method, body(b));
  return { call, root, recorder, prompts };
}

test('T3: POST login chuyển url chuẩn hoá và tên; url hoặc tên sai → 400 và không gọi recorder', async () => {
  const { call, recorder } = makeApi();
  assert.equal((await call('POST', 'login', { url: 'javascript:x', name: 'admin' })).status, 400);
  assert.equal((await call('POST', 'login', { url: 'https://a.test', name: '!!!' })).status, 400);
  assert.equal(recorder.calls.login.length, 0);
  const r = await call('POST', 'login', { url: 'localhost:3000', name: ' Admin ' });
  assert.deepEqual(r, { status: 200, body: { id: 'l1' } });
  assert.deepEqual(recorder.calls.login, [{ url: 'http://localhost:3000/', name: 'Admin' }]);
});

test('T3: GET auth trả danh sách tên + thời điểm; không có đường dẫn hay nội dung phiên', async () => {
  const { call } = makeApi();
  const r = await call('GET', 'auth');
  assert.deepEqual(r, { status: 200, body: { sessions: [{ name: 'admin', savedAt: '2026-10-19T07:00:00.000Z' }] } });
});

test('T3: POST auth/delete xoá phiên rồi trả danh sách mới; tên không phải chuỗi → 400', async () => {
  const { call, recorder } = makeApi();
  const r = await call('POST', 'auth/delete', { name: 'admin' });
  assert.equal(r.status, 200);
  assert.deepEqual(recorder.calls.removeAuth, ['admin']);
  assert.ok(Array.isArray(r.body.sessions));
  assert.equal((await call('POST', 'auth/delete', { name: 42 })).status, 400);
});

test('T3: lỗi có status từ removeAuth đi ra đúng mã', async () => {
  const { call } = makeApi({ removeAuth: () => { throw Object.assign(new Error('Không có phiên x'), { status: 404 }); } });
  assert.equal((await call('POST', 'auth/delete', { name: 'x' })).status, 404);
});

test('T3: start nhận auth và chuyển cho recorder; auth không phải chuỗi → 400', async () => {
  const { call, recorder } = makeApi();
  await call('POST', 'start', { url: 'https://a.test', name: 'a', auth: 'admin' });
  assert.deepEqual(recorder.calls.start, [{ url: 'https://a.test/', name: 'a', auth: 'admin' }]);
  await call('POST', 'start', { url: 'https://a.test', name: 'b' });
  assert.equal(recorder.calls.start[1].auth, undefined);
  assert.equal((await call('POST', 'start', { url: 'https://a.test', name: 'c', auth: 42 })).status, 400);
});

test('T3: save ghi auth vào cases.json (null khi không dùng phiên); spec giữ khối storageState', async () => {
  const withAuth = makeApi();
  const tcs = [{ title: 't', steps: ['a'], expected: '' }];
  assert.equal((await withAuth.call('POST', 'save', { testcases: tcs })).status, 200);
  const cases = JSON.parse(readFileSync(join(withAuth.root, 'tests/recorded/dang-nhap.cases.json'), 'utf8'));
  assert.equal(cases.auth, 'admin');
  assert.match(readFileSync(join(withAuth.root, 'tests/recorded/dang-nhap.spec.ts'), 'utf8'), /storageState: '\.e2e-dashboard\/auth\/admin\.json'/);
  const noAuth = makeApi({ result: () => ({ id: 'r2', name: 'Đăng nhập', url: 'https://a.test/', specText: SPEC_AUTH.replace(/test\.use[\s\S]*?\}\);\n\n/, '') }) });
  await noAuth.call('POST', 'save', { testcases: tcs });
  assert.equal(JSON.parse(readFileSync(join(noAuth.root, 'tests/recorded/dang-nhap.cases.json'), 'utf8')).auth, null);
});

test('T3: gen-e2e dặn AI về phiên đăng nhập khi cases có auth, không dặn khi không có', async () => {
  const a = makeApi();
  await a.call('POST', 'save', { testcases: [{ title: 't', steps: ['a'], expected: '' }] });
  await a.call('POST', 'gen-e2e', { slug: 'dang-nhap' });
  assert.match(a.prompts.at(-1), /đăng nhập sẵn/);
  assert.match(a.prompts.at(-1), /admin/);
  const b = makeApi({ result: () => ({ id: 'r2', name: 'Đăng nhập', url: 'https://a.test/', specText: "import { test } from '@playwright/test';\n\ntest('t', async ({ page }) => {\n  await page.goto('https://a.test/');\n});\n" }) });
  await b.call('POST', 'save', { testcases: [{ title: 't', steps: ['a'], expected: '' }] });
  await b.call('POST', 'gen-e2e', { slug: 'dang-nhap' });
  assert.doesNotMatch(b.prompts.at(-1), /đăng nhập sẵn/);
});

// ---- UI ----
const ui = await import('../ui/views/record.js');
const idle = { state: 'idle', canRecord: true, reason: null };

test('T4: form có chọn phiên (kèm tuỳ chọn không dùng), nút Xoá phiên và hàng Đăng nhập trước', () => {
  const html = ui.recordViewHtml({ status: idle, editing: null, saved: null, auth: [{ name: 'admin', savedAt: '2026-10-19T07:00:00.000Z' }] });
  assert.match(html, /<select[^>]*data-rec-auth/);
  assert.match(html, /<option value="">/);
  assert.match(html, /<option value="admin">/);
  assert.match(html, /data-rec-auth-del/);
  assert.match(html, /data-rec-login-name/);
  assert.match(html, /data-rec-login/);
});

test('T4: không có phiên nào thì chỉ có tuỳ chọn trống và không có nút Xoá phiên; thiếu auth không lỗi', () => {
  const html = ui.recordViewHtml({ status: idle, editing: null, saved: null });
  assert.match(html, /<option value="">/);
  assert.doesNotMatch(html, /data-rec-auth-del/);
});

test('T4: tên phiên được escape', () => {
  const html = ui.recordViewHtml({ status: idle, editing: null, saved: null, auth: [{ name: '<b>x', savedAt: '2026-10-19T07:00:00.000Z' }] });
  assert.doesNotMatch(html, /<b>x/);
  assert.match(html, /&lt;b&gt;x/);
});

test('T4: phiên login đang chạy hiện "Đang đăng nhập" và nút "Xong, lưu phiên"', () => {
  const html = ui.recordViewHtml({ status: { ...idle, state: 'recording', kind: 'login', name: 'admin', url: 'https://a.test/' }, editing: null, saved: null });
  assert.match(html, /Đang đăng nhập/);
  assert.match(html, /Xong, lưu phiên/);
  assert.match(html, /data-rec-stop/);
});

test('T4: phiên login done không bao giờ bị đem đi analyze; recStatusKey đổi theo kind', () => {
  assert.equal(ui.recNeedsAnalyze({ status: { state: 'done', kind: 'login' }, editing: null, saved: null, analyzing: false }), false);
  assert.equal(ui.recNeedsAnalyze({ status: { state: 'done', kind: 'record' }, editing: null, saved: null, analyzing: false }), true);
  const a = { state: 'recording', id: '1', canRecord: true, reason: null, kind: 'record' };
  assert.notEqual(ui.recStatusKey(a), ui.recStatusKey({ ...a, kind: 'login' }));
});
