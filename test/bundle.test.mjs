import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleUi } from '../ui/bundle.mjs';

test('orders modules by dependency, includes each once, strips import/export', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ui-'));
  mkdirSync(join(dir, 'views'));
  writeFileSync(join(dir, 'b.js'), 'export const base = 2;\n');
  writeFileSync(join(dir, 'views/c.js'), "import { base } from '../b.js';\nexport function triple() { return base * 3; }\n");
  writeFileSync(join(dir, 'app.js'), "import { base } from './b.js';\nimport { triple } from './views/c.js';\nglobalThis.__out = base + triple();\n");
  const code = await bundleUi(dir);
  assert.doesNotMatch(code, /^\s*(import|export)\s/m);
  assert.equal(code.match(/const base = 2/g).length, 1);
  assert.ok(code.indexOf('const base') < code.indexOf('function triple'));
  new Function(code)();
  assert.equal(globalThis.__out, 8);
});

test('rejects export default', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ui-'));
  writeFileSync(join(dir, 'app.js'), 'export default 1;\n');
  await assert.rejects(bundleUi(dir), /export default/);
});

test('bundle UI thật parse được (cú pháp module lạ như `export { … }` từng làm trắng cả trang)', async () => {
  const js = await bundleUi(join(import.meta.dirname, '..', 'ui'));
  assert.doesNotThrow(() => new Function(js)); // chỉ parse, không chạy
});

test('bundler từ chối `export { … }`', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2ed-bundle-'));
  writeFileSync(join(dir, 'app.js'), "const a = 1;\nexport { a };\n");
  await assert.rejects(bundleUi(dir), /export \{ … \} is not supported/);
});
