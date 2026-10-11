// Disk used by the run history, and pruning: old videos first, then whole runs (never pinned ones).
import { readdir, lstat, rm } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { DATA_DIR, isLink } from '../reporter/e2e-dashboard.reporter.mjs';
import { listRuns } from './store.mjs';

const VIDEO = new Set(['.webm', '.mp4', '.mov']);
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

async function walk(dir, visit) {
  if (isLink(dir)) return; // a planted runs/<x>/artifacts -> ~/Videos must not be counted or pruned
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, visit);
    else if (e.isFile()) await visit(p, (await lstat(p)).size);
  }
}

const kindOf = (p) => {
  const x = extname(p).toLowerCase();
  if (VIDEO.has(x)) return 'video';
  if (IMAGE.has(x)) return 'image';
  if (p.endsWith('report.json')) return 'report';
  if (/[\\/]traces[\\/]/.test(p) || p.endsWith('.md')) return 'trace';
  return 'other';
};

export async function storageUsage(root) {
  const runs = [];
  const totals = { video: 0, image: 0, report: 0, trace: 0, other: 0 };
  for (const m of await listRuns(root)) {
    const dir = join(root, DATA_DIR, 'runs', m.dir);
    if (isLink(dir)) continue;
    const r = { runId: m.runId, startedAt: m.startedAt, status: m.status, pinned: Boolean(m.pinned), bytes: 0, video: 0 };
    await walk(dir, (p, size) => {
      const k = kindOf(p);
      totals[k] += size;
      r.bytes += size;
      if (k === 'video') r.video += size;
    });
    runs.push(r);
  }
  return { runs, totals, bytes: Object.values(totals).reduce((a, b) => a + b, 0) };
}

// Videos of runs older than `days`: the heaviest files, and the least needed once a run is old.
export async function pruneVideos(root, days, now = Date.now()) {
  if (!Number.isInteger(days) || days < 0 || days > 3650) throw new Error('invalid days');
  let freed = 0;
  let files = 0;
  for (const m of await listRuns(root)) {
    if (m.pinned || now - Date.parse(m.startedAt) < days * 86_400_000) continue;
    const dir = join(root, DATA_DIR, 'runs', m.dir);
    if (isLink(dir)) continue;
    const doomed = [];
    await walk(join(dir, 'artifacts'), (p, size) => kindOf(p) === 'video' && doomed.push([p, size]));
    for (const [p, size] of doomed) {
      await rm(p, { force: true });
      freed += size;
      files++;
    }
  }
  return { freed, files };
}

export async function deleteRun(root, runId) {
  const m = (await listRuns(root)).find((x) => x.runId === runId);
  if (!m) return { deleted: false, reason: 'not-found' };
  if (m.pinned) return { deleted: false, reason: 'pinned' };
  const dir = join(root, DATA_DIR, 'runs', m.dir);
  if (isLink(dir)) return { deleted: false, reason: 'unsafe' };
  await rm(dir, { recursive: true, force: true });
  return { deleted: true };
}
