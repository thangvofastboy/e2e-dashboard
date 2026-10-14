import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, treeTests, findNode } from '../ui/test-tree.js';

const row = (file, key, status = 'passed') => ({ file, key, title: key, history: status ? [{ status }] : [] });

test('buildTree gom test theo thư mục lồng nhau, đếm test và test fail', () => {
  const t = buildTree([
    row('tests/checkout/cart.e2e.ts', 'a', 'failed'),
    row('tests/checkout/cart.e2e.ts', 'b'),
    row('tests/login.e2e.ts', 'c'),
  ]);
  assert.equal(t.count, 3);
  assert.equal(t.failCount, 1);
  const [tests] = t.children;
  assert.equal(tests.name, 'tests');
  assert.equal(tests.path, 'tests');
  const checkout = tests.children[0];
  assert.deepEqual([checkout.name, checkout.path, checkout.count, checkout.failCount], ['checkout', 'tests/checkout', 2, 1]);
  const cart = checkout.children[0];
  assert.deepEqual([cart.name, cart.path, cart.children.length], ['cart.e2e.ts', 'tests/checkout/cart.e2e.ts', 0]);
  assert.deepEqual(cart.tests.map((x) => x.key), ['a', 'b']);
});

test('buildTree hiểu đường dẫn Windows có dấu \\', () => {
  const t = buildTree([row('tests\\api\\users.e2e.ts', 'a'), row('tests/api/users.e2e.ts', 'b')]);
  const users = t.children[0].children[0].children[0];
  assert.equal(users.path, 'tests/api/users.e2e.ts');
  assert.equal(users.tests.length, 2);
});

test('buildTree sắp thư mục trước file, rồi theo tên', () => {
  const t = buildTree([row('z.e2e.ts', 'a'), row('b/x.e2e.ts', 'b'), row('a.e2e.ts', 'c'), row('c/y.e2e.ts', 'd')]);
  assert.deepEqual(t.children.map((n) => n.name), ['b', 'c', 'a.e2e.ts', 'z.e2e.ts']);
});

test('test không có file nằm ở gốc; hàm isFail tùy chọn', () => {
  const t = buildTree([{ key: 'x', title: 'x' }, row('a.e2e.ts', 'y')], (r) => r.key === 'x');
  assert.deepEqual(t.tests.map((x) => x.key), ['x']);
  assert.equal(t.failCount, 1);
});

test('fileSummary: pass rate, thời gian TB, trạng thái gần nhất ưu tiên fail', async () => {
  const { fileSummary } = await import('../ui/views/tests.js');
  const s = fileSummary([
    { avgDurationMs: 1000, history: [{ status: 'passed' }, { status: 'failed' }] },
    { avgDurationMs: 3000, history: [{ status: 'failed' }, { status: 'skipped' }] },
  ]);
  assert.deepEqual(s, { passRate: 33, avgMs: 2000, status: 'failed' });
  assert.deepEqual(fileSummary([{ history: [] }]), { passRate: null, avgMs: null, status: null });
});

test('reviewFormHtml chọn sẵn model / effort theo Settings', async () => {
  const { reviewFormHtml } = await import('../ui/views/test-quality.js');
  const html = reviewFormHtml({ model: 'opus', effort: 'high' });
  assert.match(html, /<option value="opus" selected>/);
  assert.match(html, /<option value="high" selected>/);
  assert.match(html, /<option value="xhigh">/);
  assert.match(reviewFormHtml(), /<option value="" selected>mặc định/);
});

test('chọn thư mục → lấy đủ test con ở mọi cấp', () => {
  const t = buildTree([row('a/b/c.e2e.ts', '1'), row('a/d.e2e.ts', '2'), row('e.e2e.ts', '3')]);
  assert.deepEqual(treeTests(findNode(t, 'a')).map((x) => x.key).sort(), ['1', '2']);
  assert.equal(findNode(t, 'nope'), null);
});
