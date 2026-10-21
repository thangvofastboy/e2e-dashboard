import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Mục menu đang chọn tô nền var(--hue) + icon trắng: thiếu --hue thì icon trắng trên nền sáng → mất hút.
test('mọi mục menu đều có --hue', () => {
  const app = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../ui/style.css', import.meta.url), 'utf8');
  const nav = app.slice(app.indexOf('const NAV'), app.indexOf('const EXPORT_VIEWS'));
  const ids = [...nav.matchAll(/\['([a-z0-9-]+)', '#\//g)].map((m) => m[1]);
  const hued = new Set([...css.matchAll(/\.n-([a-z0-9-]+) *\{ *--hue/g)].map((m) => m[1]));
  assert.deepEqual(ids.filter((i) => !hued.has(i)), []);
});
