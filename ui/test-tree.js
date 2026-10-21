import { isFailed } from './model.js';

// Loại file test (ô lọc ở trang Tests). Khớp đúng luật của server: *.e2e.* đi qua e2e, *.spec.* đi qua Playwright.
export const TEST_KINDS = [['e2e', '.e2e.ts'], ['spec', '.spec.ts / .test.ts'], ['all', 'Tất cả']];
export function testKind(file) {
  if (/\.e2e\.[cm]?[jt]sx?$/.test(file)) return 'e2e';
  if (/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file)) return 'spec';
  return 'other';
}
export const matchesKind = (file, kind) => kind === 'all' || testKind(file) === kind;

// Cây thư mục từ `file` của từng test (tách theo / và \). Node: { name, path, children, tests, count, failCount };
// node có tests là file, test không có file nằm ở gốc. Dùng chung cho trang /tests và ô chọn test (test-picker.js).
export function buildTree(rows, isFail = (r) => isFailed(r.history?.[0]?.status)) {
  const mk = (name, path) => ({ name, path, children: [], tests: [], count: 0, failCount: 0 });
  const root = mk('', '');
  for (const r of rows) {
    const fail = isFail(r) ? 1 : 0;
    let node = root;
    node.count += 1;
    node.failCount += fail;
    const parts = String(r.file ?? '').split(/[\\/]+/).filter(Boolean);
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/');
      let child = node.children.find((c) => c.name === name);
      if (!child) node.children.push((child = mk(name, path)));
      node = child;
      node.count += 1;
      node.failCount += fail;
    });
    node.tests.push(r);
  }
  // thư mục trước file, rồi theo tên
  const isDir = (n) => n.children.length > 0;
  const sort = (n) => {
    n.children.sort((a, b) => isDir(b) - isDir(a) || a.name.localeCompare(b.name));
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}

// mọi test nằm dưới một node (chọn cả thư mục)
export const treeTests = (node) => (node ? [...node.tests, ...node.children.flatMap(treeTests)] : []);

export function findNode(node, path) {
  if (node.path === path) return node;
  for (const c of node.children) {
    if (path === c.path || path.startsWith(`${c.path}/`)) return findNode(c, path);
  }
  return null;
}
