// Phiên codegen: kiểm tra môi trường, spawn, trạng thái, dừng, dọn dẹp. spawn giả, không mở browser thật.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRecorder, hasDisplay, validateRecordUrl } from '../server/recorder-session.mjs';

const SPEC = "import { test } from '@playwright/test';\ntest('t', async ({ page }) => {\n  await page.goto('https://a.test/');\n});\n";

function setup(over = {}) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'e2ed-rs-'));
  mkdirSync(join(projectRoot, 'node_modules', 'playwright-core'), { recursive: true });
  writeFileSync(join(projectRoot, 'node_modules', 'playwright-core', 'cli.js'), '');
  const calls = [];
  const spawnImpl = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (sig) => { child.killedWith = sig; return true; };
    calls.push({ cmd, args, opts, child, out: args[args.indexOf('-o') + 1] });
    return child;
  };
  const rec = createRecorder({
    projectRoot, spawnImpl, env: { DISPLAY: ':0' }, os: 'linux', tmpRoot: mkdtempSync(join(tmpdir(), 'e2ed-rt-')),
    browsers: () => ({ chromium: true }), ...over,
  });
  return { rec, calls, projectRoot };
}
const finish = (call, text, code = 0, signal = null) => {
  if (text !== null) writeFileSync(call.out, text);
  call.child.emit('close', code, signal);
};
const rejectsWith = (p, status) => assert.rejects(p, (e) => e.status === status);

test('validateRecordUrl: chỉ http/https, không rỗng, không khoảng trắng', () => {
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', '', 'a b', 'ftp://a.test', 42, null, undefined]) {
    assert.throws(() => validateRecordUrl(bad), (e) => e.status === 400, String(bad));
  }
  assert.equal(validateRecordUrl('https://a.test'), 'https://a.test/');
  assert.equal(validateRecordUrl('http://localhost:3000/x?y=1'), 'http://localhost:3000/x?y=1');
});

test('hasDisplay: Linux cần DISPLAY hoặc WAYLAND_DISPLAY; macOS/Windows luôn có', () => {
  assert.equal(hasDisplay({}, 'linux'), false);
  assert.equal(hasDisplay({ DISPLAY: ':0' }, 'linux'), true);
  assert.equal(hasDisplay({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux'), true);
  assert.equal(hasDisplay({}, 'darwin'), true);
  assert.equal(hasDisplay({}, 'win32'), true);
});

test('start: không có màn hình → 400, không spawn; status báo canRecord=false kèm lý do', async () => {
  const { rec, calls } = setup({ env: {} });
  await rejectsWith(rec.start({ url: 'https://a.test', name: 'a' }), 400);
  assert.equal(calls.length, 0);
  const st = rec.status();
  assert.equal(st.canRecord, false);
  assert.match(st.reason, /màn hình/);
});

test('start: thiếu playwright-core → 400', async () => {
  const { rec, calls, projectRoot } = setup();
  rmSync(join(projectRoot, 'node_modules'), { recursive: true });
  await assert.rejects(rec.start({ url: 'https://a.test', name: 'a' }), (e) => e.status === 400 && /playwright-core/.test(e.message));
  assert.equal(calls.length, 0);
});

test('start: thiếu chromium → 400 kèm lệnh cài; chromium không rõ (null) thì vẫn chạy', async () => {
  const missing = setup({ browsers: () => ({ chromium: false }) });
  await assert.rejects(missing.rec.start({ url: 'https://a.test', name: 'a' }), (e) => e.status === 400 && /install chromium/.test(e.message));
  assert.equal(missing.calls.length, 0);
  const unknown = setup({ browsers: () => ({ chromium: null }) });
  await unknown.rec.start({ url: 'https://a.test', name: 'a' });
  assert.equal(unknown.calls.length, 1);
});

test('start: url sai → 400 trước khi spawn', async () => {
  const { rec, calls } = setup();
  await rejectsWith(rec.start({ url: 'javascript:x', name: 'a' }), 400);
  assert.equal(calls.length, 0);
});

test('start: argv đúng, không dùng npx, không qua shell', async () => {
  const { rec, calls, projectRoot } = setup();
  await rec.start({ url: 'https://a.test', name: 'a' });
  const { cmd, args, opts } = calls[0];
  assert.equal(cmd, process.execPath);
  assert.equal(args[0], join(projectRoot, 'node_modules', 'playwright-core', 'cli.js'));
  assert.deepEqual(args.slice(1, 4), ['codegen', '--target', 'playwright-test']);
  assert.ok(args.includes('-o'));
  assert.equal(args.at(-1), 'https://a.test/');
  assert.ok(!args.includes('npx'));
  assert.ok(!opts?.shell);
});

test('start hai lần liền → lần hai 409', async () => {
  const { rec } = setup();
  await rec.start({ url: 'https://a.test', name: 'a' });
  await rejectsWith(rec.start({ url: 'https://b.test', name: 'b' }), 409);
});

test('thoát mã 0 với file có nội dung → done, result trả specText', async () => {
  const { rec, calls } = setup();
  const { id } = await rec.start({ url: 'https://a.test', name: 'Đăng nhập' });
  assert.equal(rec.status().state, 'recording');
  assert.equal(rec.result(), null);
  finish(calls[0], SPEC);
  const st = rec.status();
  assert.equal(st.state, 'done');
  assert.equal(st.id, id);
  assert.deepEqual(rec.result(), { id, name: 'Đăng nhập', url: 'https://a.test/', specText: SPEC });
});

test('thoát mã khác 0 → failed, error chứa stderr', async () => {
  const { rec, calls } = setup();
  await rec.start({ url: 'https://a.test', name: 'a' });
  calls[0].child.stderr.emit('data', Buffer.from('boom: không mở được browser'));
  finish(calls[0], null, 1);
  const st = rec.status();
  assert.equal(st.state, 'failed');
  assert.match(st.error, /boom/);
  assert.equal(rec.result(), null);
});

test('file rỗng dù mã 0 → failed', async () => {
  const { rec, calls } = setup();
  await rec.start({ url: 'https://a.test', name: 'a' });
  finish(calls[0], '   \n');
  assert.equal(rec.status().state, 'failed');
});

test('stderr dài bị rút gọn ≤ 300 ký tự', async () => {
  const { rec, calls } = setup();
  await rec.start({ url: 'https://a.test', name: 'a' });
  calls[0].child.stderr.emit('data', Buffer.from('x'.repeat(5000)));
  finish(calls[0], null, 1);
  assert.ok(rec.status().error.length <= 300);
});

test('stop: gửi SIGINT; file có nội dung thì done dù mã thoát 130', async () => {
  const { rec, calls } = setup();
  await rec.start({ url: 'https://a.test', name: 'a' });
  const p = rec.stop();
  assert.equal(calls[0].child.killedWith, 'SIGINT');
  finish(calls[0], SPEC, 130, 'SIGINT');
  assert.equal((await p).state, 'done');
});

test('stop khi không ghi → trả status hiện tại, không ném', async () => {
  const { rec } = setup();
  assert.equal((await rec.stop()).state, 'idle');
});

test('phiên done quá ttl coi như idle và result null', async () => {
  let t = 1000;
  const { rec, calls } = setup({ ttlMs: 500, now: () => t });
  await rec.start({ url: 'https://a.test', name: 'a' });
  finish(calls[0], SPEC);
  assert.equal(rec.status().state, 'done');
  t += 501;
  assert.equal(rec.status().state, 'idle');
  assert.equal(rec.result(), null);
  assert.equal(existsSync(dirname(calls[0].out)), false);
});

test('close: kill tiến trình đang chạy và xoá thư mục tạm', async () => {
  const { rec, calls } = setup();
  await rec.start({ url: 'https://a.test', name: 'a' });
  assert.equal(existsSync(dirname(calls[0].out)), true);
  rec.close();
  assert.ok(calls[0].child.killedWith);
  assert.equal(existsSync(dirname(calls[0].out)), false);
});

test('start sau khi phiên cũ done: thay thế, dọn thư mục cũ', async () => {
  const { rec, calls } = setup();
  await rec.start({ url: 'https://a.test', name: 'a' });
  finish(calls[0], SPEC);
  await rec.start({ url: 'https://b.test', name: 'b' });
  assert.equal(existsSync(dirname(calls[0].out)), false);
  assert.equal(rec.status().name, 'b');
});

test('clear: bỏ phiên done', async () => {
  const { rec, calls } = setup();
  await rec.start({ url: 'https://a.test', name: 'a' });
  finish(calls[0], SPEC);
  rec.clear();
  assert.equal(rec.status().state, 'idle');
  assert.equal(rec.result(), null);
});
