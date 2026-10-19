// Vòng rà soát code Record: lộ token ở status, selectOption, thông báo lỗi, symlink, file quá lớn, URL trần,
// và hai chỗ hiệu năng (kiểm tra môi trường mỗi lần poll, thanh busy + vẽ lại khi poll).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redactSpec } from '../server/recorder-redact.mjs';
import { createRecorderApi } from '../server/recorder-api.mjs';
import { createRecorder, validateRecordUrl } from '../server/recorder-session.mjs';
import { RECORDED_SPEC_PATH } from '../server/recorder-ai.mjs';
import { writeNewTest } from '../server/aiextra.mjs';

const wrap = (...lines) => `import { test, expect } from '@playwright/test';\n\ntest('test', async ({ page }) => {\n${lines.map((l) => `  ${l}`).join('\n')}\n});\n`;
const tmp = () => mkdtempSync(join(tmpdir(), 'e2ed-polish-'));
const body = (b = {}) => async () => b;

test('M1: status / stop / discard không trả token trong url', async () => {
  const url = 'https://a.test/?token=Hunter22&page=2';
  const rec = { status: () => ({ state: 'recording', canRecord: true, reason: null, name: 'a', url }), stop: async () => ({ state: 'done', url }), clear: () => {}, result: () => null };
  const api = createRecorderApi({ projectRoot: tmp(), recorder: rec, runAi: async () => '' });
  for (const [method, path] of [['GET', 'status'], ['POST', 'stop'], ['POST', 'discard']]) {
    const r = await api({}, `/api/record/${path}`, method, body());
    assert.equal(r.status, 200, path);
    assert.ok(!JSON.stringify(r.body).includes('Hunter22'), `${path} lộ token`);
    assert.match(r.body.url, /page=2/, `${path} vẫn giữ tham số thường`);
  }
});

test('M3: selectOption vào ô nhạy cảm bị che; ô thường giữ nguyên', () => {
  const r = redactSpec(wrap("await page.getByLabel('Card number').selectOption('4111111111111111');"));
  assert.ok(!r.spec.includes('4111111111111111'));
  assert.match(r.spec, /selectOption\(process\.env\.E2E_SECRET_1\)/);
  const plain = wrap("await page.getByLabel('Ngôn ngữ').selectOption('vi');");
  assert.equal(redactSpec(plain).spec, plain);
});

test('M4: thông báo 400 của writeNewTest không nhắc .e2e.ts khi dùng pattern riêng', async () => {
  const root = tmp();
  await assert.rejects(() => writeNewTest(root, 'tests/recorded/../x.spec.ts', 'x', RECORDED_SPEC_PATH), (e) => e.status === 400 && !/\.e2e\.ts/.test(e.message));
  await assert.rejects(() => writeNewTest(root, 'x.txt', 'x'), (e) => e.status === 400 && /\.e2e\.ts/.test(e.message));
});

test('M5: gen-e2e không ghi xuyên symlink cases.json', async () => {
  const root = tmp();
  const outside = join(tmp(), 'outside.json');
  const original = JSON.stringify({ name: 'x', url: 'https://a.test/', testcases: [{ title: 't', steps: ['a'], expected: '' }], e2ePath: null });
  writeFileSync(outside, original);
  mkdirSync(join(root, 'tests', 'recorded'), { recursive: true });
  symlinkSync(outside, join(root, 'tests', 'recorded', 'dang-nhap.cases.json'));
  let aiCalls = 0;
  const api = createRecorderApi({ projectRoot: root, recorder: { status: () => ({}), result: () => null, clear: () => {} }, runAi: async () => { aiCalls++; return ''; } });
  const r = await api({}, '/api/record/gen-e2e', 'POST', body({ slug: 'dang-nhap' }));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /symlink/);
  assert.equal(readFileSync(outside, 'utf8'), original);
  assert.equal(aiCalls, 0);
});

test('URL trần: localhost → http, tên miền → https, javascript: vẫn bị chặn', () => {
  assert.equal(validateRecordUrl('localhost:3000'), 'http://localhost:3000/');
  assert.equal(validateRecordUrl('127.0.0.1:8080/x'), 'http://127.0.0.1:8080/x');
  assert.equal(validateRecordUrl('example.com/a'), 'https://example.com/a');
  for (const bad of ['javascript:alert(1)', 'mailto:x', 'file:///etc/passwd', 'a b', '']) assert.throws(() => validateRecordUrl(bad), (e) => e.status === 400, bad);
});

function recorderWith(over = {}) {
  const projectRoot = tmp();
  mkdirSync(join(projectRoot, 'node_modules', 'playwright-core'), { recursive: true });
  writeFileSync(join(projectRoot, 'node_modules', 'playwright-core', 'cli.js'), '');
  const calls = [];
  const spawnImpl = (_c, args) => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    calls.push({ child, out: args[args.indexOf('-o') + 1] });
    return child;
  };
  return { calls, rec: createRecorder({ projectRoot, spawnImpl, env: { DISPLAY: ':0' }, os: 'linux', tmpRoot: tmp(), ...over }) };
}

test('file codegen quá lớn → failed, không đưa vào bộ nhớ', async () => {
  const { rec, calls } = recorderWith({ browsers: () => ({ chromium: true }) });
  await rec.start({ url: 'https://a.test', name: 'a' });
  writeFileSync(calls[0].out, 'x'.repeat(1_000_001));
  calls[0].child.emit('close', 0, null);
  const st = rec.status();
  assert.equal(st.state, 'failed');
  assert.match(st.error, /quá lớn/);
  assert.equal(rec.result(), null);
});

test('hiệu năng: status() không kiểm tra môi trường lại mỗi lần gọi, hết 10 giây mới kiểm tra lại', () => {
  let t = 0;
  let calls = 0;
  const { rec } = recorderWith({ now: () => t, browsers: () => { calls++; return { chromium: true }; } });
  for (let i = 0; i < 5; i++) rec.status();
  assert.equal(calls, 1);
  t += 10_001;
  rec.status();
  assert.equal(calls, 2);
});

test('hiệu năng: start() luôn kiểm tra lại, cài chromium xong bấm Record là được ngay', async () => {
  let installed = false;
  const { rec, calls } = recorderWith({ browsers: () => ({ chromium: installed }) });
  assert.equal(rec.status().canRecord, false);
  installed = true;
  await rec.start({ url: 'https://a.test', name: 'a' });
  assert.equal(calls.length, 1);
});

test('hiệu năng: getJson quiet không bật thanh data-busy, getJson thường thì có', async () => {
  const attrs = [];
  globalThis.document = { addEventListener() {}, documentElement: { setAttribute: (k) => attrs.push(`+${k}`), removeAttribute: (k) => attrs.push(`-${k}`) } };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: 1 }) });
  const { getJson } = await import('../ui/api.js');
  await getJson('/x', { quiet: true });
  assert.deepEqual(attrs, []);
  await getJson('/x');
  assert.deepEqual(attrs, ['+data-busy', '-data-busy']);
});

test('hiệu năng: recStatusKey đổi khi trạng thái đổi, đứng yên khi poll không có gì mới', async () => {
  const { recStatusKey } = await import('../ui/views/record.js');
  const a = { state: 'recording', id: '1', canRecord: true, reason: null, name: 'a', url: 'https://a.test/' };
  assert.equal(recStatusKey(a), recStatusKey({ ...a }));
  assert.notEqual(recStatusKey(a), recStatusKey({ ...a, state: 'done' }));
  assert.notEqual(recStatusKey(a), recStatusKey({ ...a, state: 'failed', error: 'x' }));
  assert.notEqual(recStatusKey(a), recStatusKey({ ...a, canRecord: false, reason: 'Cần màn hình' }));
});
