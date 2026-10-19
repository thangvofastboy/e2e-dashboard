// Các lỗi reviewer cuối tìm ra ở tính năng Record: popup page1, từ khoá nhạy cảm, URL, escape, biến env theo giá trị,
// poll analyze song song, discard. Mỗi ca tái hiện đúng đầu vào làm vỡ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSpec } from '../server/recorder-spec.mjs';
import { redactSpec } from '../server/recorder-redact.mjs';
import { createRecorderApi } from '../server/recorder-api.mjs';

const wrap = (...lines) => `import { test, expect } from '@playwright/test';\n\ntest('test', async ({ page }) => {\n${lines.map((l) => `  ${l}`).join('\n')}\n});\n`;
const leaks = (r, ...secrets) => secrets.filter((s) => r.spec.includes(s) || JSON.stringify(r.steps).includes(s));
const ui = await import('../ui/views/record.js');

test('C1: bí mật nhập trên popup page1 bị che, tên biến page được giữ', () => {
  const r = redactSpec(wrap(
    "const page1Promise = page.waitForEvent('popup');",
    "await page.getByText('SSO').click();",
    'const page1 = await page1Promise;',
    "await page1.getByLabel('Password').fill('Hunter22');",
    "await page1.goto('https://idp.test/cb?token=Tok3nValue');",
    "await expect(page1.getByLabel('Password')).toHaveValue('Hunter22');",
  ));
  assert.deepEqual(leaks(r, 'Hunter22', 'Tok3nValue'), []);
  assert.match(r.spec, /await page1\.getByLabel\('Password'\)\.fill\(process\.env\.E2E_SECRET_1\);/);
  assert.match(r.spec, /await page1\.goto\(`/);
  assert.match(r.spec, /await expect\(page1\.getByLabel\('Password'\)\)\.toHaveValue\(process\.env\.E2E_SECRET_1\);/);
  assert.deepEqual(r.secrets, ['E2E_SECRET_1', 'E2E_SECRET_2']);
});

test('C1: parseSpec nhận page1/page2 và ghi lại biến page của bước', () => {
  const { steps } = parseSpec(wrap("await page2.getByRole('button', { name: 'OK' }).click();"));
  assert.equal(steps[0].kind, 'click');
  assert.equal(steps[0].page, 'page2');
});

test('C1: type() và pressSequentially() vào ô nhạy cảm cũng bị che', () => {
  const r = redactSpec(wrap("await page.getByLabel('Password').type('Hunter22');", "await page.getByLabel('Password').pressSequentially('Hunter22');"));
  assert.deepEqual(leaks(r, 'Hunter22'), []);
});

for (const loc of ["locator('#pw')", "locator('#pwd')", "locator('[name=\"pass\"]')", "getByLabel('Passwort')", "getByPlaceholder('Nhập mã xác thực')", "getByLabel('2FA code')"]) {
  test(`I1: fill vào ${loc} bị che`, () => {
    assert.deepEqual(leaks(redactSpec(wrap(`await page.${loc}.fill('Hunter22');`)), 'Hunter22'), []);
  });
}

test('I1: ô thường (Keyword, Tìm kiếm) không bị che', () => {
  const text = wrap("await page.getByLabel('Keyword').fill('giày');", "await page.getByPlaceholder('Tìm kiếm').fill('áo');");
  assert.equal(redactSpec(text).spec, text);
});

test('I2: token sau dấu # (OAuth implicit) bị che, tham số thường giữ', () => {
  const r = redactSpec(wrap("await page.goto('https://a.test/cb#access_token=Hunter22&state=xyz');"));
  assert.deepEqual(leaks(r, 'Hunter22'), []);
  assert.match(r.spec, /state=xyz/);
});

test('I2: tên tham số chứa từ khoá (client_secret, otp_code, id_token, accessToken) bị che; keyword thì không', () => {
  const r = redactSpec(wrap("await page.goto('https://a.test/x?client_secret=Hunter22&otp_code=Hunter23&id_token=Hunter24&accessToken=Hunter25&keyword=shoes');"));
  assert.deepEqual(leaks(r, 'Hunter22', 'Hunter23', 'Hunter24', 'Hunter25'), []);
  assert.match(r.spec, /keyword=shoes/);
  assert.equal(r.secrets.length, 4);
});

test('I2: mật khẩu trong user:pass@host bị che, user giữ', () => {
  const r = redactSpec(wrap("await page.goto('https://admin:Hunter22@x.test/path');"));
  assert.deepEqual(leaks(r, 'Hunter22'), []);
  assert.match(r.spec, /admin:/);
  assert.match(r.spec, /@x\.test\/path/);
});

test('I3: giá trị có dấu nháy và $ còn sót ở dòng khác bị che cả dạng escape', () => {
  const r = redactSpec(wrap("await page.getByLabel('Password').fill('it\\'s$ecret');", "await page.getByText('it\\'s$ecret').click();"));
  assert.deepEqual(leaks(r, "it's$ecret", "it\\'s$ecret"), []);
});

test('I4: cùng ô, hai giá trị khác nhau → hai biến khác nhau; cùng giá trị thì dùng lại', () => {
  const r = redactSpec(wrap(
    "await page.getByLabel('Password').fill('Hunter22');",
    "await page.getByLabel('Password').fill('Other333');",
    "await page.getByLabel('Password').fill('Hunter22');",
  ));
  assert.deepEqual(r.secrets, ['E2E_SECRET_1', 'E2E_SECRET_2']);
  const lines = r.spec.split('\n').filter((l) => l.includes('.fill('));
  assert.match(lines[0], /E2E_SECRET_1/);
  assert.match(lines[1], /E2E_SECRET_2/);
  assert.match(lines[2], /E2E_SECRET_1/);
});

test('I4: token URL khác giá trị → biến khác nhau', () => {
  const r = redactSpec(wrap("await page.goto('https://a.test/?token=AAAA1111');", "await page.goto('https://a.test/?token=BBBB2222');"));
  assert.deepEqual(r.secrets, ['E2E_SECRET_1', 'E2E_SECRET_2']);
});

test('I4: phím Shift+B chen giữa chuỗi gõ không làm lộ ký tự hay tách thành hai bước', () => {
  const r = redactSpec(wrap(
    "await page.getByLabel('Password').press('H');",
    "await page.getByLabel('Password').press('Shift+B');",
    "await page.getByLabel('Password').press('u');",
    "await page.getByLabel('Password').press('Enter');",
  ));
  assert.deepEqual(r.steps.map((s) => s.kind), ['fill', 'press']);
  assert.ok(!r.spec.includes('Shift+B'));
  assert.equal(r.secrets.length, 1);
});

test('I5: chỉ phân tích khi phiên done, chưa có testcase, chưa lưu và chưa có lượt analyze đang chạy', () => {
  const base = { status: { state: 'done' }, editing: null, saved: null, analyzing: false };
  assert.equal(ui.recNeedsAnalyze(base), true);
  assert.equal(ui.recNeedsAnalyze({ ...base, analyzing: true }), false);
  assert.equal(ui.recNeedsAnalyze({ ...base, editing: { testcases: [] } }), false);
  assert.equal(ui.recNeedsAnalyze({ ...base, saved: {} }), false);
  assert.equal(ui.recNeedsAnalyze({ ...base, status: { state: 'recording' } }), false);
});

test('I6: vào lại trang giữ testcase đang sửa khi phiên còn done, bỏ khi không', () => {
  const prev = { testcases: [{ title: 'a' }] };
  assert.equal(ui.recKeepEditing({ state: 'done' }, prev), prev);
  for (const state of ['idle', 'recording', 'failed']) assert.equal(ui.recKeepEditing({ state }, prev), null);
  assert.equal(ui.recKeepEditing({ state: 'done' }, null), null);
});

test('I6: POST /api/record/discard gọi recorder.clear và trả status', async () => {
  let cleared = 0;
  const recorder = { status: () => ({ state: 'idle', canRecord: true, reason: null }), result: () => null, clear: () => { cleared++; } };
  const api = createRecorderApi({ projectRoot: mkdtempSync(join(tmpdir(), 'e2ed-rfix-')), recorder, runAi: async () => '' });
  const r = await api({}, '/api/record/discard', 'POST', async () => ({}));
  assert.equal(r.status, 200);
  assert.equal(r.body.state, 'idle');
  assert.equal(cleared, 1);
  assert.equal(await api({}, '/api/record/discard', 'GET', async () => ({})), null);
});
