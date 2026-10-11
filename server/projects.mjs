// Every project that has opened a dashboard, in one per-user registry (~/.e2e-dashboard/projects.json),
// so one dashboard can show them all. The registry lives in the user's home, never in a repo.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, basename } from 'node:path';
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
    const list = (await readRegistry(env)).filter((p) => resolve(p.root) !== resolve(root));
    list.unshift({ root: resolve(root), name: basename(root), lastOpenedAt: new Date().toISOString() });
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
  const out = [];
  for (const p of await readRegistry(env)) {
    const root = resolve(p.root);
    const exists = existsSync(root);
    const metas = exists ? await listRuns(root).catch(() => []) : [];
    const s = exists ? readServerInfo(root) : null;
    const running = Boolean(s?.pid && Number.isInteger(s.pid) && alive(s.pid));
    const latest = metas[0] ?? null;
    out.push({
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
    });
  }
  return out;
}
