// Trang Record: HTML theo từng trạng thái, route #/record, và bundle UI vẫn hợp lệ (một scope, không trùng tên).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { recordViewHtml } from '../ui/views/record.js';
import { parseRoute } from '../ui/router.js';
import { bundleUi } from '../ui/bundle.mjs';

const UI = fileURLToPath(new URL('../ui', import.meta.url));
const idle = { state: 'idle', canRecord: true, reason: null };

test('recordViewHtml: máy không ghi được thì nút Record bị khoá và hiện lý do', () => {
  const html = recordViewHtml({ status: { state: 'idle', canRecord: false, reason: 'Cần máy có màn hình <x>' }, editing: null, saved: null });
  assert.match(html, /data-rec-start[^>]*disabled/);
  assert.match(html, /Cần máy có màn hình &lt;x&gt;/);
});

test('recordViewHtml: máy ghi được thì có form url + tên và nút Record bật', () => {
  const html = recordViewHtml({ status: idle, editing: null, saved: null });
  assert.match(html, /data-rec-url/);
  assert.match(html, /data-rec-name-new/);
  assert.doesNotMatch(html, /data-rec-start[^>]*disabled/);
});

test('recordViewHtml: đang ghi thì có nút Dừng, không có form', () => {
  const html = recordViewHtml({ status: { ...idle, state: 'recording', name: 'Đăng nhập', url: 'https://a.test/' }, editing: null, saved: null });
  assert.match(html, /data-rec-stop/);
  assert.doesNotMatch(html, /data-rec-start/);
  assert.match(html, /Đăng nhập/);
});

test('recordViewHtml: failed hiện lỗi đã escape và vẫn cho ghi lại', () => {
  const html = recordViewHtml({ status: { ...idle, state: 'failed', error: 'boom <script>' }, editing: null, saved: null });
  assert.match(html, /boom &lt;script&gt;/);
  assert.match(html, /data-rec-start/);
});

test('recordViewHtml: editing dùng thẻ testcase dùng chung, escape nội dung, hiện aiError và danh sách bí mật', () => {
  const editing = { name: 'Đăng nhập', url: 'https://a.test/', slug: 'dang-nhap', secrets: ['E2E_SECRET_1'], aiError: 'AI không trả lời', testcases: [{ title: 'A <b>', steps: ['m1', 'm2'], expected: 'ok' }] };
  const html = recordViewHtml({ status: { ...idle, state: 'done' }, editing, saved: null });
  for (const f of ['title', 'steps', 'expected']) assert.equal((html.match(new RegExp(`data-f="${f}"`, 'g')) ?? []).length, 1);
  assert.match(html, /value="A &lt;b&gt;"/);
  assert.match(html, /AI không trả lời/);
  assert.match(html, /E2E_SECRET_1/);
  assert.match(html, /data-rec-save/);
  assert.match(html, /data-rec-name/);
  assert.doesNotMatch(html, /data-gen-e2e/);
});

test('recordViewHtml: editing không có aiError thì không hiện cảnh báo AI', () => {
  const editing = { name: 'a', url: 'u', slug: 'a', secrets: [], testcases: [{ title: 't', steps: ['s'], expected: 'e' }] };
  assert.doesNotMatch(recordViewHtml({ status: idle, editing, saved: null }), /data-rec-ai-error/);
});

test('recordViewHtml: saved hiện đường dẫn, biến bí mật kèm hướng dẫn .env và nút AI Gen e2e', () => {
  const saved = { specPath: 'tests/recorded/a.spec.ts', casesPath: 'tests/recorded/a.cases.json', secrets: ['E2E_SECRET_1'], slug: 'a', e2ePath: null };
  const html = recordViewHtml({ status: idle, editing: null, saved });
  assert.match(html, /tests\/recorded\/a\.spec\.ts/);
  assert.match(html, /E2E_SECRET_1/);
  assert.match(html, /\.env/);
  assert.match(html, /data-gen-e2e/);
  assert.doesNotMatch(recordViewHtml({ status: idle, editing: null, saved: { ...saved, e2ePath: 'tests/recorded/a.e2e.ts' } }), /data-gen-e2e/);
  assert.doesNotMatch(recordViewHtml({ status: idle, editing: null, saved: null }), /data-gen-e2e/);
});

test('route #/record có trang riêng', () => {
  assert.equal(parseRoute('#/record').view, 'record');
});

test('bundle UI có renderRecord và vẫn là một script hợp lệ (không khai báo trùng tên)', async () => {
  const code = await bundleUi(UI);
  assert.match(code, /function renderRecord/);
  assert.doesNotThrow(() => new Function(code));
});

test('Record theo style của web: textarea có style riêng, tab chọn đọc được, không dùng .form-row (nút bị rút thành icon)', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(fileURLToPath(new URL('../ui/style.css', import.meta.url)), 'utf8');
  assert.match(css, /\.rec-field textarea \{[^}]*border: 1px solid var\(--border\)[^}]*border-radius: 10px/, 'textarea theo khuôn .fb-field');
  assert.match(css, /\.rec-field input:focus-visible, \.rec-field textarea:focus-visible \{[^}]*box-shadow/, 'có trạng thái focus');
  assert.match(css, /\.rec-new \.seg-btns \[role="tab"\]\[aria-selected="true"\][^{]*\{ color: var\(--info-ink\)/, 'tab chọn: chữ info-ink trên nền info-bg');
  const html = recordViewHtml({ status: { state: 'idle', canRecord: true, reason: null }, editing: null, saved: null, auth: [{ name: 'a', savedAt: '2026-10-19T07:00:00.000Z' }] });
  assert.doesNotMatch(html, /form-row/);
  assert.doesNotMatch(html, /<select/, 'chọn phiên bằng nút, không dùng select mặc định');
});
