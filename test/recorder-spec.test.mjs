// parseSpec / slugify: đổi file codegen (playwright-test) thành bước đọc được.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec, slugify } from '../server/recorder-spec.mjs';

const wrap = (...lines) => `import { test, expect } from '@playwright/test';\n\ntest('test', async ({ page }) => {\n${lines.map((l) => `  ${l}`).join('\n')}\n});`;

test('parseSpec: mỗi loại lệnh thành đúng kind, locator, value', () => {
  const { url, steps } = parseSpec(wrap(
    "await page.goto('https://a.test/');",
    "await page.getByRole('button', { name: 'Đăng nhập' }).click();",
    "await page.getByRole('link', { name: 'Home' }).dblclick();",
    "await page.getByLabel('Email').fill('x@y.z');",
    "await page.getByLabel('Email').press('Enter');",
    "await page.getByLabel('Nhớ tôi').check();",
    "await page.getByLabel('Nhớ tôi').uncheck();",
    "await page.getByLabel('Ngôn ngữ').selectOption('vi');",
    "await page.getByLabel('Ảnh').setInputFiles('a.png');",
    "await expect(page.getByText('Xin chào')).toBeVisible();",
  ));
  assert.equal(url, 'https://a.test/');
  assert.deepEqual(steps.map((s) => s.kind), ['goto', 'click', 'dblclick', 'fill', 'press', 'check', 'uncheck', 'selectOption', 'setInputFiles', 'expect']);
  assert.match(steps[1].text, /Đăng nhập/);
  assert.equal(steps[1].locator, "getByRole('button', { name: 'Đăng nhập' })");
  assert.equal(steps[3].value, 'x@y.z');
  assert.equal(steps[4].value, 'Enter');
  assert.equal(steps[7].value, 'vi');
  assert.equal(steps[9].locator, "getByText('Xin chào')");
  assert.ok(steps.every((s) => s.text.length > 0 && Number.isInteger(s.line)));
});

test('parseSpec: lệnh lạ thành other, giữ nguyên mã', () => {
  const { steps } = parseSpec(wrap('await page.waitForTimeout(500);'));
  assert.equal(steps.length, 1);
  assert.equal(steps[0].kind, 'other');
  assert.match(steps[0].text, /^Thao tác: /);
  assert.equal(steps[0].code, 'await page.waitForTimeout(500);');
});

test('parseSpec: bỏ import, test(), dòng đóng và dòng trống', () => {
  const { steps } = parseSpec(wrap("await page.goto('https://a.test/');"));
  assert.equal(steps.length, 1);
});

test('parseSpec: file rỗng không ném lỗi', () => {
  assert.deepEqual(parseSpec(''), { url: null, steps: [] });
  assert.deepEqual(parseSpec(undefined), { url: null, steps: [] });
});

test('parseSpec: chuỗi có dấu nháy escape', () => {
  const { steps } = parseSpec(wrap("await page.getByLabel('Tên').fill('a\\'b');"));
  assert.equal(steps[0].value, "a'b");
});

test('parseSpec: line là chỉ số dòng trong file gốc', () => {
  const text = wrap("await page.goto('https://a.test/');", "await page.getByText('x').click();");
  const lines = text.split('\n');
  const { steps } = parseSpec(text);
  for (const s of steps) assert.equal(lines[s.line].trim(), s.code);
});

test('slugify: bỏ dấu, chữ thường, gạch nối', () => {
  assert.equal(slugify('Đăng nhập Admin!'), 'dang-nhap-admin');
  assert.equal(slugify('../etc/passwd'), 'etc-passwd');
  assert.equal(slugify('!!!'), '');
  assert.ok(slugify('a'.repeat(100)).length <= 60);
  assert.equal(slugify('  A   B  '), 'a-b');
});
