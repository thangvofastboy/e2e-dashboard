// Chỉ mục SQLite của các run (.e2e-dashboard/cache/index.sqlite): một dòng mỗi run, một dòng mỗi kết quả test.
// File trong runs/ vẫn là nguồn gốc (artifact, export, share, publish đọc thẳng thư mục run); chỉ mục là dữ liệu dẫn xuất:
// xoá đi là tự dựng lại. Node không có node:sqlite (< 22.13) thì mọi hàm trả null và dashboard chạy bằng file như cũ.
// Dùng cho đường nóng: lịch sử từng test (trang Tests), đếm SLO — không phải parse lại hàng trăm report.json.
import { readFile } from 'node:fs/promises';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, isLink, resultAttempts } from '../reporter/e2e-dashboard.reporter.mjs';
import { listRuns } from './store.mjs';
import { readSettings } from './settings.mjs';

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  // Node cũ: không có chỉ mục
}
export const indexAvailable = () => Boolean(DatabaseSync);

// Bật chỉ mục cần node:sqlite không cờ: Node ≥ 22.13 (hoặc ≥ 23.4)
export function sqliteSupport(version = process.versions.node, available = indexAvailable()) {
  const [major, minor] = version.split('.').map(Number);
  const ok = (major === 22 && minor >= 13) || (major === 23 && minor >= 4) || major >= 24;
  if (!ok) return { ok: false, reason: `Cần Node.js ≥ 22.13 để dùng SQLite (đang chạy v${version}). Cài Node mới hơn (vd. fnm install 22) rồi bật lại.` };
  if (!available) return { ok: false, reason: `Node v${version} không có module node:sqlite: không bật được SQLite.` };
  return { ok: true, reason: null };
}
// đang bật trong cài đặt của project (mặc định tắt) và Node hỗ trợ
export const indexEnabled = async (root) => (await readSettings(root)).sqlite && sqliteSupport().ok;

const SCHEMA = 1; // đổi cấu trúc bảng → tăng số: chỉ mục cũ bị bỏ và dựng lại
const FAIL = new Set(['failed', 'timed-out', 'interrupted']);
const dbs = new Map(); // root -> DatabaseSync
const syncing = new Map(); // root -> Promise (một lần đồng bộ mỗi lúc)

export const indexPath = (root) => join(root, DATA_DIR, 'cache', 'index.sqlite');

function open(root) {
  if (!DatabaseSync) return null;
  if (dbs.has(root)) return dbs.get(root);
  const dir = join(root, DATA_DIR, 'cache');
  if (isLink(join(root, DATA_DIR)) || isLink(dir) || isLink(indexPath(root))) return null;
  mkdirSync(dir, { recursive: true });
  let db;
  try {
    db = new DatabaseSync(indexPath(root));
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    db.prepare('PRAGMA quick_check').get();
  } catch {
    // file chỉ mục hỏng: chỉ là cache, xoá và dựng lại
    try {
      db?.close();
    } catch {
      // đã đóng
    }
    for (const f of ['', '-wal', '-shm']) rmSync(`${indexPath(root)}${f}`, { force: true });
    db = new DatabaseSync(indexPath(root));
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  }
  if (db.prepare('PRAGMA user_version').get().user_version !== SCHEMA) {
    db.exec(`DROP TABLE IF EXISTS runs; DROP TABLE IF EXISTS results;
      CREATE TABLE runs (run_id TEXT PRIMARY KEY, dir TEXT NOT NULL, started_at TEXT, status TEXT, branch TEXT, kind TEXT,
        duration_ms INTEGER, tokens INTEGER, pinned INTEGER, executed INTEGER, failed INTEGER);
      CREATE TABLE results (run_id TEXT NOT NULL, started_at TEXT, test_key TEXT NOT NULL, test_id TEXT, title TEXT, file TEXT, line INTEGER,
        target TEXT, agent TEXT, tags TEXT, status TEXT, duration_ms INTEGER);
      CREATE INDEX results_run ON results(run_id);
      CREATE INDEX results_test ON results(test_key, started_at);
      CREATE INDEX runs_started ON runs(started_at);
      PRAGMA user_version = ${SCHEMA};`);
  }
  dbs.set(root, db);
  return db;
}

export function closeIndex(root) {
  dbs.get(root)?.close();
  dbs.delete(root);
}

// Thêm run mới (parse report một lần), bỏ run đã xoá, cập nhật cờ ghim. Trả { added, removed, total } hoặc null.
export function syncIndex(root) {
  if (!syncing.has(root)) syncing.set(root, doSync(root).finally(() => syncing.delete(root)));
  return syncing.get(root);
}

async function doSync(root) {
  if (!(await indexEnabled(root))) return null; // tắt: mọi thứ đọc file như cũ
  const db = open(root);
  if (!db) return null;
  const metas = (await listRuns(root)).filter((m) => typeof m.runId === 'string');
  const have = new Map(db.prepare('SELECT run_id, pinned, dir FROM runs').all().map((r) => [r.run_id, r]));
  const live = new Set(metas.map((m) => m.runId));
  const insRun = db.prepare('INSERT OR REPLACE INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insRes = db.prepare('INSERT INTO results VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  let added = 0;
  for (const m of metas) {
    const old = have.get(m.runId);
    if (old && old.dir === m.dir) {
      if (Boolean(old.pinned) !== Boolean(m.pinned)) db.prepare('UPDATE runs SET pinned = ? WHERE run_id = ?').run(m.pinned ? 1 : 0, m.runId);
      continue;
    }
    let report;
    try {
      const dir = join(root, DATA_DIR, 'runs', m.dir);
      if (isLink(dir) || isLink(join(dir, 'report.json'))) continue; // như store.cachedReport: report.json là symlink thì không đọc theo
      report = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8'));
    } catch {
      continue; // đang ghi / vừa bị xoá: lần sau
    }
    const results = (report.run?.results ?? []).filter((r) => r && r.kind !== 'setup');
    let executed = 0;
    let failed = 0;
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM results WHERE run_id = ?').run(m.runId);
      for (const r of results) {
        if (r.status !== 'skipped') executed++;
        if (FAIL.has(r.status)) failed++;
        const dur = resultAttempts(report, r).reduce((s, a) => s + (Number(a.durationMs) || 0), 0);
        insRes.run(m.runId, m.startedAt ?? null, `${r.testId}|${r.targetId}|${r.agent ?? 'default'}`, String(r.testId ?? ''), Array.isArray(r.titlePath) ? r.titlePath.join(' › ') : String(r.testId ?? r.id ?? ''),
          r.source?.file ?? r.file ?? null, Number.isInteger(r.source?.line) ? r.source.line : null, r.targetId ?? null, r.agent ?? 'default', JSON.stringify(Array.isArray(r.tags) ? r.tags : []), String(r.status ?? ''), dur);
      }
      insRun.run(m.runId, m.dir, m.startedAt ?? null, m.status ?? null, m.git?.branch ?? null, m.kind ?? null, Number(m.durationMs) || 0,
        (Number(m.tokens?.input) || 0) + (Number(m.tokens?.output) || 0), m.pinned ? 1 : 0, executed, failed);
      db.exec('COMMIT');
      added++;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  let removed = 0;
  for (const id of have.keys()) {
    if (live.has(id)) continue;
    db.prepare('DELETE FROM results WHERE run_id = ?').run(id);
    db.prepare('DELETE FROM runs WHERE run_id = ?').run(id);
    removed++;
  }
  return { added, removed, total: live.size };
}

// SLO: { runId → { executed, failed } } cho các run đã có trong chỉ mục
export async function indexedCounts(root) {
  if (!(await syncIndex(root))) return null;
  return new Map(open(root).prepare('SELECT run_id, executed, failed FROM runs').all().map((r) => [r.run_id, { executed: r.executed, failed: r.failed }]));
}

// Trang Tests: cùng dạng với store.testHistory(root, n), đọc từ chỉ mục thay vì parse n report
export async function indexedTestHistory(root, n = 10) {
  if (!(await syncIndex(root))) return null;
  const metas = (await listRuns(root)).slice(0, n);
  if (!metas.length) return [];
  const order = new Map(metas.map((m, i) => [m.runId, i]));
  const db = open(root);
  const rows = db.prepare(`SELECT run_id, test_key, test_id, title, file, line, target, agent, tags, status, duration_ms FROM results
    WHERE run_id IN (${metas.map(() => '?').join(',')})`).all(...metas.map((m) => m.runId));
  rows.sort((a, b) => order.get(a.run_id) - order.get(b.run_id));
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.test_key)) out.set(r.test_key, { key: r.test_key, testId: r.test_id, title: r.title, file: r.file, line: r.line, target: r.target, agent: r.agent, tags: JSON.parse(r.tags || '[]'), history: [], durations: [] });
    const t = out.get(r.test_key);
    t.history.push({ runId: r.run_id, status: r.status });
    if (r.status !== 'skipped') t.durations.push(r.duration_ms);
  }
  return [...out.values()].map(({ durations, ...t }) => ({ ...t, avgDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null }));
}
