// Quay video một test (`/e2e-dashboard demo`, nút "Quay phim"): cùng một đường chạy với Chạy test, chỉ thêm video=on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunArgs } from '../server/runner.mjs';
import { runnerFor } from '../server/playwright.mjs';
import { runOptionsHtml } from '../ui/views/run-dialog.js';

test('buildRunArgs: video on thành --video=on, đặt sau file test', () => {
  const args = buildRunArgs({ tests: ['tests/login.e2e.ts:12'], video: 'on' });
  assert.deepEqual(args.slice(0, 3), ['e2e', 'run', 'tests/login.e2e.ts:12']);
  assert.ok(args.includes('--video=on'));
});

test('runnerFor: chỉ test *.e2e.ts đi qua e2e (demo từ chối file Playwright)', () => {
  assert.equal(runnerFor(['tests/login.e2e.ts:12']), 'e2e');
  assert.equal(runnerFor(['tests/login.spec.ts']), 'playwright');
});

test('runOptionsHtml: preset video=on chọn sẵn ô Video, không preset thì không chọn', () => {
  assert.match(runOptionsHtml({ preset: { video: 'on' } }), /<option value="on" selected>/);
  assert.doesNotMatch(runOptionsHtml({}), /value="on" selected/);
});
