// Route /api/record/*: start, stop, status, analyze, save, gen-e2e. recorder và AI giả, ghi file thật vào thư mục tạm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRecorderApi } from '../server/recorder-api.mjs';

const SECRET = 'S3cr3t!';
const wrap = (...lines) => `import { test, expect } from '@playwright/test';\n\ntest('test', async ({ page }) => {\n${lines.map((l) => `  ${l}`).join('\n')}\n});\n`;
const LOGIN = wrap("await page.goto('https://a.test/');", "await page.getByLabel('Email').fill('x@y.z');", `await page.getByLabel('Password').fill('${SECRET}');`, "await page.getByRole('button', { name: 'Đăng nhập' }).click();");
const AI_JSON = '```json\n{"testcases":[{"title":"Đăng nhập thành công","steps":["Mở trang","Nhập email"],"expected":"Vào được trang chủ"}]}\n```';
const E2E_REPLY = '```ts\nimport { test } from "@e2e-dev/web";\n```\nPATH: tests/recorded/dang-nhap.e2e.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'e2ed-rapi-'));
const readBody = (b) => async () => b;

function fakeRecorder(specText = LOGIN, name = 'Đăng nhập') {
  const rec = {
    started: [], cleared: 0,
    status: () => ({ state: 'idle', canRecord: true, reason: null }),
    start: async (a) => { rec.started.push(a); return { id: 'rec-1' }; },
    stop: async () => ({ state: 'done', canRecord: true, reason: null }),
    result: () => (specText === null ? null : { id: 'rec-1', name, url: 'https://a.test/', specText }),
    clear: () => { rec.cleared++; },
  };
  return rec;
}
function make({ root = tmp(), recorder = fakeRecorder(), runAi = async () => AI_JSON } = {}) {
  const prompts = [];
  const api = createRecorderApi({ projectRoot: root, recorder, runAi: async (p) => { prompts.push(p); return runAi(p); } });
  const call = (method, path, body = {}) => api({}, `/api/record/${path}`, method, readBody(body));
  return { api, call, root, recorder, prompts };
}

test('đường dẫn ngoài /api/record/ hoặc không có route → null', async () => {
  const { api } = make();
  assert.equal(await api({}, '/api/linear/issues', 'GET', readBody({})), null);
  assert.equal(await api({}, '/api/record/unknown', 'POST', readBody({})), null);
  assert.equal(await api({}, '/api/record/start', 'GET', readBody({})), null);
});

test('GET status trả trạng thái của recorder', async () => {
  const { call } = make();
  const r = await call('GET', 'status');
  assert.equal(r.status, 200);
  assert.equal(r.body.state, 'idle');
});

test('start: url sai hoặc tên vô nghĩa → 400 và không gọi recorder', async () => {
  const { call, recorder } = make();
  assert.equal((await call('POST', 'start', { url: 'javascript:x', name: 'a' })).status, 400);
  assert.equal((await call('POST', 'start', { url: 'https://a.test', name: '!!!' })).status, 400);
  assert.equal((await call('POST', 'start', { url: 'https://a.test', name: 42 })).status, 400);
  assert.equal(recorder.started.length, 0);
});

test('start: hợp lệ chuyển url chuẩn hoá và tên cho recorder', async () => {
  const { call, recorder } = make();
  const r = await call('POST', 'start', { url: 'https://a.test', name: ' Đăng nhập ' });
  assert.deepEqual(r, { status: 200, body: { id: 'rec-1' } });
  assert.deepEqual(recorder.started, [{ url: 'https://a.test/', name: 'Đăng nhập' }]);
});

test('lỗi có status từ recorder đi ra đúng mã', async () => {
  const recorder = { ...fakeRecorder(), start: async () => { throw Object.assign(new Error('Đang có một phiên record'), { status: 409 }); } };
  const { call } = make({ recorder });
  const r = await call('POST', 'start', { url: 'https://a.test', name: 'a' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'Đang có một phiên record');
});

test('stop trả status', async () => {
  const { call } = make();
  assert.equal((await call('POST', 'stop')).body.state, 'done');
});

test('analyze: chưa có phiên done → 400', async () => {
  const { call } = make({ recorder: fakeRecorder(null) });
  assert.equal((await call('POST', 'analyze')).status, 400);
});

test('analyze: bí mật không lọt vào prompt, testcase hay response', async () => {
  const { call, prompts } = make();
  const r = await call('POST', 'analyze');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.secrets, ['E2E_SECRET_1']);
  assert.equal(r.body.slug, 'dang-nhap');
  assert.equal(r.body.testcases[0].expected, 'Vào được trang chủ');
  assert.ok(!r.body.aiError);
  assert.ok(prompts.length === 1 && !prompts[0].includes(SECRET));
  assert.ok(!JSON.stringify(r.body).includes(SECRET));
});

test('analyze: AI ném lỗi hoặc trả rác → 200, aiError, testcase gốc để người dùng điền', async () => {
  for (const runAi of [async () => { throw new Error('AI không trả lời'); }, async () => 'không phải json']) {
    const { call } = make({ runAi });
    const r = await call('POST', 'analyze');
    assert.equal(r.status, 200);
    assert.ok(r.body.aiError);
    assert.equal(r.body.testcases.length, 1);
    assert.ok(r.body.testcases[0].steps.length > 0);
    assert.equal(r.body.testcases[0].expected, '');
  }
});

test('analyze: file chỉ có goto vẫn ra một testcase một bước', async () => {
  const { call } = make({ recorder: fakeRecorder(wrap("await page.goto('https://a.test/');")), runAi: async () => { throw new Error('x'); } });
  const r = await call('POST', 'analyze');
  assert.equal(r.status, 200);
  assert.equal(r.body.testcases[0].steps.length, 1);
});

test('save: ghi spec đã che + cases.json, rồi clear phiên', async () => {
  const { call, root, recorder } = make();
  const testcases = [{ title: 'Đăng nhập', steps: ['Mở trang', 'Bấm'], expected: 'OK' }];
  const r = await call('POST', 'save', { testcases });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { specPath: 'tests/recorded/dang-nhap.spec.ts', casesPath: 'tests/recorded/dang-nhap.cases.json', secrets: ['E2E_SECRET_1'] });
  const spec = readFileSync(join(root, r.body.specPath), 'utf8');
  assert.ok(!spec.includes(SECRET));
  assert.match(spec, /fill\(process\.env\.E2E_SECRET_1\)/);
  const cases = JSON.parse(readFileSync(join(root, r.body.casesPath), 'utf8'));
  assert.equal(cases.name, 'Đăng nhập');
  assert.equal(cases.url, 'https://a.test/');
  assert.equal(cases.specPath, r.body.specPath);
  assert.equal(cases.e2ePath, null);
  assert.equal(cases.testcases[0].id, 'tc-1');
  assert.match(cases.recordedAt, /^\d{4}-\d\d-\d\dT/);
  assert.ok(!JSON.stringify(cases).includes(SECRET));
  assert.equal(recorder.cleared, 1);
});

test('save: trùng slug → 409, không ghi đè, chưa clear; đổi tên thì lưu được', async () => {
  const { call, root, recorder } = make();
  const testcases = [{ title: 't', steps: ['a'], expected: '' }];
  assert.equal((await call('POST', 'save', { testcases })).status, 200);
  const before = readFileSync(join(root, 'tests/recorded/dang-nhap.spec.ts'), 'utf8');
  const again = await call('POST', 'save', { testcases });
  assert.equal(again.status, 409);
  assert.equal(recorder.cleared, 1);
  assert.equal(readFileSync(join(root, 'tests/recorded/dang-nhap.spec.ts'), 'utf8'), before);
  const renamed = await call('POST', 'save', { testcases, name: 'Đăng nhập 2' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.specPath, 'tests/recorded/dang-nhap-2.spec.ts');
});

test('save: 409 vì chỉ còn cases.json cũng không để lại spec nửa vời', async () => {
  const { call, root } = make();
  const testcases = [{ title: 't', steps: ['a'], expected: '' }];
  await call('POST', 'save', { testcases });
  rmSync(join(root, 'tests/recorded/dang-nhap.spec.ts'));
  assert.equal((await call('POST', 'save', { testcases })).status, 409);
  assert.equal(existsSync(join(root, 'tests/recorded/dang-nhap.spec.ts')), false);
});

test('save: testcases rỗng hoặc quá 50 → 400; tên chứa ../ không ghi ra ngoài tests/recorded', async () => {
  const { call, root } = make();
  const one = [{ title: 't', steps: ['a'], expected: '' }];
  assert.equal((await call('POST', 'save', { testcases: [] })).status, 400);
  assert.equal((await call('POST', 'save', { testcases: Array.from({ length: 51 }, () => one[0]) })).status, 400);
  assert.equal((await call('POST', 'save', { testcases: [{ title: 't', steps: [], expected: '' }] })).status, 400);
  assert.equal((await call('POST', 'save', { testcases: one, name: '!!!' })).status, 400);
  const r = await call('POST', 'save', { testcases: one, name: '../x' });
  assert.equal(r.status, 200);
  assert.equal(r.body.specPath, 'tests/recorded/x.spec.ts');
  assert.deepEqual(readdirSync(root).sort(), ['tests']);
});

test('save: không có phiên done → 400', async () => {
  const { call } = make({ recorder: fakeRecorder(null) });
  assert.equal((await call('POST', 'save', { testcases: [{ title: 't', steps: ['a'], expected: '' }] })).status, 400);
});

test('save: hai lần song song cùng slug → đúng một 200 và một 409', async () => {
  const { call } = make();
  const testcases = [{ title: 't', steps: ['a'], expected: '' }];
  const rs = await Promise.all([call('POST', 'save', { testcases }), call('POST', 'save', { testcases })]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
});

test('gen-e2e: slug sai → 400; thiếu cases.json → 404', async () => {
  const { call } = make();
  for (const slug of ['../x', 'A', '', 'a/b', undefined]) assert.equal((await call('POST', 'gen-e2e', { slug })).status, 400, String(slug));
  assert.equal((await call('POST', 'gen-e2e', { slug: 'khong-co' })).status, 404);
});

test('gen-e2e: ghi .e2e.ts cạnh spec, cập nhật e2ePath; lần hai → 409', async () => {
  const { call, root, prompts } = make({ runAi: async (p) => (p.includes('runner `e2e`') ? E2E_REPLY : AI_JSON) });
  await call('POST', 'save', { testcases: [{ title: 'Đăng nhập', steps: ['Mở trang'], expected: 'OK' }] });
  const r = await call('POST', 'gen-e2e', { slug: 'dang-nhap' });
  assert.deepEqual(r, { status: 200, body: { saved: 'tests/recorded/dang-nhap.e2e.ts' } });
  assert.ok(existsSync(join(root, 'tests/recorded/dang-nhap.e2e.ts')));
  const cases = JSON.parse(readFileSync(join(root, 'tests/recorded/dang-nhap.cases.json'), 'utf8'));
  assert.equal(cases.e2ePath, 'tests/recorded/dang-nhap.e2e.ts');
  const e2ePrompt = prompts.at(-1);
  assert.ok(!e2ePrompt.includes(SECRET));
  assert.match(e2ePrompt, /Đăng nhập/);
  const before = prompts.length;
  assert.equal((await call('POST', 'gen-e2e', { slug: 'dang-nhap' })).status, 409);
  assert.equal(prompts.length, before, 'không gọi AI khi file đã có');
});

test('gen-e2e: AI trả PATH sai → 502 và không ghi file', async () => {
  const { call, root } = make({ runAi: async (p) => (p.includes('runner `e2e`') ? E2E_REPLY.replace('dang-nhap', 'khac') : AI_JSON) });
  await call('POST', 'save', { testcases: [{ title: 't', steps: ['a'], expected: '' }] });
  assert.equal((await call('POST', 'gen-e2e', { slug: 'dang-nhap' })).status, 502);
  assert.equal(existsSync(join(root, 'tests/recorded/dang-nhap.e2e.ts')), false);
});
