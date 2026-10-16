// Every project that has opened a dashboard, in one per-user registry (~/.e2e-dashboard/projects.json),
// so one dashboard can show them all. The registry lives in the user's home, never in a repo.
import { readFile, writeFile, mkdir, rename, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, basename, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readServerInfo } from '../reporter/e2e-dashboard.reporter.mjs';
import { listRuns } from './store.mjs';
import { healthScore, passRate } from '../ui/health.js';
import { serial } from './jsonstate.mjs';

export const homeDir = (env = process.env) => resolve(env.E2E_DASHBOARD_HOME || join(homedir(), '.e2e-dashboard'));
const registryPath = (env) => join(homeDir(env), 'projects.json');
const MAX_PROJECTS = 50;

export async function readRegistry(env = process.env) {
  try {
    const list = JSON.parse(await readFile(registryPath(env), 'utf8'));
    return Array.isArray(list) ? list.filter((p) => p && typeof p.root === 'string') : [];
  } catch {
    return [];
  }
}

// ponytail: in-process chain + re-read right before writing; two dashboards starting in the same
// millisecond can still race (cross-process lock if that ever matters)
export function registerProject(root, env = process.env) {
  return serial(`registry:${registryPath(env)}`, async () => {
    await mkdir(homeDir(env), { recursive: true });
    const all = await readRegistry(env);
    const prev = all.find((p) => resolve(p.root) === resolve(root));
    const list = all.filter((p) => p !== prev);
    list.unshift({ root: resolve(root), name: prev?.name ?? basename(root), lastOpenedAt: new Date().toISOString() }); // giữ tên đã sửa
    const tmp = `${registryPath(env)}.tmp-${randomBytes(6).toString('hex')}`;
    await writeFile(tmp, JSON.stringify(list.slice(0, MAX_PROJECTS), null, 2), { mode: 0o600 });
    await rename(tmp, registryPath(env));
  });
}

export function forgetProject(root, env = process.env) {
  return serial(`registry:${registryPath(env)}`, async () => {
    const list = await readRegistry(env);
    const next = list.filter((p) => resolve(p.root) !== resolve(root));
    if (next.length === list.length) return false;
    const tmp = `${registryPath(env)}.tmp-${randomBytes(6).toString('hex')}`;
    await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    await rename(tmp, registryPath(env));
    return true;
  });
}

// Thêm project từ nút "Thêm project": đã có trong danh sách thì báo lại, không tạo bản ghi mới.
export async function addProject(root, env = process.env) {
  const abs = resolve(root);
  if (!(await stat(abs).catch(() => null))?.isDirectory()) throw new Error(`Không phải thư mục: ${abs}`);
  if ((await readRegistry(env)).some((p) => resolve(p.root) === abs)) return { added: false, root: abs };
  await registerProject(abs, env);
  return { added: true, root: abs };
}

// Sửa project (nút Sửa ở trang Projects): đổi tên hiển thị và / hoặc trỏ sang thư mục mới (project đã chuyển chỗ).
export function updateProject(root, { name, newRoot } = {}, env = process.env) {
  return serial(`registry:${registryPath(env)}`, async () => {
    const list = await readRegistry(env);
    const entry = list.find((p) => resolve(p.root) === resolve(root));
    if (!entry) throw new Error('Không có project này trong danh sách');
    if (name !== undefined) {
      const n = typeof name === 'string' ? name.trim() : '';
      if (!n || n.length > 80) throw new Error('Tên project 1–80 ký tự');
      entry.name = n;
    }
    if (newRoot !== undefined && resolve(newRoot) !== resolve(entry.root)) {
      const abs = resolve(newRoot);
      if (!(await stat(abs).catch(() => null))?.isDirectory()) throw new Error(`Không phải thư mục: ${abs}`);
      if (list.some((p) => resolve(p.root) === abs)) throw new Error(`Thư mục đã là một project khác: ${abs}`);
      entry.root = abs;
    }
    const tmp = `${registryPath(env)}.tmp-${randomBytes(6).toString('hex')}`;
    await writeFile(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
    await rename(tmp, registryPath(env));
    return { root: entry.root, name: entry.name };
  });
}

// Thư mục con (bỏ thư mục ẩn) cho hộp chọn thư mục: trình duyệt không lộ đường dẫn tuyệt đối nên server liệt kê.
export async function listDirs(dir) {
  const abs = resolve(dir);
  const entries = await readdir(abs, { withFileTypes: true });
  // symlink tới thư mục (vd. ~/code) cũng là thư mục với người dùng: kiểm bằng stat
  const isDir = async (e) => e.isDirectory() || (e.isSymbolicLink() && (await stat(join(abs, e.name)).then((st) => st.isDirectory(), () => false)));
  const visible = entries.filter((e) => !e.name.startsWith('.'));
  const flags = await Promise.all(visible.map(isDir));
  const dirs = visible.filter((_, i) => flags[i]).map((e) => e.name).sort((a, b) => a.localeCompare(b));
  return { path: abs, parent: dirname(abs) === abs ? null : dirname(abs), dirs };
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

// One row per registered project: latest run, pass rate, health, and a link when its server runs.
export async function projectSummaries(currentRoot, env = process.env) {
  // các project đọc song song (mỗi cái liệt kê run riêng), thứ tự giữ như danh sách
  return Promise.all((await readRegistry(env)).map(async (p) => {
    const root = resolve(p.root);
    const exists = existsSync(root);
    const metas = exists ? await listRuns(root).catch(() => []) : [];
    const s = exists ? readServerInfo(root) : null;
    const running = Boolean(s?.pid && Number.isInteger(s.pid) && alive(s.pid));
    const latest = metas[0] ?? null;
    return {
      root,
      name: p.name ?? basename(root),
      current: root === resolve(currentRoot),
      exists,
      lastOpenedAt: p.lastOpenedAt ?? null,
      runs: metas.length,
      latest: latest && { runId: latest.runId, status: latest.status, startedAt: latest.startedAt, summary: latest.summary, branch: latest.git?.branch ?? null },
      passRate: latest ? passRate(latest) : null,
      health: healthScore(metas),
      url: running ? `http://127.0.0.1:${s.port}/?token=${s.token}` : null,
    };
  }));
}
