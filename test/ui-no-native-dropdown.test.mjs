// Quy tắc UI: danh sách item của dropdown phải theo style của web. <select> được vẽ theo theme nhờ `appearance: base-select`
// (ui/style.css); <datalist> thì popup do trình duyệt vẽ, CSS không chạm tới được, nên không dùng.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = fileURLToPath(new URL('../ui', import.meta.url));
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []));

test('không có <datalist> hay input[list] trong UI', () => {
  const bad = walk(UI).filter((f) => /<datalist\b|\blist="/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(bad.map((f) => f.replace(UI, 'ui')), []);
});

test('mọi <select> được vẽ bằng base-select (trừ tri-status) và item dropdown có style hover / đang chọn', () => {
  const css = readFileSync(join(UI, 'style.css'), 'utf8');
  assert.match(css, /@supports \(appearance: base-select\) \{[^]*select::picker\(select\)[^]*select option:hover[^]*select option:checked/);
});
