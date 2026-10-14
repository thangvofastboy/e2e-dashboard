import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconOnlyHtml } from '../ui/icon-only.js';
import { icon } from '../ui/icons.js';

const ic = icon('check', { size: 14 });

test('nút có icon: chữ vào .btn-label, data-tip là chữ đó', () => {
  const out = iconOnlyHtml(`<button type="button" data-x>${ic}Lưu</button>`);
  assert.equal(out, `<button type="button" data-x data-tip="Lưu">${ic}<span class="btn-label">Lưu</span></button>`);
});

test('giữ title cũ, gộp vào data-tip', () => {
  const out = iconOnlyHtml(`<button title="Ghi file">${ic}Lưu</button>`);
  assert.match(out, /title="Ghi file"/);
  assert.match(out, /data-tip="Lưu · Ghi file"/);
});

test('data-tip có sẵn được giữ, thêm tên nút phía trước', () => {
  const out = iconOnlyHtml(`<button data-tip="Quét lại ngay">${ic}Phân tích lại</button>`);
  assert.match(out, /data-tip="Phân tích lại · Quét lại ngay"/);
  assert.equal(out.match(/data-tip=/g).length, 1);
});

test('nút không có icon giữ nguyên', () => {
  const html = '<button type="button">Huỷ</button>';
  assert.equal(iconOnlyHtml(html), html);
});

test('chạy 2 lần không lồng span', () => {
  const once = iconOnlyHtml(`<button>${ic}Lưu</button>`);
  assert.equal(iconOnlyHtml(once), once);
});

test('số đếm cuối và phần tử con (badge) vẫn hiện', () => {
  const out = iconOnlyHtml(`<button>${ic}Chỉ test fail 2</button>`);
  assert.match(out, /<span class="btn-label">Chỉ test fail<\/span> <span class="btn-count">2<\/span>/);
  assert.match(out, /data-tip="Chỉ test fail 2"/);
  const b = iconOnlyHtml(`<button>${ic}Dự án<span class="sys-badge">3</span></button>`);
  assert.match(b, /<span class="btn-label">Dự án<\/span><span class="sys-badge">3<\/span>/);
});

test('a.button cũng được xử lý, a thường thì không; chữ có ký tự đặc biệt vẫn an toàn trong thuộc tính', () => {
  assert.match(iconOnlyHtml(`<a class="button" href="#">${ic}Xem PR</a>`), /data-tip="Xem PR"/);
  const plain = `<a href="#">${ic}Link</a>`;
  assert.equal(iconOnlyHtml(plain), plain);
  assert.match(iconOnlyHtml(`<button>${ic}A &quot;b&quot; &lt;c&gt;</button>`), /data-tip="A &quot;b&quot; &lt;c&gt;"/);
});

test('nút chỉ có icon (icon-btn) giữ nguyên', () => {
  const html = `<button class="icon-btn" aria-label="Đóng">${ic}</button>`;
  assert.equal(iconOnlyHtml(html), html);
});

test('chip / badge / tag dạng <button> là nhãn trạng thái: giữ nguyên chữ', () => {
  const chip = '<button type="button" class="chip tone-bad" data-tip="x"><svg class="icon ic-x"></svg>Có vấn đề</button>';
  assert.equal(iconOnlyHtml(chip), chip);
  assert.equal(iconOnlyHtml('<a class="button tag" href="#"><svg class="icon ic-x"></svg>@smoke</a>'), '<a class="button tag" href="#"><svg class="icon ic-x"></svg>@smoke</a>');
});
