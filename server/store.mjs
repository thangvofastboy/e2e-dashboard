import { readdir, readFile, writeFile } from 'node:fs/promises';
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
