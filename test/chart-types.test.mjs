// Loại chart chuỗi thời gian: đường / vùng / cột / bậc; chọn trên chart > cài đặt chung > thiết kế của chart
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.document = { documentElement: { dataset: {}, style: { setProperty() {} } }, addEventListener() {} }; // setStyle gắn data-* lên <html>
const { lineChart } = await import('../ui/charts.js');
const { setStyle, setChartType } = await import('../ui/prefs.js');

const points = [{ label: 'a', value: 10 }, { label: 'b', value: null }, { label: 'c', value: 30 }, { label: 'd', value: 20 }];
const pressed = (html) => /data-chart-type="(\w+)" aria-pressed="true"/.exec(html)?.[1];

test('mỗi loại vẽ đúng mark; null để trống', () => {
  const bar = lineChart({ points, type: 'bar' });
  assert.equal((bar.match(/class="bar series-1"/g) ?? []).length, 3); // 4 điểm, 1 null
  assert.doesNotMatch(bar, /class="line|class="dot/);
  assert.match(lineChart({ points, type: 'step' }), /class="line series-1"[^>]*d="M[\d.]+,[\d.]+H[\d.]+V[\d.]+/);
  assert.match(lineChart({ points, type: 'area' }), /class="area"/);
  assert.doesNotMatch(lineChart({ points, type: 'line' }), /class="area"/);
});

test('thứ tự ưu tiên: trên chart > chung > thiết kế (area)', () => {
  assert.equal(pressed(lineChart({ points, ariaLabel: 'X', area: true })), 'area');
  assert.equal(pressed(lineChart({ points, ariaLabel: 'X' })), 'line');
  setStyle('chart', 'bar');
  assert.equal(pressed(lineChart({ points, ariaLabel: 'X', area: true })), 'bar');
  setChartType('X', 'step');
  assert.equal(pressed(lineChart({ points, ariaLabel: 'X', area: true })), 'step');
  assert.equal(pressed(lineChart({ points, ariaLabel: 'Y', area: true })), 'bar'); // chart khác không bị ảnh hưởng
  setChartType('X', 'pie'); // loại lạ bỏ qua
  assert.equal(pressed(lineChart({ points, ariaLabel: 'X' })), 'step');
  setChartType('X', null); // chọn lại loại mặc định trên chart: bỏ nhớ riêng, theo cài đặt chung
  assert.equal(pressed(lineChart({ points, ariaLabel: 'X' })), 'bar');
});

test('không có tên chart thì không có thanh chọn; không có dữ liệu thì báo trống', () => {
  assert.doesNotMatch(lineChart({ points }), /chart-type/);
  assert.match(lineChart({ points: [] }), /Chưa có dữ liệu/);
});
