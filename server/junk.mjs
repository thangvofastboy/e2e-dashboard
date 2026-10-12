// Dọn rác: những thứ dashboard (hoặc một lần chạy bị ngắt) để lại mà không ai dùng nữa.
// Chỉ 6 nhóm cố định, quét lại ở server mỗi lần dọn (client chỉ gửi tên nhóm, không bao giờ gửi đường dẫn),
// mọi thứ phải cũ hơn ngưỡng (không đụng vào file đang ghi) và không đi qua symlink.
import { rm, lstat, readdir, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DATA_DIR, dataPath, isLink, listRunDirs, readConfig } from '../reporter/e2e-dashboard.reporter.mjs';
import { sizeOf, underRealDirs } from './reset.mjs';
import { listCache, clearCache } from './replaycache.mjs';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LOG_MAX = 1024 * 1024;
const TEMP = /^(?:\.tmp-[0-9a-f]{8,12}|.+\.tmp-[0-9a-f]{8,12})$/; // jsonstate / archive / export write to a temp name, then rename
const OS_TMP = /^e2ed-gh-[A-Za-z0-9]{6}$/; // `gh run download` target of an import that was interrupted

export const JUNK = {
  'temp-files': ['Ghi dở', 'File và thư mục .tmp-* trong .e2e-dashboard do lần ghi bị ngắt (cũ hơn 1 giờ)'],
  'broken-runs': ['Run lưu thiếu file', 'Thư mục run không có meta.json hoặc report.json nên không mở được (cũ hơn 1 giờ)'],
  logs: ['Log', 'server.log lớn hơn 1 MB (thu về rỗng) và file crash của tự sửa lỗi'],
  exports: ['Báo cáo đã xuất', 'File HTML trong exports/ cũ hơn 7 ngày'],
  'replay-cache': ['Replay cache cũ', 'Bản ghi của test không còn tồn tại hoặc cũ hơn 30 ngày'],
  'os-tmp': ['Thư mục tạm nhập từ GitHub', 'e2ed-gh-* trong thư mục tạm của hệ điều hành (cũ hơn 1 giờ)'],
};

const age = (st, now) => now - st.mtimeMs;
const ownedByMe = (st) => typeof process.getuid !== 'function' || st.uid === process.getuid();

async function entries(dir) {
  return (await readdir(dir, { withFileTypes: true }).catch(() => [])).map((e) => e.name);
}

// Each scanner returns [{ path, bytes, how: 'rm' | 'truncate', cache?: id }]
const SCANNERS = {
  async 'temp-files'(root, { now }) {
    const out = [];
    const base = join(root, DATA_DIR);
    for (const sub of ['', 'runs', 'exports', 'state', 'runtime']) {
      const dir = sub ? join(base, sub) : base;
      if (!underRealDirs(root, join(dir, 'x'))) continue;
      for (const name of (await entries(dir)).filter((n) => TEMP.test(n))) {
        const path = join(dir, name);
        const st = await lstat(path).catch(() => null);
        if (!st || st.isSymbolicLink() || age(st, now) < HOUR) continue;
        out.push({ path, bytes: await sizeOf(path), how: 'rm' });
      }
    }
    return out;
  },

  async 'broken-runs'(root, { now }) {
    const out = [];
    const runs = join(root, DATA_DIR, 'runs');
    if (isLink(join(root, DATA_DIR)) || isLink(runs)) return out;
    for (const rel of await listRunDirs(runs, { sort: false })) {
      const path = join(runs, rel);
      if (!underRealDirs(root, path)) continue;
      const st = await lstat(path).catch(() => null);
      if (!st?.isDirectory() || st.isSymbolicLink() || age(st, now) < HOUR) continue;
      const has = async (f) => (await lstat(join(path, f)).catch(() => null))?.isFile() === true;
      if ((await has('meta.json')) && (await has('report.json'))) continue;
      out.push({ path, bytes: await sizeOf(path), how: 'rm' });
    }
    return out;
  },

  async logs(root) {
    const out = [];
    const log = dataPath(root, 'server.log');
    const st = await lstat(log).catch(() => null);
    // the running server keeps this file open for appending: truncate it, do not delete it
    if (st?.isFile() && st.size > LOG_MAX && underRealDirs(root, log)) out.push({ path: log, bytes: st.size, how: 'truncate' });
    const crash = dataPath(root, 'selfheal-crash.jsonl');
    const cs = await lstat(crash).catch(() => null);
    if (cs?.isFile() && underRealDirs(root, crash)) out.push({ path: crash, bytes: cs.size, how: 'rm' });
    return out;
  },

  async exports(root, { now }) {
    const out = [];
    const dir = join(root, DATA_DIR, 'exports');
    if (!underRealDirs(root, join(dir, 'x'))) return out;
    for (const name of (await entries(dir)).filter((n) => /\.html$/.test(n))) {
      const path = join(dir, name);
      const st = await lstat(path).catch(() => null);
      if (st?.isFile() && age(st, now) > 7 * DAY) out.push({ path, bytes: st.size, how: 'rm' });
    }
    return out;
  },

  async 'replay-cache'(root, { testIds, now }) {
    const c = await listCache(root, { cfg: readConfig(root), testIds, now });
    return c.entries.filter((e) => e.stale || e.orphan).map((e) => ({ path: `${c.dir}/${e.id}.json`, bytes: e.bytes, how: 'cache', cache: e.id }));
  },

  async 'os-tmp'(_root, { now }) {
    const out = [];
    const base = resolve(tmpdir());
    for (const name of (await entries(base)).filter((n) => OS_TMP.test(n))) {
      const path = join(base, name);
      const st = await lstat(path).catch(() => null);
      if (st?.isDirectory() && !st.isSymbolicLink() && ownedByMe(st) && age(st, now) > HOUR) out.push({ path, bytes: await sizeOf(path), how: 'rm' });
    }
    return out;
  },
};

// testIds: ids of the tests of the newest run (cache entries of any other test are orphans), or null
export async function scanJunk(root, { now = Date.now(), testIds = null } = {}) {
  const categories = [];
  for (const [id, [label, desc]] of Object.entries(JUNK)) {
    const items = await SCANNERS[id](root, { now, testIds }).catch(() => []);
    categories.push({ id, label, desc, count: items.length, bytes: items.reduce((n, x) => n + x.bytes, 0), sample: items.slice(0, 3).map((x) => x.path.split('/').pop()) });
  }
  return { categories, bytes: categories.reduce((n, c) => n + c.bytes, 0) };
}

// ids: category names. Returns what was removed per category.
export async function cleanJunk(root, ids, { now = Date.now(), testIds = null } = {}) {
  if (!Array.isArray(ids) || !ids.length || !ids.every((i) => Object.hasOwn(JUNK, i))) throw new Error('nhóm rác không hợp lệ');
  const removed = {};
  for (const id of new Set(ids)) {
    const items = await SCANNERS[id](root, { now, testIds });
    let bytes = 0;
    let count = 0;
    const cacheIds = [];
    for (const it of items) {
      if (it.how === 'cache') {
        cacheIds.push(it.cache);
        bytes += it.bytes;
        count++;
      } else if (it.how === 'truncate') {
        await truncate(it.path, 0);
        bytes += it.bytes;
        count++;
      } else {
        await rm(it.path, { recursive: true, force: true });
        bytes += it.bytes;
        count++;
      }
    }
    if (cacheIds.length) await clearCache(root, { ids: cacheIds });
    removed[id] = { count, bytes };
  }
  return { removed, freed: Object.values(removed).reduce((n, x) => n + x.bytes, 0) };
}
