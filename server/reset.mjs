// Reset All: xoá cài đặt và/hoặc dữ liệu của dashboard. Không hoàn tác, không sao lưu.
// Chỉ xoá đúng các tên trong danh sách dưới đây trong <project>/.e2e-dashboard (không glob, không đi qua symlink),
// và tuỳ chọn file cấu hình chung của máy. Không bao giờ đụng vào file của project hay thư mục kết quả .e2e.
import { rm, lstat, readdir } from 'node:fs/promises';
import { join, dirname, relative, sep } from 'node:path';
import { DATA_DIR, dataPath, legacyDataPath, isLink, listRunDirs } from '../reporter/e2e-dashboard.reporter.mjs';
import { homeDir } from './projects.mjs';

export const SCOPES = ['settings', 'data', 'global'];

// cài đặt: file người dùng đặt hoặc sửa tay
const SETTINGS = { files: ['settings.json', 'alerts.json', 'ci-sync.json', 'coverage-ignore.json', 'qc-templates.json', 'config.json'], dirs: [] };
// dữ liệu: lịch sử chạy và mọi thứ sinh ra từ nó
const DATA = { files: ['triage.json', 'issues.json', 'events.json', 'quarantine.json', 'qc-notes.json', 'qc-manual.json'], dirs: ['runs', 'exports', 'longterm', 'cache'] };

const MAX_WALK = 200_000;

export async function sizeOf(path) {
  let bytes = 0;
  let seen = 0;
  const walk = async (p) => {
    const st = await lstat(p).catch(() => null);
    if (!st || st.isSymbolicLink() || seen++ > MAX_WALK) return;
    if (st.isDirectory()) for (const e of await readdir(p).catch(() => [])) await walk(join(p, e));
    else bytes += st.size;
  };
  await walk(path);
  return bytes;
}

// Every directory from <root>/.e2e-dashboard down to the target's parent must be a real directory: a repo can plant
// `.e2e-dashboard/state -> ~/` and a check on the leaf alone would delete files there.
export function underRealDirs(root, path) {
  const dataDir = join(root, DATA_DIR);
  if (isLink(dataDir)) return false;
  let cur = dataDir;
  for (const part of relative(dataDir, dirname(path)).split(sep).filter(Boolean)) {
    cur = join(cur, part);
    if (isLink(cur)) return false;
  }
  return true;
}

// Every place a name can live: the current layout (state/…) and the pre-0.8.8 one (.e2e-dashboard/…).
const locations = (root, name) => [...new Set([dataPath(root, name), legacyDataPath(root, name)])];

async function inspect(root, name, kind) {
  const found = [];
  for (const path of locations(root, name)) {
    const st = await lstat(path).catch(() => null);
    if (!st) continue;
    const linked = st.isSymbolicLink() || !underRealDirs(root, path);
    found.push({ name, kind, path, symlink: linked, bytes: linked ? 0 : await sizeOf(path) });
  }
  return found;
}

async function targets(root, scope) {
  const spec = scope === 'settings' ? SETTINGS : DATA;
  const out = [];
  for (const f of spec.files) out.push(...(await inspect(root, f, 'file')));
  for (const d of spec.dirs) out.push(...(await inspect(root, d, 'dir')));
  return out;
}

const globalFile = (env) => join(homeDir(env), 'config.json');

// What a reset would remove, for the confirmation dialog. Nothing is changed.
export async function resetPreview(root, { env = process.env } = {}) {
  const blocked = isLink(join(root, DATA_DIR));
  const [settings, data] = blocked ? [[], []] : await Promise.all([targets(root, 'settings'), targets(root, 'data')]);
  const g = await lstat(globalFile(env)).catch(() => null);
  const sum = (items) => items.reduce((n, x) => n + x.bytes, 0);
  return {
    blocked,
    settings: { items: settings.map(({ name, kind, bytes, symlink }) => ({ name, kind, bytes, symlink })), bytes: sum(settings) },
    data: { items: data.map(({ name, kind, bytes, symlink }) => ({ name, kind, bytes, symlink })), bytes: sum(data), runs: blocked ? 0 : (await listRunDirs(join(root, DATA_DIR, 'runs'), { sort: false })).length },
    global: { exists: Boolean(g), file: g ? globalFile(env) : null },
  };
}

// scopes: any of 'settings' | 'data' | 'global'. A symlink is never followed or removed: it is reported as skipped.
export async function resetAll(root, scopes, { env = process.env } = {}) {
  if (!Array.isArray(scopes) || !scopes.length || !scopes.every((s) => SCOPES.includes(s))) throw new Error('scopes phải là settings, data hoặc global');
  const removed = [];
  const skipped = [];
  if (isLink(join(root, DATA_DIR))) throw new Error('.e2e-dashboard là symlink: từ chối xoá');
  for (const scope of scopes.filter((s) => s !== 'global')) {
    for (const t of await targets(root, scope)) {
      if (t.symlink || !underRealDirs(root, t.path)) { // checked again just before deleting
        skipped.push({ path: t.path, why: 'symlink' });
        continue;
      }
      await rm(t.path, { recursive: t.kind === 'dir', force: true });
      removed.push({ scope, name: t.name, bytes: t.bytes });
    }
  }
  if (scopes.includes('global')) {
    const f = globalFile(env);
    const st = await lstat(f).catch(() => null);
    if (st?.isFile()) {
      await rm(f, { force: true });
      removed.push({ scope: 'global', name: 'config.json', bytes: st.size });
    } else if (st) skipped.push({ path: f, why: 'không phải file thường' });
  }
  return { removed, skipped };
}
