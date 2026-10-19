// P1: dựng phiên đăng nhập từ chuỗi Cookie (DevTools) và/hoặc link đăng nhập một lần, không qua AI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCookieHeader, cookieState } from '../server/recorder-cookie.mjs';
import { createRecorder } from '../server/recorder-session.mjs';
import { createRecorderApi } from '../server/recorder-api.mjs';
import { installedBrowsers } from '../server/browsers.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'e2ed-prep-'));
const SECRET = 'sess-Hunter22-value';
const rejectsWith = (p, status, re) => assert.rejects(p, (e) => e.status === status && (!re || re.test(e.message)));
const throwsWith = (fn, status) => assert.throws(fn, (e) => e.status === status);

// ---- parse chuỗi Cookie ----
test('parseCookieHeader: chuỗi Cookie của DevTools, có hoặc không có tiền tố "Cookie:"', () => {
  assert.deepEqual(parseCookieHeader('sid=abc; theme=dark'), [{ name: 'sid', value: 'abc' }, { name: 'theme', value: 'dark' }]);
  assert.deepEqual(parseCookieHeader('Cookie: sid=abc;theme=dark;'), [{ name: 'sid', value: 'abc' }, { name: 'theme', value: 'dark' }]);
  assert.deepEqual(parseCookieHeader('  cookie:   a=1  '), [{ name: 'a', value: '1' }]);
});

test('parseCookieHeader: giá trị chứa dấu = và ký tự % được giữ nguyên; xuống dòng cũng là dấu tách', () => {
  assert.deepEqual(parseCookieHeader('tok=a=b%3D; x=%7B%22a%22'), [{ name: 'tok', value: 'a=b%3D' }, { name: 'x', value: '%7B%22a%22' }]);
  assert.deepEqual(parseCookieHeader('a=1\r\nb=2\nc=3'), [{ name: 'a', value: '1' }, { name: 'b', value: '2' }, { name: 'c', value: '3' }]);
});

test('parseCookieHeader: rỗng, thiếu =, tên sai, quá 100 cookie → 400; lỗi không lộ giá trị', () => {
  for (const bad of ['', '   ', 'Cookie:', ';;;', 'novalue', '=x', 'bad name=1', 'a b=1']) throwsWith(() => parseCookieHeader(bad), 400);
  throwsWith(() => parseCookieHeader(Array.from({ length: 101 }, (_, i) => `c${i}=1`).join('; ')), 400);
  try {
    parseCookieHeader(`bad name=${SECRET}`);
    assert.fail('phải ném lỗi');
  } catch (e) {
    assert.ok(!e.message.includes(SECRET));
  }
  throwsWith(() => parseCookieHeader(undefined), 400);
  throwsWith(() => parseCookieHeader(42), 400);
});

test('cookieState: storageState host-only theo hostname của URL, secure theo scheme', () => {
  const https = cookieState([{ name: 'sid', value: 'abc' }], 'https://shop.test:8443/login?x=1');
  assert.deepEqual(https, { cookies: [{ name: 'sid', value: 'abc', domain: 'shop.test', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'Lax' }], origins: [] });
  const http1 = cookieState([{ name: 'sid', value: 'abc' }], 'http://localhost:3000/');
  assert.equal(http1.cookies[0].domain, 'localhost');
  assert.equal(http1.cookies[0].secure, false);
});

// ---- phiên codegen: saveAuth + prepareLink ----
function setup(over = {}) {
  const projectRoot = tmp();
  mkdirSync(join(projectRoot, 'node_modules', 'playwright-core'), { recursive: true });
  writeFileSync(join(projectRoot, 'node_modules', 'playwright-core', 'cli.js'), '');
  const calls = [];
  const spawnImpl = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (sig) => { child.killedWith = sig; return true; };
    calls.push({ cmd, args, opts, child });
    return child;
  };
  const rec = createRecorder({ projectRoot, spawnImpl, env: {}, os: 'linux', tmpRoot: tmp(), browsers: () => ({ chromium: true }), ...over });
  const authFile = (name) => join(projectRoot, '.e2e-dashboard', 'auth', `${name}.json`);
  return { rec, calls, projectRoot, authFile };
}
const STATE = { cookies: [{ name: 'sid', value: SECRET, domain: 'shop.test', path: '/' }], origins: [] };

test('saveAuth: ghi phiên 0600, không cần màn hình; trạng thái rỗng hoặc tên sai → 400', () => {
  const { rec, authFile } = setup();
  assert.deepEqual(rec.saveAuth('admin', STATE), { name: 'admin' });
  assert.equal(statSync(authFile('admin')).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(authFile('admin'), 'utf8')), STATE);
  throwsWith(() => rec.saveAuth('admin', { cookies: [], origins: [] }), 400);
  throwsWith(() => rec.saveAuth('../x', STATE), 400);
  assert.equal(rec.listAuth()[0].name, 'admin');
});

test('prepareLink: truyền dữ liệu qua file 0600 (không qua argv), thành công thì lưu phiên và dọn file tạm', async () => {
  const { rec, calls, authFile, projectRoot } = setup();
  const p = rec.prepareLink({ name: 'admin', url: 'https://shop.test/', link: 'https://shop.test/magic?t=LINKSECRET', cookies: STATE.cookies });
  const c = calls[0];
  assert.equal(c.cmd, process.execPath);
  assert.equal(c.opts.cwd, projectRoot);
  assert.ok(!JSON.stringify(c.args).includes('LINKSECRET') && !JSON.stringify(c.args).includes(SECRET), 'bí mật không nằm trong argv');
  const [, inputFile, outFile] = c.args;
  assert.equal(statSync(inputFile).mode & 0o777, 0o600);
  const input = JSON.parse(readFileSync(inputFile, 'utf8'));
  assert.equal(input.link, 'https://shop.test/magic?t=LINKSECRET');
  assert.equal(input.cookies[0].value, SECRET);
  writeFileSync(outFile, JSON.stringify(STATE));
  c.child.emit('close', 0, null);
  assert.deepEqual(await p, { name: 'admin' });
  assert.deepEqual(JSON.parse(readFileSync(authFile('admin'), 'utf8')), STATE);
  assert.ok(!existsSync(inputFile) && !existsSync(outFile), 'file tạm chứa bí mật được xoá');
});

test('prepareLink: lỗi không lộ link hay cookie, phiên cũ còn nguyên', async () => {
  const { rec, calls, authFile } = setup();
  rec.saveAuth('admin', STATE);
  const before = readFileSync(authFile('admin'), 'utf8');
  const p = rec.prepareLink({ name: 'admin', url: 'https://shop.test/', link: 'https://shop.test/magic?t=LINKSECRET', cookies: STATE.cookies });
  calls[0].child.stderr.emit('data', Buffer.from(`page.goto: net::ERR_FAILED at https://shop.test/magic?t=LINKSECRET with ${SECRET}`));
  calls[0].child.emit('close', 1, null);
  await assert.rejects(p, (e) => {
    assert.ok(!e.message.includes('LINKSECRET') && !e.message.includes(SECRET), `lộ bí mật: ${e.message}`);
    return e.status === 502;
  });
  assert.equal(readFileSync(authFile('admin'), 'utf8'), before);
});

test('prepareLink: mở link xong mà không có cookie nào → lỗi "đăng nhập chưa", không lưu', async () => {
  const { rec, calls, authFile } = setup();
  const p = rec.prepareLink({ name: 'admin', url: 'https://shop.test/', link: 'https://shop.test/magic', cookies: [] });
  writeFileSync(calls[0].args[2], JSON.stringify({ cookies: [], origins: [] }));
  calls[0].child.emit('close', 0, null);
  await rejectsWith(p, 502, /đăng nhập chưa/);
  assert.ok(!existsSync(authFile('admin')));
});

test('prepareLink: quá thời gian thì kill và báo lỗi; hai lần cùng lúc → 409; tên sai → 400', async () => {
  const { rec, calls } = setup({ linkTimeoutMs: 20 });
  await rejectsWith(rec.prepareLink({ name: '!!!', url: 'https://shop.test/', link: 'https://shop.test/m', cookies: [] }), 400);
  const first = rec.prepareLink({ name: 'admin', url: 'https://shop.test/', link: 'https://shop.test/m', cookies: [] });
  await rejectsWith(rec.prepareLink({ name: 'b', url: 'https://shop.test/', link: 'https://shop.test/m', cookies: [] }), 409);
  await rejectsWith(first, 502, /thời gian/);
  assert.equal(calls[0].child.killedWith, 'SIGKILL');
});

test('prepareLink: thiếu chromium hoặc playwright-core → 400, không spawn', async () => {
  const { rec, calls } = setup({ browsers: () => ({ chromium: false }) });
  await rejectsWith(rec.prepareLink({ name: 'a', url: 'https://shop.test/', link: 'https://shop.test/m', cookies: [] }), 400, /chromium/);
  assert.equal(calls.length, 0);
});

// ---- API ----
const body = (b = {}) => async () => b;
function makeApi(over = {}) {
  const calls = { save: [], link: [] };
  const recorder = {
    status: () => ({ state: 'idle' }), result: () => null, clear: () => {},
    listAuth: () => [{ name: 'admin', savedAt: '2026-10-19T08:00:00.000Z' }],
    saveAuth: (n, s) => { calls.save.push([n, s]); return { name: n }; },
    prepareLink: async (a) => { calls.link.push(a); return { name: a.name }; },
    ...over,
  };
  const api = createRecorderApi({ projectRoot: tmp(), recorder, runAi: async () => { throw new Error('P1 không được gọi AI'); } });
  return { call: (b) => api({}, '/api/record/prepare', 'POST', body(b)), calls };
}

test('API prepare: chỉ cookie → dựng storageState và lưu, không mở trình duyệt, không gọi AI', async () => {
  const { call, calls } = makeApi();
  const r = await call({ name: ' Admin ', url: 'https://shop.test/login', cookie: `Cookie: sid=${SECRET}; theme=dark` });
  assert.equal(r.status, 200);
  assert.equal(calls.link.length, 0);
  assert.equal(calls.save[0][0], 'admin');
  assert.deepEqual(calls.save[0][1].cookies.map((c) => [c.name, c.domain]), [['sid', 'shop.test'], ['theme', 'shop.test']]);
  assert.deepEqual(r.body.sessions, [{ name: 'admin', savedAt: '2026-10-19T08:00:00.000Z' }]);
  assert.equal(r.body.name, 'admin');
  assert.ok(!JSON.stringify(r.body).includes(SECRET), 'response không chứa cookie');
});

test('API prepare: có link → gọi prepareLink kèm cookie đã dựng (nếu có), không lưu trực tiếp', async () => {
  const { call, calls } = makeApi();
  const r = await call({ name: 'admin', url: 'https://shop.test/', link: 'https://shop.test/magic?t=1', cookie: 'a=1' });
  assert.equal(r.status, 200);
  assert.equal(calls.save.length, 0);
  assert.equal(calls.link[0].link, 'https://shop.test/magic?t=1');
  assert.equal(calls.link[0].url, 'https://shop.test/');
  assert.equal(calls.link[0].cookies[0].name, 'a');
  const linkOnly = await call({ name: 'admin', url: 'https://shop.test/', link: 'https://shop.test/magic' });
  assert.equal(linkOnly.status, 200);
  assert.deepEqual(calls.link[1].cookies, []);
});

test('API prepare: thiếu cả cookie lẫn link, tên/url/link/cookie sai → 400 và không động tới recorder', async () => {
  const { call, calls } = makeApi();
  const ok = { name: 'admin', url: 'https://shop.test/', cookie: 'a=1' };
  for (const bad of [{ ...ok, cookie: undefined }, { ...ok, name: '!!!' }, { ...ok, url: 'javascript:x' }, { ...ok, cookie: 'khong-co-dau-bang' }, { ...ok, cookie: undefined, link: 'javascript:alert(1)' }, { ...ok, cookie: 42 }, { ...ok, link: 42 }]) {
    assert.equal((await call(bad)).status, 400, JSON.stringify(bad).slice(0, 80));
  }
  assert.equal(calls.save.length + calls.link.length, 0);
});

test('API prepare: lỗi có status từ recorder đi ra đúng mã và không lộ cookie', async () => {
  const { call } = makeApi({ prepareLink: async () => { throw Object.assign(new Error('Hết thời gian chờ mở link'), { status: 502 }); } });
  const r = await call({ name: 'admin', url: 'https://shop.test/', link: 'https://shop.test/magic', cookie: `sid=${SECRET}` });
  assert.equal(r.status, 502);
  assert.ok(!JSON.stringify(r.body).includes(SECRET));
});

// ---- UI ----
test('UI: form có ô dán cookie, ô link và nút lưu phiên; ô cookie không mang sẵn nội dung', async () => {
  const ui = await import('../ui/views/record.js');
  const html = ui.recordViewHtml({ status: { state: 'idle', canRecord: true, reason: null }, editing: null, saved: null, auth: [] });
  assert.match(html, /<textarea[^>]*data-rec-cookie[^>]*><\/textarea>/);
  assert.match(html, /data-rec-link/);
  assert.match(html, /data-rec-prepare/);
  assert.match(html, /autocomplete="off"/);
  // máy không có màn hình vẫn dựng được phiên từ cookie: nút không bị khoá theo canRecord
  const noDisplay = ui.recordViewHtml({ status: { state: 'idle', canRecord: false, reason: 'Cần màn hình' }, editing: null, saved: null, auth: [] });
  assert.doesNotMatch(noDisplay, /data-rec-prepare[^>]*disabled/);
});

// ---- trình duyệt thật: script mở link headless rồi lưu phiên ----
const hasChromium = installedBrowsers().chromium === true;
test('trình duyệt thật: link một lần đặt cookie → phiên có cả cookie dán sẵn lẫn cookie do link đặt', { skip: !hasChromium && 'chưa cài chromium' }, async () => {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/magic')) {
      res.writeHead(302, { 'set-cookie': 'sid=MAGIC123; Path=/; HttpOnly', location: '/home' });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>home</title>ok');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const projectRoot = tmp();
    symlinkSync(join(REPO, 'node_modules'), join(projectRoot, 'node_modules'));
    const rec = createRecorder({ projectRoot, tmpRoot: tmp(), env: {}, os: 'linux' });
    const base = `http://127.0.0.1:${server.address().port}`;
    const cookies = cookieState(parseCookieHeader('pre=PASTED'), `${base}/`).cookies;
    assert.deepEqual(await rec.prepareLink({ name: 'admin', url: `${base}/`, link: `${base}/magic?t=1`, cookies }), { name: 'admin' });
    const saved = JSON.parse(readFileSync(join(projectRoot, '.e2e-dashboard', 'auth', 'admin.json'), 'utf8'));
    assert.deepEqual(saved.cookies.map((c) => [c.name, c.value]).sort(), [['pre', 'PASTED'], ['sid', 'MAGIC123']]);
    assert.equal(statSync(join(projectRoot, '.e2e-dashboard', 'auth', 'admin.json')).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(join(projectRoot, '.e2e-dashboard', 'auth')), ['admin.json'], 'không để lại file tạm');
  } finally {
    server.close();
  }
});
