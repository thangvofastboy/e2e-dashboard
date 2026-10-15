// Chốt các lỗi giao diện đã sửa: đọc mã nguồn (các chỗ này cần DOM thật mới chạy được).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p) => readFileSync(new URL(`../ui/${p}`, import.meta.url), 'utf8');

test('e.currentTarget chỉ đọc vào biến trước await (sau await là null: Gỡ issue không chạy, finally ném lỗi)', () => {
  for (const f of ['views/run.js', 'views/linear.js']) {
    for (const line of src(f).split('\n').filter((l) => l.includes('e.currentTarget'))) {
      assert.match(line.trim(), /=\s*e\.currentTarget;|^copyToClipboard\(.*e\.currentTarget\);$/, `${f}: ${line.trim()}`);
    }
  }
});

test('MutationObserver của app.js không quét cả body mỗi mutation', () => {
  const app = src('app.js');
  assert.doesNotMatch(app, /enhance\(document\.body\)/);
  assert.match(app, /#toasts/); // toast hiện / ẩn không kéo theo pageExtras cả trang
});

test('trang Projects giữ một vòng poll AI và trả hàm dừng cho router', () => {
  const p = src('views/projects.js');
  assert.match(p, /stopPoll\(\);\s*\n\s*stopPoll = \(\) => \{\};/);
  assert.match(p, /return \(\) => stopPoll\(\);/);
});
