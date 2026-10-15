// ui/bundle.mjs gộp module theo tên: import có alias (`X as Y`) làm Y không tồn tại trong bundle
// (lỗi thật ở v0.18.0: trang Cài đặt hệ thống báo "PROMPT_MAX is not defined")
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : d.name.endsWith('.js') ? [join(dir, d.name)] : []));

test('ui không dùng import có alias', () => {
  const bad = files(new URL('../ui', import.meta.url).pathname).filter((f) => /import\s*\{[^}]*\bas\b[^}]*\}/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(bad, []);
});
