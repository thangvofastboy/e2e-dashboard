// Đối chiếu cây Tests (dựng từ lịch sử run) với mã test hiện tại trên đĩa, để sửa file test là thấy ngay, không phải
// Reset dữ liệu: test mới / đổi tên hiện ra (chưa chạy), test đã xoá khỏi mã ẩn đi, số dòng theo mã mới (nút Chạy
// chạy đúng test). Tiêu đề lấy bằng regex `test('…')`, mỗi file nhớ theo mtime + size.
// ponytail: regex, không chạy `e2e list` (import file test có thể có side effect); describe lồng chỉ so theo tên test
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';

const SKIP = new Set(['node_modules', '.git', '.e2e', '.e2e-dashboard', 'dist', 'build']);
const CASE = /^[ \t]*test(?:\.(?:only|skip|fixme))?\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/gm;
const isPw = (src) => /from\s+['"]@playwright\/test['"]/.test(src);
const fileCache = new Map(); // đường dẫn tuyệt đối → { mtimeMs, size, tests, dynamic, skip }

async function parseFile(full, file, e2e) {
  const st = await stat(full).catch(() => null);
  if (!st || st.size > 300_000) return null;
  const hit = fileCache.get(full);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
  const src = await readFile(full, 'utf8').catch(() => '');
  const entry = { mtimeMs: st.mtimeMs, size: st.size, tests: [], dynamic: false, skip: !e2e && !isPw(src) }; // *.test.ts của vitest / jest: bỏ
  if (!entry.skip) {
    for (const m of src.matchAll(CASE)) {
      // tiêu đề có `${…}`: không so được với tên lúc chạy → file này không ẩn test nào của lịch sử
      if (m[1] === '`' && m[2].includes('${')) entry.dynamic = true;
      entry.tests.push({ file, title: m[2].replace(/\\(.)/g, '$1'), line: src.slice(0, m.index).split('\n').length, runner: e2e ? 'e2e' : 'playwright' });
    }
  }
  if (fileCache.size > 5000) fileCache.clear();
  fileCache.set(full, entry);
  return entry;
}

// { tests: { file, title, line, runner }[], files: Map<file, { dynamic }> } — file tương đối với project, '/'
export async function discoverTests(root, testDir = '', { limit = 3000 } = {}) {
  const base = testDir ? resolve(root, testDir) : root;
  const rel = relative(root, base);
  const tests = [];
  const files = new Map();
  if (rel.startsWith('..') || isAbsolute(rel)) return { tests, files }; // thư mục test ngoài project: runner không chạy được từ đây
  const walk = async (dir, depth) => {
    if (depth > 8 || tests.length >= limit) return;
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (tests.length >= limit) return;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && !e.name.startsWith('.')) await walk(full, depth + 1);
        continue;
      }
      if (!e.isFile() || !/\.m?ts$/.test(e.name) || /\.d\.m?ts$/.test(e.name)) continue;
      const e2e = /\.e2e\.m?ts$/.test(e.name);
      if (!e2e && !/\.(?:spec|test)\.m?ts$/.test(e.name)) continue; // helper .ts thường: bỏ, khỏi đọc
      const file = relative(root, full).split('\\').join('/');
      const entry = await parseFile(full, file, e2e);
      if (!entry || entry.skip) continue;
      files.set(file, { dynamic: entry.dynamic });
      tests.push(...entry.tests);
    }
  };
  await walk(base, 0);
  return { tests, files };
}

const leaf = (title) => String(title).split(' › ').pop();
const unrunRow = (t) => ({ key: `unrun:${t.file}:${t.line}`, title: t.title, file: t.file, line: t.line, tags: [], target: '', agent: '', history: [], avgDurationMs: null, unrun: true, runner: t.runner });

// rows: bảng lịch sử (historyTable). Trả bảng đã khớp với mã hiện tại:
// - file đã quét: số dòng theo mã mới; test không còn trong mã thì bỏ (trừ file có tiêu đề động); test mới thêm (chưa chạy)
// - file không còn trên đĩa: bỏ; file ngoài thư mục test (không quét): giữ nguyên
// addUnrun: thêm test có trong mã mà chưa có trong lịch sử (trang Tests, chọn test của lịch); Overview không thêm
export function reconcile(rows, found, root, { addUnrun = true } = {}) {
  const byFile = new Map();
  for (const t of found.tests) byFile.set(t.file, [...(byFile.get(t.file) ?? []), t]);
  const out = [];
  const seen = new Map(); // file → tên test đã có trong lịch sử
  for (const r of rows) {
    const scanned = found.files.get(r.file);
    if (!scanned) {
      if (root && r.file && !existsSync(join(root, r.file))) continue; // file đã xoá
      out.push(r);
      continue;
    }
    const name = leaf(r.title);
    const matches = (byFile.get(r.file) ?? []).filter((t) => t.title === name);
    if (!matches.length && !scanned.dynamic) continue; // đã xoá / đổi tên trong mã
    if (!seen.has(r.file)) seen.set(r.file, new Set());
    seen.get(r.file).add(name);
    out.push(matches.length === 1 && matches[0].line !== r.line ? { ...r, line: matches[0].line } : r);
  }
  for (const t of addUnrun ? found.tests : []) {
    const known = seen.get(t.file);
    if (known?.has(t.title) || (known && t.title.includes('${'))) continue; // tiêu đề động đã chạy: lịch sử có tên thật
    out.push(unrunRow(t));
  }
  return out;
}
