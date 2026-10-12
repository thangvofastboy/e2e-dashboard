import { readdir, readFile, writeFile, mkdir, rename, rm, lstat, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, join, relative } from 'node:path';
import { serial } from './jsonstate.mjs';
import { DATA_DIR, RUN_ID, RESULT_ID, resultAttempts, realInside, isLink, listRunDirs } from '../reporter/e2e-dashboard.reporter.mjs';

const runsDir = (root) => join(root, DATA_DIR, 'runs');
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

// Parsed meta.json by path, reused while the file's mtime and size are unchanged: with thousands of
// runs a stat is far cheaper than reading and parsing every file on each request.
const metaCache = new Map();

export async function listRuns(root) {
  if (isLink(join(root, DATA_DIR)) || isLink(runsDir(root))) return [];
  const dirs = await listRunDirs(runsDir(root)); // runs/YYYY/MM/DD/… và bố cục cũ runs/<ISO>_<id>, mới nhất trước
  const live = new Set();
  const one = async (dir) => {
    const p = join(runsDir(root), dir, 'meta.json');
    live.add(p);
    try {
      const st = await stat(p);
      const hit = metaCache.get(p);
      if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return { ...hit.meta, dir };
      const meta = await readJson(p);
      metaCache.set(p, { mtimeMs: st.mtimeMs, size: st.size, meta });
      return { ...meta, dir };
    } catch {
      return null; // half-written or removed concurrently
    }
  };
  const metas = [];
  for (let i = 0; i < dirs.length; i += 32) metas.push(...(await Promise.all(dirs.slice(i, i + 32).map(one)))); // 32 stats in flight, order kept
  for (const k of metaCache.keys()) if (k.startsWith(runsDir(root)) && !live.has(k)) metaCache.delete(k); // removed by retention
  for (const k of [...reportCache.keys()]) if (k.startsWith(runsDir(root)) && !live.has(join(k, 'meta.json'))) dropReport(k);
  for (const k of [...countCache.keys()]) if (k.startsWith(runsDir(root)) && !live.has(join(k, 'meta.json'))) countCache.delete(k);
  return metas.filter(Boolean);
}

export async function findRunDir(root, runId) {
  if (typeof runId !== 'string' || !RUN_ID.test(runId)) return null;
  if (isLink(join(root, DATA_DIR)) || isLink(runsDir(root))) return null;
  const dir = (await listRunDirs(runsDir(root), { sort: false })).find((d) => d.endsWith(`_${runId}`)); // tra cứu: không cần sắp xếp
  if (!dir) return null;
  // a hostile clone can commit runs/<x> (or runs/2026 …) as a symlink: only real directories under runs/ count
  const full = join(runsDir(root), dir);
  return !isLink(full) && realInside(runsDir(root), full) ? full : null;
}

// Archived reports never change: parse each once, keyed by its run directory. Giới hạn theo dung lượng
// (không theo số report): report có step agent nặng vài MB, 400 report từng có thể chiếm hàng GB RAM.
// ponytail: đo bằng độ dài text JSON (bản parse ~1.6×); ?n=200 với report lớn sẽ đọc lại đĩa thay vì hết RAM.
export const REPORT_CACHE_BYTES = 48 * 1024 * 1024;
const reportCache = new Map(); // key -> { report: Promise, bytes }, cũ nhất trước
let cachedBytes = 0;
async function cachedReport(root, dir) {
  const key = join(runsDir(root), dir);
  const hit = reportCache.get(key);
  if (hit) {
    reportCache.delete(key); // LRU: dùng lại thì xếp cuối
    reportCache.set(key, hit);
    return hit.report;
  }
  const entry = { bytes: 0, report: null };
  entry.report = readFile(join(key, 'report.json'), 'utf8')
    .then((text) => {
      const report = JSON.parse(text);
      if (reportCache.get(key) === entry) {
        entry.bytes = text.length;
        cachedBytes += text.length;
        for (const [k] of reportCache) {
          if (cachedBytes <= REPORT_CACHE_BYTES) break;
          if (k !== key) dropReport(k); // bỏ cũ nhất trước, không bao giờ bỏ report vừa đọc
        }
      }
      return report;
    })
    .catch((e) => {
      if (reportCache.get(key) === entry) dropReport(key); // file hỏng / bị xoá: lần sau đọc lại
      throw e;
    });
  reportCache.set(key, entry);
  return entry.report;
}
function dropReport(key) {
  const e = reportCache.get(key);
  if (!e) return;
  reportCache.delete(key);
  cachedBytes -= e.bytes;
}

// The last n runs as {meta, report}, newest first (what server/analytics.mjs works on).
export async function loadHistory(root, n = 30) {
  const out = [];
  for (const meta of (await listRuns(root)).slice(0, n)) {
    if (isLink(join(runsDir(root), meta.dir))) continue;
    try {
      out.push({ meta, report: await cachedReport(root, meta.dir) });
    } catch {
      // removed by retention meanwhile
    }
  }
  return out;
}

export async function getRun(root, runId) {
  const dir = await findRunDir(root, runId);
  if (!dir) return null;
  return { meta: await readJson(join(dir, 'meta.json')), report: await cachedReport(root, relative(runsDir(root), dir)), dir };
}

// Số test đã chạy / fail của một run cho SLO: đếm một lần rồi nhớ (run đã lưu không đổi). Đọc thẳng file, không qua
// cache report: cửa sổ SLO có thể vài trăm run, giữ cả trăm report cùng lúc từng đẩy RAM lên ~700MB.
const countCache = new Map();
const SLO_FAIL = new Set(['failed', 'timed-out', 'interrupted']);
export function runCounts(report) {
  let executed = 0;
  let failed = 0;
  for (const r of report?.run?.results ?? []) {
    if (!r || r.kind === 'setup' || r.status === 'skipped') continue;
    executed++;
    if (SLO_FAIL.has(r.status)) failed++;
  }
  return { executed, failed };
}
export async function cachedCounts(root, dir) {
  const key = join(runsDir(root), dir);
  if (isLink(key) || isLink(join(key, 'report.json'))) throw new Error('symlink');
  if (!countCache.has(key)) countCache.set(key, runCounts(JSON.parse(await readFile(join(key, 'report.json'), 'utf8'))));
  return countCache.get(key);
}

// Write via a temp file + rename: a symlink planted at the target is replaced, never written through.
async function safeWrite(path, text) {
  const tmp = `${path}.tmp-${randomBytes(6).toString('hex')}`;
  await writeFile(tmp, text, { flag: 'wx' });
  try {
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

async function writeMeta(dir, meta) {
  const { dir: _ignored, ...rest } = meta;
  await safeWrite(join(dir, 'meta.json'), JSON.stringify(rest, null, 2));
  return rest;
}

export async function setFlag(root, runId, flag, value) {
  if (flag !== 'pinned' && flag !== 'baseline') throw new Error(`unknown flag ${flag}`);
  const dir = await findRunDir(root, runId);
  if (!dir) return null;
  // meta.json is read-modify-written by pin/baseline and by annotateRun: one chain per project, no lost field
  return serial(`meta:${root}`, async () => {
    if (flag === 'baseline' && value) {
      for (const m of await listRuns(root))
        if (m.baseline && m.runId !== runId) await writeMeta(join(runsDir(root), m.dir), { ...m, baseline: false });
    }
    const meta = await readJson(join(dir, 'meta.json'));
    return writeMeta(dir, { ...meta, [flag]: Boolean(value) });
  });
}

// Runs started from the dashboard: remember that, and which run they reran (spec §4.5).
export async function annotateRun(root, runId, { launchedBy, rerunOf, browser } = {}) {
  const dir = await findRunDir(root, runId);
  if (!dir) return null;
  return serial(`meta:${root}`, async () => {
    const meta = await readJson(join(dir, 'meta.json'));
    if (launchedBy !== undefined) meta.launchedBy = String(launchedBy);
    if (rerunOf !== undefined && rerunOf !== null) meta.rerunOf = String(rerunOf);
    if (/^(chromium|firefox|webkit)$/.test(browser ?? '')) meta.browser = browser; // trình duyệt dashboard đã chạy run này
    return writeMeta(dir, meta);
  });
}

const resultDuration = (report, r) => resultAttempts(report, r).reduce((s, a) => s + (a.durationMs ?? 0), 0);

export async function testHistory(root, n = 10) {
  const rows = new Map();
  for (const m of (await listRuns(root)).slice(0, n)) {
    if (isLink(join(runsDir(root), m.dir))) continue;
    let report;
    try {
      report = await cachedReport(root, m.dir);
    } catch {
      continue;
    }
    for (const r of report.run.results ?? []) {
      if (r.kind === 'setup') continue;
      const key = `${r.testId}|${r.targetId}|${r.agent ?? 'default'}`;
      if (!rows.has(key))
        rows.set(key, {
          key,
          testId: r.testId,
          title: Array.isArray(r.titlePath) ? r.titlePath.join(' › ') : String(r.testId ?? r.id),
          file: r.source?.file ?? r.file,
          line: r.source?.line ?? null,
          target: r.targetId,
          agent: r.agent ?? 'default',
          tags: r.tags ?? [],
          history: [],
          durations: [],
        });
      const row = rows.get(key);
      row.history.push({ runId: m.runId, status: r.status });
      if (r.status !== 'skipped') row.durations.push(resultDuration(report, r));
    }
  }
  return [...rows.values()].map(({ durations, ...row }) => ({
    ...row,
    avgDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
  }));
}

// Cached AI analyses live with their run (removed by retention, embedded by the export).
const AI_KEY = /^[0-9a-f]{64}$/;

// Regular files only: a planted symlink in ai/ must never be read (exfiltration via the export).
async function readAiFile(dir, name) {
  const p = join(dir, 'ai', name);
  if (isLink(join(dir, 'ai')) || !(await lstat(p).catch(() => null))?.isFile()) return null;
  return readJson(p).catch(() => null);
}

export async function getAi(root, runId, key) {
  const dir = await findRunDir(root, runId);
  if (!dir || !AI_KEY.test(key)) return null;
  return readAiFile(dir, `${key}.json`);
}

export async function writeAi(root, runId, key, { action, resultId, markdown, createdAt }) {
  const dir = await findRunDir(root, runId);
  if (!dir || !AI_KEY.test(key)) return false;
  // resultId ends up in a file; only a real result id (64 hex) for a failure analysis is stored
  const perResult = action === 'analyze-failure' || action === 'suggest-locator' || action === 'why-flaky';
  if (perResult && !RESULT_ID.test(resultId ?? '')) return false;
  const aiDir = join(dir, 'ai');
  if (isLink(aiDir)) return false;
  await mkdir(aiDir, { recursive: true });
  const entry = { action: String(action), resultId: perResult ? resultId : null, markdown: String(markdown), createdAt: String(createdAt) };
  await safeWrite(join(aiDir, `${key}.json`), JSON.stringify(entry, null, 2));
  return true;
}

export async function listAi(root, runId) {
  const dir = await findRunDir(root, runId);
  if (!dir) return null;
  const names = isLink(join(dir, 'ai')) ? [] : (await readdir(join(dir, 'ai')).catch(() => [])).filter((n) => AI_KEY.test(n.replace(/\.json$/, '')));
  const entries = [];
  for (const n of names) {
    const e = await readAiFile(dir, n);
    if (e) entries.push({ key: n.replace(/\.json$/, ''), ...e });
  }
  return entries.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
