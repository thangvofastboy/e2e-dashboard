// Disk used by the run history, and pruning: old videos first, then whole runs (never pinned ones).
import { readdir, lstat, rm } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { DATA_DIR, isLink, pruneEmptyParents } from '../reporter/e2e-dashboard.reporter.mjs';
import { listRuns } from './store.mjs';

const VIDEO = new Set(['.webm', '.mp4', '.mov']);
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

async function walk(dir, visit) {
  if (isLink(dir)) return; // a planted runs/<x>/artifacts -> ~/Videos must not be counted or pruned
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, visit);
    else if (e.isFile()) {
      const st = await lstat(p).catch(() => null); // retention / xoá run xoá file giữa readdir và lstat: bỏ qua, không làm hỏng cả trang
      if (st) await visit(p, st.size);
    }
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
  await pruneEmptyParents(join(root, DATA_DIR, 'runs'), m.dir); // runs/YYYY/MM/DD rỗng thì bỏ
  return { deleted: true };
}

// Dọn rác: run trong khoảng thời gian [from, to) (ISO hoặc ngày YYYY-MM-DD), lọc thêm theo trạng thái.
// Run ghim không bao giờ bị chọn. preview: chỉ liệt kê; ngược lại xoá đúng các run đó (và thư mục ngày rỗng).
const DAY_MS = 86_400_000;
const STATUSES = { all: null, passed: ['passed'], failed: ['failed', 'interrupted', 'error', 'blocked'] };
export function cleanupRange({ from = null, to = null, olderThanDays = null, status = 'all' } = {}, now = Date.now()) {
  const t = (v, end) => {
    if (v == null || v === '') return null;
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    // ngày: nửa đêm theo lịch máy; "đến ngày X" gồm cả ngày X (ngày kế tiếp, đúng cả hôm đổi giờ DST)
    const ms = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]) + (end ? 1 : 0)).getTime() : Date.parse(v);
    if (!Number.isFinite(ms)) throw Object.assign(new Error(`Ngày không hợp lệ: ${v}`), { status: 400 });
    return ms;
  };
  if (olderThanDays != null && (!Number.isInteger(olderThanDays) || olderThanDays < 0 || olderThanDays > 3650)) throw Object.assign(new Error('Số ngày không hợp lệ'), { status: 400 });
  if (!(status in STATUSES)) throw Object.assign(new Error('Trạng thái không hợp lệ'), { status: 400 });
  const lo = t(from, false);
  const hi = olderThanDays != null ? now - olderThanDays * DAY_MS : t(to, true);
  if (lo != null && hi != null && lo >= hi) throw Object.assign(new Error('Khoảng thời gian rỗng'), { status: 400 });
  if (lo == null && hi == null) throw Object.assign(new Error('Chọn khoảng thời gian (hoặc số ngày) trước khi dọn'), { status: 400 });
  return { lo, hi, statuses: STATUSES[status] };
}

export async function cleanupRuns(root, query, { preview = true, now = Date.now() } = {}) {
  const { lo, hi, statuses } = cleanupRange(query, now);
  const runsDir = join(root, DATA_DIR, 'runs');
  const picked = [];
  let pinnedSkipped = 0;
  for (const m of await listRuns(root)) {
    const at = Date.parse(m.startedAt);
    if (!Number.isFinite(at) || (lo != null && at < lo) || (hi != null && at >= hi)) continue;
    if (statuses && !statuses.includes(m.status)) continue;
    if (m.pinned || m.baseline) {
      pinnedSkipped++; // ghim và baseline (run để so sánh) không bao giờ bị dọn
      continue;
    }
    const dir = join(runsDir, m.dir);
    if (isLink(dir)) continue;
    let bytes = 0;
    await walk(dir, (p, size) => (bytes += size)); // chỉ đo run được chọn, không quét cả lịch sử
    picked.push({ runId: m.runId, startedAt: m.startedAt, status: m.status, branch: m.git?.branch ?? null, bytes, dir: m.dir });
  }
  const bytes = picked.reduce((s, r) => s + r.bytes, 0);
  if (preview) return { runs: picked.map(({ dir, ...r }) => r), bytes, pinnedSkipped };
  let deleted = 0;
  for (const r of picked) {
    // xoá thẳng thư mục đã chọn (không listRuns lại mỗi run như deleteRun)
    await rm(join(runsDir, r.dir), { recursive: true, force: true });
    await pruneEmptyParents(runsDir, r.dir);
    deleted++;
  }
  return { deleted, bytes, pinnedSkipped };
}
