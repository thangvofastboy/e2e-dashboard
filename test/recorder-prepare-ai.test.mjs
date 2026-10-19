// P2: prompt cho AI chuẩn bị phiên bằng agent của runner `e2e`; bí mật là handle, không bao giờ nằm trong prompt/argv/file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractPlaceholders, parseDotenv, resolveSecrets, secretKey, paramKey, buildInstruction, buildPrepareTest, buildPrepareConfig, stateFromRun, createPreparer,
} from '../server/recorder-prepare-ai.mjs';
import { createRecorder } from '../server/recorder-session.mjs';
import { createRecorderApi } from '../server/recorder-api.mjs';
import { installedBrowsers } from '../server/browsers.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'e2ed-pai-'));
const PW = 'hunter22xyz';
const rejectsWith = (p, status, re) => assert.rejects(p, (e) => e.status === status && (!re || re.test(e.message)));

// ---- phần thuần ----
test('extractPlaceholders: chỉ nhận {{E2E_…}}, không trùng, giữ thứ tự, chịu khoảng trắng', () => {
  assert.deepEqual(extractPlaceholders('dùng {{E2E_USER}} và {{ E2E_PASS_1 }} rồi lại {{E2E_USER}}'), ['E2E_USER', 'E2E_PASS_1']);
  assert.deepEqual(extractPlaceholders('{{HOME}} {{aws_secret}} {{E2E_}} {E2E_X} {{E2E_a}}'), []);
  assert.deepEqual(extractPlaceholders(''), []);
});

test('parseDotenv: KEY=VALUE, export, nháy đơn/đôi, comment, giá trị chứa =', () => {
  const env = parseDotenv('# c\nA=1\nexport B="two words"\nC=\'x y\'\n\nD=a=b\nBAD LINE\n  E2E_X = spaced \n');
  assert.deepEqual(env, { A: '1', B: 'two words', C: 'x y', D: 'a=b', E2E_X: 'spaced' });
});

test('resolveSecrets: môi trường thắng .env; thiếu và quá ngắn được liệt kê (chỉ tên)', () => {
  const r = resolveSecrets(['E2E_A', 'E2E_B', 'E2E_C', 'E2E_D'], { env: { E2E_A: 'from-env-1' }, dotenv: { E2E_A: 'from-dotenv', E2E_B: 'from-dotenv-b', E2E_C: 'abc' } });
  assert.deepEqual(r.values, { E2E_A: 'from-env-1', E2E_B: 'from-dotenv-b' });
  assert.deepEqual(r.missing, ['E2E_D']);
  assert.deepEqual(r.short, ['E2E_C']);
});

test('secretKey / paramKey', () => {
  assert.equal(secretKey('E2E_ADMIN_PASSWORD'), 'e2e-admin-password');
  assert.equal(paramKey('E2E_ADMIN_PASSWORD'), 'e2e_admin_password');
});

test('buildInstruction: placeholder thành tên param, không còn {{…}}, dặn dừng khi xong', () => {
  const s = buildInstruction('Đăng nhập bằng {{E2E_ADMIN_USER}} / {{E2E_ADMIN_PASSWORD}} rồi mở Cài đặt');
  assert.ok(!s.includes('{{'));
  assert.match(s, /e2e_admin_user/);
  assert.match(s, /e2e_admin_password/);
  assert.match(s, /Cài đặt/);
  assert.match(s, /kết thúc/i);
});

test('buildPrepareTest: agent.act với params là secrets.get; prompt độc hại nằm gọn trong chuỗi JSON', () => {
  const evil = 'x"); process.exit(1); ("';
  const src = buildPrepareTest({ path: '/login?next=%2F', instruction: evil, names: ['E2E_ADMIN_PASSWORD'] });
  assert.ok(src.includes(JSON.stringify(evil)));
  assert.ok(!src.includes('x"); process.exit(1);'), 'dấu nháy của prompt phải được escape, không đóng chuỗi sớm');
  assert.match(src, /agent\.act\(/);
  assert.match(src, /e2e_admin_password: secrets\.get\("e2e-admin-password"\)/);
  assert.ok(src.includes(JSON.stringify('/login?next=%2F')));
  assert.match(src, /browser\.cookies\(\)/);
  assert.match(src, /E2E_PREPARE_OUT/);
});

test('buildPrepareTest: không có placeholder thì không có params; actCode thay agent.act', () => {
  assert.doesNotMatch(buildPrepareTest({ path: '/', instruction: 'x', names: [] }), /params/);
  const custom = buildPrepareTest({ path: '/', instruction: 'x', names: [], actCode: 'await screen.getByText("a").tap();' });
  assert.match(custom, /screen\.getByText\("a"\)\.tap\(\)/);
  assert.doesNotMatch(custom, /agent\.act/);
});

test('buildPrepareConfig: import config thật, chỉ reporter list, output riêng, secrets lấy từ biến môi trường', () => {
  const src = buildPrepareConfig({ projectConfigPath: '/p/e2e.config.ts' });
  assert.ok(src.includes(JSON.stringify('/p/e2e.config.ts')));
  assert.match(src, /reporters: \['list'\]/);
  assert.match(src, /E2E_PREPARE_OUTPUT/);
  assert.match(src, /E2E_PREPARE_NAMES/);
  assert.doesNotMatch(src, /dashboard/i);
});

test('stateFromRun: cookie lấy mặc định an toàn, localStorage thành origins; rác thành rỗng', () => {
  const st = stateFromRun({ cookies: [{ name: 'sid', value: 'v', domain: 'a.test' }, { name: 'k', value: 'w', domain: 'a.test', path: '/x', expires: 99, httpOnly: true, secure: true, sameSite: 'Strict' }], origin: 'https://a.test', local: { tok: '1' } });
  assert.deepEqual(st.cookies[0], { name: 'sid', value: 'v', domain: 'a.test', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' });
  assert.deepEqual(st.cookies[1], { name: 'k', value: 'w', domain: 'a.test', path: '/x', expires: 99, httpOnly: true, secure: true, sameSite: 'Strict' });
  assert.deepEqual(st.origins, [{ origin: 'https://a.test', localStorage: [{ name: 'tok', value: '1' }] }]);
  assert.deepEqual(stateFromRun({ cookies: [], origin: 'https://a.test', local: {} }), { cookies: [], origins: [] });
  assert.deepEqual(stateFromRun(null), { cookies: [], origins: [] });
  assert.deepEqual(stateFromRun({ cookies: 'x', local: 5 }), { cookies: [], origins: [] });
});

// ---- createPreparer với spawn giả ----
function setup(over = {}) {
  const projectRoot = tmp();
  writeFileSync(join(projectRoot, 'e2e.config.ts'), 'export default {};\n');
  mkdirSync(join(projectRoot, 'node_modules', 'e2e'), { recursive: true });
  const calls = [];
  const saved = [];
  const spawnImpl = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (sig) => { child.killedWith = sig; return true; };
    calls.push({ cmd, args, opts, child });
    return child;
  };
  const prep = createPreparer({
    projectRoot, spawnImpl, env: { E2E_ADMIN_PASSWORD: PW, E2E_ADMIN_USER: 'admin@shop.test', PATH: process.env.PATH },
    aiStatus: async () => ({ provider: 'claude' }), resolveBin: () => '/fake/e2e/bin.js', browsers: () => ({ chromium: true }),
    saveAuth: (name, state) => { saved.push([name, state]); return { name }; }, ...over,
  });
  return { prep, calls, saved, projectRoot };
}
const run = (prep, over = {}) => prep.run({ name: 'admin', url: 'https://shop.test/login', prompt: 'Đăng nhập bằng {{E2E_ADMIN_USER}} / {{E2E_ADMIN_PASSWORD}}', ...over });
const COOKIE_OUT = JSON.stringify({ cookies: [{ name: 'sid', value: 'abc', domain: 'shop.test', path: '/' }], origin: 'https://shop.test', local: {} });

test('điều kiện: chưa cấu hình AI, thiếu runner e2e, thiếu chromium → 400 và không spawn', async () => {
  for (const [over, re] of [[{ aiStatus: async () => ({ provider: 'none' }) }, /AI/], [{ resolveBin: () => null }, /e2e/], [{ browsers: () => ({ chromium: false }) }, /chromium/]]) {
    const { prep, calls } = setup(over);
    await rejectsWith(run(prep), 400, re);
    assert.equal(calls.length, 0);
  }
});

test('điều kiện: prompt rỗng / quá dài, tên sai → 400', async () => {
  const { prep } = setup();
  await rejectsWith(run(prep, { prompt: '   ' }), 400);
  await rejectsWith(run(prep, { prompt: 'x'.repeat(4001) }), 400);
  await rejectsWith(run(prep, { name: '!!!' }), 400);
});

test('thiếu biến hoặc giá trị quá ngắn → 400 chỉ nêu tên biến; không spawn', async () => {
  const a = setup({ env: { PATH: process.env.PATH } });
  await rejectsWith(run(a.prep), 400, /E2E_ADMIN_USER.*E2E_ADMIN_PASSWORD|E2E_ADMIN_PASSWORD.*E2E_ADMIN_USER/s);
  const b = setup({ env: { E2E_ADMIN_USER: 'admin@shop.test', E2E_ADMIN_PASSWORD: 'abc' } });
  await assert.rejects(run(b.prep), (e) => e.status === 400 && /E2E_ADMIN_PASSWORD/.test(e.message) && !e.message.includes('abc'));
  assert.equal(a.calls.length + b.calls.length, 0);
});

test('đọc biến từ .env của project khi môi trường không có', async () => {
  const { prep, calls, projectRoot } = setup({ env: { PATH: process.env.PATH } });
  writeFileSync(join(projectRoot, '.env'), `E2E_ADMIN_USER=admin@shop.test\nE2E_ADMIN_PASSWORD="${PW}"\n`);
  const p = run(prep);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls[0].opts.env.E2E_ADMIN_PASSWORD, PW);
  calls[0].child.emit('close', 1, null);
  await p.catch(() => {});
});

test('chạy: file sinh ra không chứa bí mật; bí mật chỉ nằm trong env của tiến trình con; thành công thì lưu phiên và dọn thư mục', async () => {
  const { prep, calls, saved, projectRoot } = setup();
  const p = run(prep);
  await new Promise((r) => setImmediate(r));
  const c = calls[0];
  assert.equal(c.cmd, process.execPath);
  assert.equal(c.args[0], '/fake/e2e/bin.js');
  assert.deepEqual(c.args.slice(1, 3), ['run', '--config']);
  assert.ok(!JSON.stringify(c.args).includes(PW), 'bí mật không nằm trong argv');
  const cfg = c.args[3];
  const dir = join(cfg, '..');
  assert.ok(dir.startsWith(join(projectRoot, '.e2e-dashboard', 'prepare')));
  for (const f of readdirSync(dir)) assert.ok(!readFileSync(join(dir, f), 'utf8').includes(PW), `${f} lộ bí mật`);
  assert.equal(c.opts.env.E2E_ADMIN_PASSWORD, PW);
  assert.equal(c.opts.env.E2E_PREPARE_NAMES, 'E2E_ADMIN_USER,E2E_ADMIN_PASSWORD');
  assert.equal(c.opts.env.E2E_PREPARE_URL, 'https://shop.test');
  const testSrc = readFileSync(join(dir, 'prepare.e2e.ts'), 'utf8');
  assert.ok(testSrc.includes(JSON.stringify('/login')));
  writeFileSync(c.opts.env.E2E_PREPARE_OUT, COOKIE_OUT);
  c.child.emit('close', 0, null);
  assert.deepEqual(await p, { name: 'admin' });
  assert.equal(saved[0][0], 'admin');
  assert.equal(saved[0][1].cookies[0].name, 'sid');
  assert.ok(!existsSync(dir), 'thư mục tạm được xoá');
});

test('chạy lỗi: thông báo bị che giá trị bí mật và URL; không lưu phiên; thư mục tạm xoá', async () => {
  const { prep, calls, saved } = setup();
  const p = run(prep);
  await new Promise((r) => setImmediate(r));
  calls[0].child.stdout.emit('data', Buffer.from(`step failed at https://shop.test/login?token=abc, typed ${PW} for admin@shop.test`));
  calls[0].child.emit('close', 1, null);
  await assert.rejects(p, (e) => {
    assert.equal(e.status, 502);
    for (const leak of [PW, 'admin@shop.test', 'https://shop.test', 'token=abc']) assert.ok(!e.message.includes(leak), `lộ ${leak}: ${e.message}`);
    return true;
  });
  assert.equal(saved.length, 0);
});

test('chạy xong nhưng không có cookie nào → 502 "đăng nhập chưa", không lưu', async () => {
  const { prep, calls, saved } = setup();
  const p = run(prep);
  await new Promise((r) => setImmediate(r));
  writeFileSync(calls[0].opts.env.E2E_PREPARE_OUT, JSON.stringify({ cookies: [], origin: 'https://shop.test', local: {} }));
  calls[0].child.emit('close', 0, null);
  await rejectsWith(p, 502, /đăng nhập chưa/);
  assert.equal(saved.length, 0);
});

test('quá thời gian → kill và báo lỗi; hai lần cùng lúc → 409', async () => {
  const { prep, calls } = setup({ timeoutMs: 20 });
  const first = run(prep);
  await new Promise((r) => setImmediate(r));
  await rejectsWith(run(prep, { name: 'b' }), 409);
  await rejectsWith(first, 502, /thời gian/);
  assert.equal(calls[0].child.killedWith, 'SIGKILL');
});

// ---- API ----
test('API prepare-ai: kiểm tra đầu vào, chuyển cho preparer, không lộ prompt hay bí mật trong phản hồi', async () => {
  const calls = [];
  const preparer = { run: async (a) => { calls.push(a); return { name: a.name }; } };
  const recorder = { status: () => ({}), result: () => null, clear: () => {}, listAuth: () => [{ name: 'admin', savedAt: '2026-10-19T09:00:00.000Z' }] };
  const api = createRecorderApi({ projectRoot: tmp(), recorder, preparer, runAi: async () => { throw new Error('không được gọi'); } });
  const call = (b) => api({}, '/api/record/prepare-ai', 'POST', async () => b);
  const ok = { name: ' Admin ', url: 'shop.test/login', prompt: 'Đăng nhập bằng {{E2E_ADMIN_PASSWORD}}' };
  const r = await call(ok);
  assert.equal(r.status, 200);
  assert.deepEqual(calls[0], { name: 'admin', url: 'https://shop.test/login', prompt: ok.prompt });
  assert.deepEqual(r.body, { name: 'admin', sessions: [{ name: 'admin', savedAt: '2026-10-19T09:00:00.000Z' }] });
  for (const bad of [{ ...ok, name: '!!!' }, { ...ok, url: 'javascript:x' }, { ...ok, prompt: 42 }, { ...ok, prompt: undefined }, { ...ok, prompt: '  ' }]) {
    assert.equal((await call(bad)).status, 400, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal(calls.length, 1);
});

test('API prepare-ai: lỗi có status từ preparer đi ra đúng mã', async () => {
  const preparer = { run: async () => { throw Object.assign(new Error('Hết thời gian chờ AI'), { status: 502 }); } };
  const api = createRecorderApi({ projectRoot: tmp(), recorder: { status: () => ({}), result: () => null, clear: () => {}, listAuth: () => [] }, preparer, runAi: async () => '' });
  const r = await api({}, '/api/record/prepare-ai', 'POST', async () => ({ name: 'a', url: 'https://a.test/', prompt: 'x' }));
  assert.equal(r.status, 502);
});

// ---- UI ----
test('UI: ô prompt AI, nút chạy, gợi ý placeholder; ô prompt không mang sẵn nội dung', async () => {
  const ui = await import('../ui/views/record.js');
  const html = ui.recordViewHtml({ status: { state: 'idle', canRecord: true, reason: null }, editing: null, saved: null, auth: [] });
  assert.match(html, /<textarea[^>]*data-rec-ai-prompt[^>]*><\/textarea>/);
  assert.match(html, /data-rec-prepare-ai/);
  assert.match(html, /\{\{E2E_/);
  assert.match(html, /\.env/);
});

// ---- runner e2e thật: bước gõ cố định thay cho agent (không có AI), kiểm chứng toàn bộ đường ống còn lại ----
const hasChromium = installedBrowsers().chromium === true;
test('runner e2e thật: config bọc + secret handle + ghi cookie → phiên được lưu, không lộ bí mật, không để lại file', { skip: !hasChromium && 'chưa cài chromium' }, async () => {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => { res.writeHead(302, { 'set-cookie': `sid=${/pw=([^&]*)/.exec(b)?.[1] ?? 'x'}; Path=/; HttpOnly`, location: '/home' }); res.end(); });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(req.url === '/home' ? '<!doctype html><title>home</title><h1>Welcome</h1>' : '<!doctype html><title>login</title><form method="post"><label>Password <input type="password" name="pw"></label><button type="submit">Sign in</button></form>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const projectRoot = tmp();
    symlinkSync(join(REPO, 'node_modules'), join(projectRoot, 'node_modules'));
    writeFileSync(join(projectRoot, 'package.json'), '{"name":"p","type":"module"}\n');
    writeFileSync(join(projectRoot, 'e2e.config.ts'), "import { web } from '@e2e-dev/web';\nexport default { targets: [{ engine: web(), app: { url: 'http://localhost:1' } }] };\n");
    writeFileSync(join(projectRoot, '.env'), `E2E_ADMIN_PASSWORD=${PW}\n`);
    const rec = createRecorder({ projectRoot, tmpRoot: tmp(), env: {}, os: 'linux' });
    const prep = createPreparer({ projectRoot, env: { PATH: process.env.PATH, HOME: process.env.HOME }, aiStatus: async () => ({ provider: 'claude' }), saveAuth: (n, s) => rec.saveAuth(n, s) });
    const base = `http://127.0.0.1:${server.address().port}`;
    const out = await prep.run({ name: 'admin', url: `${base}/login`, prompt: 'Đăng nhập bằng {{E2E_ADMIN_PASSWORD}}', _act: "await screen.getByLabel('Password').fill(secrets.get('e2e-admin-password'));\n  await screen.getByRole('button', 'Sign in').tap();" });
    assert.deepEqual(out, { name: 'admin' });
    const file = join(projectRoot, '.e2e-dashboard', 'auth', 'admin.json');
    const state = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(state.cookies.map((c) => [c.name, c.value]), [['sid', PW]]);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.ok(!existsSync(join(projectRoot, '.e2e-dashboard', 'prepare')) || readdirSync(join(projectRoot, '.e2e-dashboard', 'prepare')).length === 0, 'thư mục tạm đã dọn');
    assert.deepEqual(readdirSync(join(projectRoot, '.e2e-dashboard', 'auth')), ['admin.json']);
  } finally {
    server.close();
  }
});
