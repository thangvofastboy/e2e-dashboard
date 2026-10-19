// redactSpec: không để mật khẩu/token lọt vào file spec hoặc danh sách bước (rồi gửi cho AI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSpec } from '../server/recorder-redact.mjs';

const SECRET = 'S3cr3t!';
const wrap = (...lines) => `import { test, expect } from '@playwright/test';\n\ntest('test', async ({ page }) => {\n${lines.map((l) => `  ${l}`).join('\n')}\n});`;
const clean = (r) => {
  assert.ok(!r.spec.includes(SECRET), `spec lộ bí mật:\n${r.spec}`);
  assert.ok(!JSON.stringify(r.steps).includes(SECRET), 'steps lộ bí mật');
};

for (const label of ['Password', 'Mật khẩu', 'OTP', 'PIN', 'CVV', 'Card number', 'Secret', 'API token', 'API key']) {
  test(`fill vào ô "${label}" bị che`, () => {
    const r = redactSpec(wrap(`await page.getByLabel('${label}').fill('${SECRET}');`));
    clean(r);
    assert.deepEqual(r.secrets, ['E2E_SECRET_1']);
    assert.match(r.spec, /fill\(process\.env\.E2E_SECRET_1\)/);
    assert.equal(r.steps[0].value, '«ẩn»');
    assert.match(r.steps[0].text, /«ẩn»/);
  });
}

test('press từng phím vào ô nhạy cảm gộp thành một bước fill đã che', () => {
  const keys = [...SECRET].map((c) => `await page.getByLabel('Password').press('${c}');`);
  const r = redactSpec(wrap(...keys, "await page.getByLabel('Password').press('Enter');"));
  clean(r);
  assert.equal(r.secrets.length, 1);
  assert.deepEqual(r.steps.map((s) => s.kind), ['fill', 'press']);
  assert.equal(r.steps[1].value, 'Enter');
  assert.equal((r.spec.match(/\.press\(/g) ?? []).length, 1);
});

test('goto che query nhạy cảm, giữ query thường', () => {
  const r = redactSpec(wrap(`await page.goto('https://a.test/cb?token=${SECRET}&page=2');`));
  clean(r);
  assert.match(r.spec, /page=2/);
  assert.match(r.spec, /process\.env\.E2E_SECRET_1/);
  assert.match(r.steps[0].value, /page=2/);
  assert.doesNotMatch(r.steps[0].value, /token=S/);
});

test('expect toHaveValue của ô nhạy cảm bị che', () => {
  const r = redactSpec(wrap(`await expect(page.getByLabel('Password')).toHaveValue('${SECRET}');`));
  clean(r);
  assert.match(r.spec, /toHaveValue\(process\.env\.E2E_SECRET_1\)/);
});

test('setInputFiles chỉ giữ tên file', () => {
  const r = redactSpec(wrap("await page.getByLabel('Ảnh').setInputFiles('/home/u/secret/a.png');"));
  assert.doesNotMatch(r.spec, /\/home\/u/);
  assert.equal(r.steps[0].value, 'a.png');
});

test('ô thường không bị che; giá trị giống khoá API thì bị che', () => {
  const plain = redactSpec(wrap("await page.getByLabel('Email').fill('x@y.z');"));
  assert.equal(plain.spec, wrap("await page.getByLabel('Email').fill('x@y.z');"));
  assert.deepEqual(plain.secrets, []);
  const key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
  const r = redactSpec(wrap(`await page.getByLabel('Ghi chú').fill('${key}');`));
  assert.ok(!r.spec.includes(key));
  assert.ok(!JSON.stringify(r.steps).includes(key));
  assert.equal(r.secrets.length, 1);
});

test('hai ô nhạy cảm khác nhau dùng hai biến khác nhau; cùng ô dùng lại một biến', () => {
  const r = redactSpec(wrap(
    "await page.getByLabel('Password').fill('aaaa1111');",
    "await page.getByLabel('OTP').fill('123456');",
    "await expect(page.getByLabel('Password')).toHaveValue('aaaa1111');",
  ));
  assert.deepEqual(r.secrets, ['E2E_SECRET_1', 'E2E_SECRET_2']);
  assert.ok(!r.spec.includes('aaaa1111') && !r.spec.includes('123456'));
});

test('không có gì nhạy cảm: spec giữ nguyên, secrets rỗng', () => {
  const text = wrap("await page.goto('https://a.test/');", "await page.getByRole('button', { name: 'Đăng nhập' }).click();");
  const r = redactSpec(text);
  assert.equal(r.spec, text);
  assert.deepEqual(r.secrets, []);
  assert.equal(r.steps.length, 2);
});

test('file rỗng không ném lỗi', () => {
  assert.deepEqual(redactSpec(''), { spec: '', steps: [], secrets: [] });
});
