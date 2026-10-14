// Issue Linear: cài đặt email/status, chuẩn hoá mã, merge refresh, lấy issue từ Linear, lưu và thêm tay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeLinear, readSettings, writeSettings } from '../server/settings.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'e2ed-li-'));

test('normalizeLinear: email chuẩn hoá (lowercase, bỏ khoảng trắng, bỏ trùng), status bỏ trống và trùng', () => {
  const out = normalizeLinear({ emails: [' A@X.com ', 'a@x.com', 'b@x.com'], statuses: [' In Progress ', 'In Progress', '', 'Todo'] });
  assert.deepEqual(out.emails, ['a@x.com', 'b@x.com']);
  assert.deepEqual(out.statuses, ['In Progress', 'Todo']);
});

test('normalizeLinear: email sai định dạng, quá 20 mục, hoặc status quá 60 ký tự bị từ chối 400', () => {
  assert.throws(() => normalizeLinear({ emails: ['không-phải-email'], statuses: [] }), (e) => e.status === 400);
  assert.throws(() => normalizeLinear({ emails: Array.from({ length: 21 }, (_, i) => `u${i}@x.com`), statuses: [] }), (e) => e.status === 400);
  assert.throws(() => normalizeLinear({ emails: [], statuses: ['x'.repeat(61)] }), (e) => e.status === 400);
});

test('writeSettings lưu khoá linear; readSettings trả mặc định rỗng khi chưa có', async () => {
  const root = tmp();
  assert.deepEqual((await readSettings(root)).linear, { emails: [], statuses: [] });
  await writeSettings(root, { linear: { emails: ['a@x.com'], statuses: ['Todo'] } });
  assert.deepEqual((await readSettings(root)).linear, { emails: ['a@x.com'], statuses: ['Todo'] });
});
