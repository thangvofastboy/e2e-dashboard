// Style người dùng chọn (Cài đặt hệ thống › Giao diện): lưu localStorage, gắn data-<key> lên <html>, mặc định thì bỏ
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const root = { dataset: {}, style: { setProperty() {} } };
globalThis.document = { documentElement: root, querySelectorAll: () => [] };
const { storedStyle, setStyle, applyPrefs, STYLE_KEYS } = await import('../ui/prefs.js');

test('mặc định: không có thuộc tính nào trên <html>', () => {
  assert.deepEqual(STYLE_KEYS, ['palette', 'accent', 'density', 'radius', 'chart']);
  assert.deepEqual(STYLE_KEYS.map(storedStyle), ['default', 'auto', 'normal', 'normal', 'auto']);
  applyPrefs();
  assert.deepEqual(root.dataset, {});
});

test('chọn style: gắn thuộc tính và lưu; chọn lại mặc định thì bỏ cả hai', () => {
  setStyle('palette', 'nord');
  setStyle('accent', 'violet');
  setStyle('density', 'compact');
  setStyle('radius', 'round');
  assert.deepEqual(root.dataset, { palette: 'nord', accent: 'violet', density: 'compact', radius: 'round' });
  assert.equal(store.get('e2ed-palette'), 'nord');
  setStyle('palette', 'default');
  assert.equal(root.dataset.palette, undefined);
  assert.equal(store.has('e2ed-palette'), false);
});

test('giá trị lạ bị bỏ qua; dữ liệu lưu hỏng thì về mặc định', () => {
  setStyle('accent', 'neon');
  assert.equal(root.dataset.accent, 'violet');
  setStyle('nope', 'x');
  store.set('e2ed-density', 'tiny');
  assert.equal(storedStyle('density'), 'normal');
});
