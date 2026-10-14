import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterTests, fold } from '../ui/test-picker.js';

const rows = [
  { value: '1', title: 'Thêm vào Giỏ hàng', file: 'tests/cart.e2e.ts', tags: ['smoke'] },
  { value: '2', title: 'Đăng nhập', file: 'tests/Auth/login.e2e.ts', tags: [] },
  { value: '3', title: 'Thanh toán', file: 'tests/pay.e2e.ts', tags: ['Thanh-Toán'] },
];

test('filterTests bỏ dấu và không phân biệt hoa thường', () => {
  assert.deepEqual(filterTests(rows, 'gio hang').map((r) => r.value), ['1']);
  assert.deepEqual(filterTests(rows, 'GIỎ').map((r) => r.value), ['1']);
  assert.deepEqual(filterTests(rows, 'dang nhap').map((r) => r.value), ['2']);
});

test('filterTests khớp cả file và tag', () => {
  assert.deepEqual(filterTests(rows, 'auth/').map((r) => r.value), ['2']);
  assert.deepEqual(filterTests(rows, 'smoke').map((r) => r.value), ['1']);
  assert.deepEqual(filterTests(rows, 'thanh-toan').map((r) => r.value), ['3']);
});

test('filterTests với chuỗi rỗng trả về tất cả', () => {
  assert.equal(filterTests(rows, '').length, 3);
  assert.equal(filterTests(rows, '   ').length, 3);
  assert.equal(filterTests(rows, undefined).length, 3);
});

test('fold đổi đ thành d', () => {
  assert.equal(fold('Đường'), 'duong');
});
