// setup thêm trace: 'retain-on-failure' khi config chưa đặt trace; không đè lựa chọn có sẵn
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patchTrace } from '../bin/dashboard.mjs';

test('patchTrace: thêm khi chưa có, giữ nguyên khi đã có hoặc không nhận ra dạng config', () => {
  const r = patchTrace("import { web } from '@e2e-dev/web';\nexport default {\n  reporters: ['list'],\n};\n");
  assert.equal(r.patched, true);
  assert.match(r.source, /export default \{\n  trace: 'retain-on-failure',/);
  assert.match(patchTrace('export default defineConfig({ x: 1 });').source, /defineConfig\(\{\n  trace: 'retain-on-failure'/);
  assert.equal(patchTrace("export default { trace: 'on' };").patched, false); // project tự chọn
  assert.equal(patchTrace("export default { targets: [{ trace: 'off' }] };").reason, 'already');
  assert.equal(patchTrace('module.exports = {};').reason, 'unknown-shape');
  assert.equal(patchTrace(r.source).patched, false); // chạy lại setup không thêm lần nữa
});
