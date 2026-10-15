// Ẩn mục menu (Cài đặt hệ thống → Giao diện): lưu localStorage, Overview / Cài đặt hệ thống không ẩn được.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const links = ['overview', 'models', 'lint', 'system'].map((v) => ({ dataset: { nav: v }, hidden: false }));
const sec = { hidden: false, querySelector: () => (links.slice(1, 3).some((a) => !a.hidden) ? {} : null) };
globalThis.document = { querySelectorAll: (q) => (q.includes('nav-sec') ? [sec] : links) };
const { storedHiddenNav, setNavHidden } = await import('../ui/prefs.js');

test('mặc định ẩn 4 trang phân tích, chưa lưu gì thì dùng mặc định', () => {
  assert.deepEqual([...storedHiddenNav()], ['cost', 'models', 'locators', 'lint']);
});

test('ẩn / hiện mục menu, nhóm ẩn hết thì ẩn tiêu đề', () => {
  store.set('e2ed-nav-hidden', '[]');
  setNavHidden('models', true);
  setNavHidden('lint', true);
  setNavHidden('overview', true); // khoá: không ẩn
  assert.deepEqual([...storedHiddenNav()], ['models', 'lint']);
  assert.deepEqual(links.map((a) => a.hidden), [false, true, true, false]);
  assert.equal(sec.hidden, true);
  setNavHidden('lint', false);
  assert.deepEqual(links.map((a) => a.hidden), [false, true, false, false]);
  assert.equal(sec.hidden, false);
  setNavHidden('models', false);
  assert.equal(store.get('e2ed-nav-hidden'), '[]'); // hết mục ẩn vẫn lưu [], không quay lại mặc định
  assert.equal(storedHiddenNav().size, 0);
  store.set('e2ed-nav-hidden', '{bad');
  assert.equal(storedHiddenNav().size, 0); // dữ liệu hỏng → không ẩn gì
});
