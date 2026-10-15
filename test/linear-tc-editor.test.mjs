// Bảng sửa testcase của issue Linear: mỗi testcase một thẻ, đủ 3 ô data-f mà liReadEditor đọc, escape nội dung.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liEditorHtml } from '../ui/views/linear-issues.js';

test('liEditorHtml: thẻ TC đánh số, ô tiêu đề / các bước / kết quả, nút Lưu chính, Gen e2e khoá khi chưa lưu', () => {
  const ed = { testcases: [{ title: 'A <b>', steps: ['m1', 'm2'], expected: 'ok' }, { title: 'B', steps: [''], expected: '' }] };
  const html = liEditorHtml(ed, { identifier: 'D1-1', testcases: null });
  assert.equal((html.match(/class="tc-card"/g) ?? []).length, 2);
  assert.match(html, /TC 1[^]*TC 2/);
  assert.match(html, /2 testcase/);
  for (const f of ['title', 'steps', 'expected']) assert.equal((html.match(new RegExp(`data-f="${f}"`, 'g')) ?? []).length, 2);
  assert.match(html, /value="A &lt;b&gt;"/);
  assert.match(html, />m1\nm2<\/textarea>/);
  assert.match(html, /data-tc-del="1"/);
  assert.match(html, /class="primary" data-save/);
  assert.match(html, /data-gen disabled/);
  assert.doesNotMatch(liEditorHtml(ed, { identifier: 'D1-1', testcases: [{}] }), /data-gen disabled/);
});
