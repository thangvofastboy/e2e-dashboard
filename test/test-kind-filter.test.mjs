// Lọc loại file ở trang Tests: mặc định chỉ *.e2e.ts, chọn được *.spec.ts hoặc tất cả.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { testKind, matchesKind, TEST_KINDS } from '../ui/test-tree.js';

test('testKind: nhận diện *.e2e.* và *.spec.*, còn lại là other', () => {
  assert.equal(testKind('tests/login.e2e.ts'), 'e2e');
  assert.equal(testKind('tests/a/b/checkout.e2e.mjs'), 'e2e');
  assert.equal(testKind('tests/login.spec.ts'), 'spec');
  assert.equal(testKind('tests/login.spec.tsx'), 'spec');
  assert.equal(testKind('tests/helper.ts'), 'other');
  assert.equal(testKind('tests/login.test.ts'), 'spec');
  assert.equal(testKind('tests/login.test.mjs'), 'spec');
});

test('matchesKind: mặc định e2e chỉ giữ *.e2e.*, all giữ mọi loại', () => {
  assert.equal(matchesKind('tests/login.e2e.ts', 'e2e'), true);
  assert.equal(matchesKind('tests/login.spec.ts', 'e2e'), false);
  assert.equal(matchesKind('tests/login.spec.ts', 'spec'), true);
  assert.equal(matchesKind('tests/helper.ts', 'e2e'), false);
  assert.equal(matchesKind('tests/helper.ts', 'all'), true);
});

test('TEST_KINDS: e2e là mục đầu (mặc định), có Tất cả', () => {
  assert.deepEqual(TEST_KINDS.map(([v]) => v), ['e2e', 'spec', 'all']);
});

test('trang Tests: filter mặc định là e2e và lọc qua matchesKind', () => {
  const src = readFileSync(new URL('../ui/views/tests.js', import.meta.url), 'utf8');
  assert.match(src, /q: '', kind: 'e2e' \}/);
  assert.match(src, /matchesKind\(r\.file, filter\.kind\)/);
  assert.match(src, /data-f="kind"/);
});
