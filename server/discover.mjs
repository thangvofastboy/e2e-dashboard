// Test có trong mã nhưng chưa chạy lần nào: trang Tests vốn dựng cây từ lịch sử run, nên file test mới (hoặc file
// Playwright *.spec.ts chưa chạy) không hiện. Quét file test trên đĩa (trong thư mục test của project nếu đã đặt),
// lấy tiêu đề `test('…')` bằng regex; chỉ bổ sung file chưa có trong lịch sử (lịch sử vẫn là nguồn đúng nhất).
// ponytail: regex, không chạy `e2e list` (import file test có thể có side effect); describe lồng / tiêu đề động bỏ qua
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute } from 'node:path';

const SKIP = new Set(['node_modules', '.git', '.e2e', '.e2e-dashboard', 'dist', 'build']);
const CASE = /^[ \t]*test(?:\.(?:only|skip|fixme))?\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/gm;
const isPw = (src) => /from\s+['"]@playwright\/test['"]/.test(src);

// { file, title, line, runner }[] — file tương đối với project, '/'
export async function discoverTests(root, testDir = '', { limit = 3000 } = {}) {
  const base = testDir ? resolve(root, testDir) : root;
  const rel = relative(root, base);
  if (rel.startsWith('..') || isAbsolute(rel)) return []; // thư mục test ngoài project: runner không chạy được từ đây
  const out = [];
  const walk = async (dir, depth) => {
    if (depth > 8 || out.length >= limit) return;
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (out.length >= limit) return;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && !e.name.startsWith('.')) await walk(full, depth + 1);
        continue;
      }
      if (!e.isFile() || !/\.m?ts$/.test(e.name) || /\.d\.m?ts$/.test(e.name)) continue;
      const e2e = /\.e2e\.m?ts$/.test(e.name);
      if (!e2e && !/\.(?:spec|test)\.m?ts$/.test(e.name)) continue; // helper .ts thường: bỏ, khỏi đọc
      if ((await stat(full).catch(() => null))?.size > 300_000) continue;
      const src = await readFile(full, 'utf8').catch(() => '');
      if (!e2e && !isPw(src)) continue; // *.test.ts của vitest / jest: không phải test e2e
      const file = relative(root, full).split('\\').join('/');
      for (const m of src.matchAll(CASE)) {
        out.push({ file, title: m[2].replace(/\\(.)/g, '$1'), line: src.slice(0, m.index).split('\n').length, runner: e2e ? 'e2e' : 'playwright' });
      }
    }
  };
  await walk(base, 0);
  return out;
}

// thêm test chưa chạy vào bảng lịch sử (dạng historyTable): chỉ file chưa có dòng nào trong lịch sử
export function withUnrun(rows, found) {
  const known = new Set(rows.map((r) => r.file));
  const extra = found.filter((t) => !known.has(t.file)).map((t) => ({
    key: `unrun:${t.file}:${t.line}`, title: t.title, file: t.file, line: t.line, tags: [], target: '', agent: '', history: [], avgDurationMs: null, unrun: true, runner: t.runner,
  }));
  return extra.length ? [...rows, ...extra] : rows;
}
