import { test } from 'node:test';
import assert from 'node:assert/strict';
import { icon, ICON_SPRITE, ICON_NAMES } from '../ui/icons.js';
import { statusBadge, countChips, STATUS } from '../ui/format.js';

test('icon renders a sprite reference, decorative by default, labelled when asked', () => {
  assert.match(icon('check'), /^<svg class="icon ic-check" width="16" height="16" aria-hidden="true"><use href="#i-check"\/><\/svg>$/);
  assert.match(icon('x', { size: 12, label: 'thất bại <b>' }), /role="img" aria-label="thất bại &lt;b&gt;"/);
  assert.throws(() => icon('nope'), /unknown icon/);
});

test('sprite defines every icon name exactly once', () => {
  for (const n of ICON_NAMES) assert.equal(ICON_SPRITE.split(`id="i-${n}"`).length - 1, 1, n);
});

test('every status has an icon from the sprite and a tone', () => {
  for (const [k, s] of Object.entries(STATUS)) {
    assert.ok(ICON_NAMES.includes(s.icon), k);
    assert.match(s.tone, /^(good|warn|bad|muted|info)$/, k);
  }
});

test('statusBadge is a toned chip with an svg icon and no text glyphs', () => {
  const html = statusBadge('failed');
  assert.match(html, /class="chip tone-bad"/);
  assert.match(html, /#i-x/);
  assert.doesNotMatch(html, /[✓✗⚠⏱⏹⤼]/);
  assert.match(statusBadge('<x>'), /&lt;x&gt;/);
});

test('countChips shows a colored icon per non-zero status, numbers escaped', () => {
  const html = countChips({ passed: 39, failed: 3, flaky: 0, skipped: '<i>' });
  assert.match(html, /cnt tone-good.*#i-check.*39/s);
  assert.match(html, /cnt tone-bad.*#i-x.*3/s);
  assert.doesNotMatch(html, /tone-warn/);
  assert.doesNotMatch(html, /<i>/);
  assert.equal(countChips({}), '—');
});

test('Fastboy favicon mark keeps only the 3 triangle paths, no wordmark letters', async () => {
  const { LOGO_SVG, MARK_SVG } = await import('../ui/logo.js');
  assert.equal((MARK_SVG.match(/<path/g) ?? []).length, 3);
  assert.ok((LOGO_SVG.match(/<path/g) ?? []).length > 3);
  assert.match(MARK_SVG, /viewBox="0 0 79 72"/);
});

// icon() throw khi tên không có: một tên sai làm hỏng cả trang (trang Issue Linear từng trắng vì icon 'refresh'), nên kiểm mọi tên viết cứng trong ui/
test('every icon name used in ui/ exists in the sprite', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const ui = new URL('../ui', import.meta.url).pathname;
  const missing = [];
  for (const f of readdirSync(ui, { recursive: true }).filter((x) => x.endsWith('.js'))) {
    for (const m of readFileSync(join(ui, f), 'utf8').matchAll(/\bicon\(\s*'([\w-]+)'/g)) if (!ICON_NAMES.includes(m[1])) missing.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});
