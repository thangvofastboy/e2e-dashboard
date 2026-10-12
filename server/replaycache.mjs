// The e2e replay cache (`.e2e/cache/<key digest>.json`, trace-1) as `e2e cache ls|stats|clear` shows it,
// read straight from the files: never outside the project, never a symlink, never a file over 1 MiB.
import { readdir, readFile, lstat, rm } from 'node:fs/promises';
import { safeJoin, realInside, readConfig } from '../reporter/e2e-dashboard.reporter.mjs';

const ENTRY = /^([0-9a-f]{64})\.json$/;
const MAX_FILES = 5000;
export const STALE_DAYS = 30;

export function cacheDir(projectRoot, cfg = readConfig(projectRoot)) {
  return safeJoin(projectRoot, typeof cfg.cacheDir === 'string' ? cfg.cacheDir : `${typeof cfg.output === 'string' ? cfg.output : '.e2e'}/cache`);
}

// testIds: ids of the tests that still exist (latest run); entries of any other test are "orphans"
export async function listCache(projectRoot, { cfg, now = Date.now(), testIds = null } = {}) {
  const dir = cacheDir(projectRoot, cfg);
  const out = { dir: dir ? dir.slice(projectRoot.length + 1) : null, entries: [], unreadable: 0, bytes: 0, truncated: false };
  if (!dir || !realInside(projectRoot, dir)) return out;
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    const id = ENTRY.exec(name)?.[1];
    if (!id) continue;
    if (out.entries.length + out.unreadable >= MAX_FILES) {
      out.truncated = true;
      break;
    }
    const file = safeJoin(dir, name);
    try {
      const st = await lstat(file);
      if (!st.isFile() || st.size > 1024 * 1024) throw new Error('skip');
      const doc = JSON.parse(await readFile(file, 'utf8'));
      const p = doc?.payload;
      if (!p || !Array.isArray(p.actions) || typeof doc.createdAt !== 'string') throw new Error('shape');
      const ageMs = now - Date.parse(doc.createdAt);
      const testId = typeof p.recordedFor?.testId === 'string' ? p.recordedFor.testId : null;
      out.bytes += st.size;
      out.entries.push({
        id, testId, targetId: p.recordedFor?.targetId ?? null, agent: p.recordedFor?.agent ?? null,
        instruction: String(p.recordedFor?.instructionDigest ?? '').slice(0, 12) || null,
        createdAt: doc.createdAt, ageMs: Number.isFinite(ageMs) ? ageMs : null, actions: p.actions.length, truncated: p.truncated === true,
        bytes: st.size, summary: String(p.summary ?? '').slice(0, 200),
        stale: Number.isFinite(ageMs) && ageMs > STALE_DAYS * 86_400_000,
        orphan: Boolean(testIds && testId && !testIds.has(testId)),
      });
    } catch {
      out.unreadable++;
    }
  }
  return out;
}

// `ids`: only those entries; `testId`: every entry of that test; neither: the whole cache. Returns how many files went.
export async function clearCache(projectRoot, { cfg, ids = null, testId = null, orphansOf = null } = {}) {
  const dir = cacheDir(projectRoot, cfg);
  if (!dir || !realInside(projectRoot, dir)) return 0;
  const { entries } = await listCache(projectRoot, { cfg, testIds: orphansOf });
  const want = new Set(ids ?? []);
  const pick = entries.filter((e) => (ids ? want.has(e.id) : testId ? e.testId === testId : orphansOf ? e.orphan : true));
  let n = 0;
  for (const e of pick) {
    const file = safeJoin(dir, `${e.id}.json`);
    if (file && realInside(dir, file)) {
      await rm(file, { force: true });
      n++;
    }
  }
  return n;
}
