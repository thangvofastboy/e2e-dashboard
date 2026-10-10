import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR, RUN_ID, resultAttempts } from '../reporter/e2e-dashboard.reporter.mjs';

const runsDir = (root) => join(root, DATA_DIR, 'runs');
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

export async function listRuns(root) {
  let names;
  try {
    names = await readdir(runsDir(root));
  } catch {
    return [];
  }
  const metas = [];
  for (const dir of names.filter((n) => !n.startsWith('.')).sort().reverse()) {
    try {
      metas.push({ ...(await readJson(join(runsDir(root), dir, 'meta.json'))), dir });
    } catch {
      // half-written or removed concurrently
    }
  }
  return metas;
}

export async function findRunDir(root, runId) {
  if (typeof runId !== 'string' || !RUN_ID.test(runId)) return null;
  const names = await readdir(runsDir(root)).catch(() => []);
  const dir = names.find((d) => d.endsWith(`_${runId}`));
  return dir ? join(runsDir(root), dir) : null;
}

export async function getRun(root, runId) {
  const dir = await findRunDir(root, runId);
  if (!dir) return null;
  return { meta: await readJson(join(dir, 'meta.json')), report: await readJson(join(dir, 'report.json')), dir };
}

async function writeMeta(dir, meta) {
  const { dir: _ignored, ...rest } = meta;
  await writeFile(join(dir, 'meta.json'), JSON.stringify(rest, null, 2));
  return rest;
}

export async function setFlag(root, runId, flag, value) {
  if (flag !== 'pinned' && flag !== 'baseline') throw new Error(`unknown flag ${flag}`);
  const dir = await findRunDir(root, runId);
  if (!dir) return null;
  if (flag === 'baseline' && value) {
    for (const m of await listRuns(root))
      if (m.baseline && m.runId !== runId) await writeMeta(join(runsDir(root), m.dir), { ...m, baseline: false });
  }
  const meta = await readJson(join(dir, 'meta.json'));
  return writeMeta(dir, { ...meta, [flag]: Boolean(value) });
}

// Runs started from the dashboard: remember that, and which run they reran (spec §4.5).
export async function annotateRun(root, runId, { launchedBy, rerunOf } = {}) {
  const dir = await findRunDir(root, runId);
  if (!dir) return null;
  const meta = await readJson(join(dir, 'meta.json'));
  if (launchedBy !== undefined) meta.launchedBy = String(launchedBy);
  if (rerunOf !== undefined && rerunOf !== null) meta.rerunOf = String(rerunOf);
  return writeMeta(dir, meta);
}

const resultDuration = (report, r) => resultAttempts(report, r).reduce((s, a) => s + (a.durationMs ?? 0), 0);

export async function testHistory(root, n = 10) {
  const rows = new Map();
  for (const m of (await listRuns(root)).slice(0, n)) {
    let report;
    try {
      report = await readJson(join(runsDir(root), m.dir, 'report.json'));
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

export async function getAi(root, runId, key) {
  const dir = await findRunDir(root, runId);
  if (!dir || !AI_KEY.test(key)) return null;
  return readJson(join(dir, 'ai', `${key}.json`)).catch(() => null);
}

export async function writeAi(root, runId, key, entry) {
  const dir = await findRunDir(root, runId);
  if (!dir || !AI_KEY.test(key)) return false;
  await mkdir(join(dir, 'ai'), { recursive: true });
  await writeFile(join(dir, 'ai', `${key}.json`), JSON.stringify(entry, null, 2));
  return true;
}

export async function listAi(root, runId) {
  const dir = await findRunDir(root, runId);
  if (!dir) return null;
  const names = (await readdir(join(dir, 'ai')).catch(() => [])).filter((n) => AI_KEY.test(n.replace(/\.json$/, '')));
  const entries = [];
  for (const n of names) {
    const e = await readJson(join(dir, 'ai', n)).catch(() => null);
    if (e) entries.push({ key: n.replace(/\.json$/, ''), ...e });
  }
  return entries.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
