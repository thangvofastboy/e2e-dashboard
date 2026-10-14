// e2e-dashboard reporter. Self-contained: imports only node:* so it can be copied into any e2e project.
// Exported archive() is also used by the e2e-dashboard plugin (hook + server).
import { mkdir, readFile, writeFile, copyFile, rename, rm, rmdir, readdir, stat } from 'node:fs/promises';
import { readFileSync, readdirSync, existsSync, realpathSync, lstatSync } from 'node:fs';
import { join, dirname, basename, resolve, relative, sep, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const VERSION = '0.12.0';
export const DATA_DIR = '.e2e-dashboard';

function allSteps(report) {
  const out = [];
  for (const r of report.run.results ?? []) for (const a of r.attempts ?? []) out.push(...(a.steps ?? []));
  for (const g of report.run.serialGroups ?? [])
    for (const a of g.attempts ?? []) for (const m of a.members ?? []) out.push(...(m.steps ?? []));
  return out;
}

// Failed results grouped by the class e2e gives their error (test | configuration | infrastructure | interrupted | internal).
// Only `test` failures say anything about the app: the rest (model provider down, bad credentials, a crashed worker…) are not regressions.
export function errorClasses(report) {
  const out = {};
  for (const r of report.run.results ?? []) {
    if (!['failed', 'timed-out', 'interrupted'].includes(r.status)) continue;
    const a = (r.attempts ?? []).at(-1);
    const err = a?.error ?? (a?.steps ?? []).find((x) => x.error)?.error;
    const c = r.status === 'interrupted' ? 'interrupted' : typeof err?.category === 'string' ? err.category.slice(0, 30) : 'test';
    out[c] = (out[c] ?? 0) + 1;
  }
  return out;
}

export function summarize(report, { source, rerunOf = null, git = null }) {
  const run = report.run;
  const tokens = { input: 0, output: 0 };
  let modelCalls = 0;
  const replay = { replayed: 0, total: 0 };
  for (const s of allSteps(report)) {
    modelCalls += s.metrics?.modelCalls ?? 0;
    if (s.cache) {
      replay.replayed += s.cache.replayedActions ?? 0;
      replay.total += s.cache.totalActions ?? 0;
    }
    for (const e of s.events ?? []) {
      if (e.kind !== 'model') continue;
      tokens.input += e.inputTokens ?? 0;
      tokens.output += e.outputTokens ?? 0;
    }
  }
  const finishedAt = run.finishedAt ?? null;
  return {
    runId: run.id,
    startedAt: run.startedAt,
    finishedAt,
    durationMs: finishedAt ? Date.parse(finishedAt) - Date.parse(run.startedAt) : null,
    browser: /^(chromium|firefox|webkit)$/.test(process.env.E2E_BROWSER ?? '') ? process.env.E2E_BROWSER : null, // run do dashboard chạy với trình duyệt đã chọn
    status: run.status,
    exitCode: run.exitCode ?? null,
    kind: run.explore ? 'explore' : 'run',
    summary: run.summary,
    tokens,
    errorClasses: errorClasses(report),
    runErrors: (run.errors ?? []).length,
    modelCalls,
    costUsd: run.usage?.estimatedCostUsd ?? null,
    replay,
    targets: (run.targets ?? []).map((t) => t.id),
    git: run.vcs
      ? { commit: run.vcs.commit, branch: run.vcs.branch ?? null, dirty: run.vcs.dirty ?? null }
      : git,
    source,
    rerunOf,
    pinned: false,
    baseline: false,
    schemaVersion: report.schemaVersion,
    reporterVersion: VERSION,
  };
}

// run.id and result ids come from report.json and end up in file names: only accept their documented shapes.
export const RUN_ID = /^[0-9a-f-]{8,}$/i;
export const RESULT_ID = /^[0-9a-f]{64}$/i;

export function runDirName(report) {
  return `${String(report.run.startedAt).replace(/[^0-9A-Za-z]/g, '-')}_${report.run.id}`;
}

// Bố cục run (v0.8.8): runs/YYYY/MM/DD/<HH-MM-SS-mmmZ>_<runId>/. Trước đó: runs/<YYYY-MM-DDTHH-MM-SS-mmmZ>_<runId>/
// (vẫn đọc được; `/e2e-dashboard doctor` chuyển sang bố cục mới). Đường dẫn trả về luôn dùng '/'.
const LEGACY_RUN = /^(\d{4})-(\d{2})-(\d{2})T([\w-]+_[0-9a-f-]{8,})$/i;
export const isLegacyRunName = (name) => LEGACY_RUN.test(name);
export function nestedFromLegacy(name) {
  const m = LEGACY_RUN.exec(name);
  return m ? `${m[1]}/${m[2]}/${m[3]}/${m[4]}` : null;
}
export function runRelPath(report) {
  return nestedFromLegacy(runDirName(report)) ?? runDirName(report);
}
// khoá sắp xếp chung cho hai bố cục: '2026/10/12/13-17-13-716Z_id' → '2026-10-12T13-17-13-716Z_id'
export const runSortKey = (rel) => rel.replace(/^(\d{4})\/(\d{2})\/(\d{2})\//, '$1-$2-$3T');

// mọi thư mục run (cả hai bố cục), mới nhất trước; bỏ symlink và thư mục tạm .tmp-*
export async function listRunDirs(runsDir, { sort = true } = {}) {
  const out = [];
  const dirs = async (p) => (await readdir(p, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
  for (const top of await dirs(runsDir)) {
    if (!/^\d{4}$/.test(top)) {
      out.push(top); // bố cục cũ: mọi thư mục ở cấp đầu không phải năm là một run
      continue;
    }
    for (const mo of (await dirs(join(runsDir, top))).filter((x) => /^\d{2}$/.test(x))) {
      for (const d of (await dirs(join(runsDir, top, mo))).filter((x) => /^\d{2}$/.test(x))) {
        for (const r of await dirs(join(runsDir, top, mo, d))) out.push(`${top}/${mo}/${d}/${r}`);
      }
    }
  }
  if (!sort) return out;
  const key = new Map(out.map((x) => [x, runSortKey(x)])); // khoá tính một lần, so sánh chuỗi thường (nhanh hơn localeCompare)
  return out.sort((a, b) => (key.get(a) < key.get(b) ? 1 : key.get(a) > key.get(b) ? -1 : 0));
}

// Bố cục .e2e-dashboard (v0.8.8): state/ dữ liệu lâu dài, runtime/ file tạm của server, cache/ chỉ mục (dựng lại được).
// config.json và server.json ở gốc (người dùng sửa tay / reporter bản cũ trong project tìm server qua đó).
export const STATE_FILES = new Set(['settings.json', 'triage.json', 'alerts.json', 'selfheal.json', 'events.json', 'coverage-ignore.json', 'ci-sync.json', 'quarantine.json', 'issues.json', 'qc-notes.json', 'qc-manual.json', 'longterm']);
export const RUNTIME_FILES = new Set(['live.json', 'server.log', 'selfheal-crash.jsonl']);
export function dataPath(root, rel) {
  const top = rel.split('/')[0];
  return join(root, DATA_DIR, ...(STATE_FILES.has(top) ? ['state'] : RUNTIME_FILES.has(top) ? ['runtime'] : []), rel);
}
// chưa chạy `/e2e-dashboard doctor`: file vẫn ở gốc .e2e-dashboard
export const legacyDataPath = (root, rel) => join(root, DATA_DIR, rel);

// bản đồng bộ (statusline, CLI): cùng quy tắc với listRunDirs
export function listRunDirsSync(runsDir) {
  const dirs = (p) => {
    try {
      return readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
    } catch {
      return [];
    }
  };
  const out = [];
  for (const top of dirs(runsDir)) {
    if (!/^\d{4}$/.test(top)) out.push(top);
    else for (const mo of dirs(join(runsDir, top)).filter((x) => /^\d{2}$/.test(x))) for (const d of dirs(join(runsDir, top, mo)).filter((x) => /^\d{2}$/.test(x))) for (const r of dirs(join(runsDir, top, mo, d))) out.push(`${top}/${mo}/${d}/${r}`);
  }
  return out.sort((a, b) => runSortKey(b).localeCompare(runSortKey(a)));
}

// sau khi xoá run: bỏ thư mục ngày / tháng / năm đã rỗng
export async function pruneEmptyParents(runsDir, rel) {
  const parts = rel.split('/');
  for (let i = parts.length - 1; i > 0; i--) {
    const dir = join(runsDir, ...parts.slice(0, i));
    if ((await readdir(dir).catch(() => ['x'])).length) return;
    await rmdir(dir).catch(() => {}); // rmdir: chỉ xoá được thư mục rỗng
  }
}

export function safeJoin(root, rel) {
  if (typeof rel !== 'string' || rel === '' || isAbsolute(rel)) return null;
  const base = resolve(root);
  const p = resolve(base, rel);
  const r = relative(base, p);
  return r && !r.startsWith('..') && !isAbsolute(r) ? p : null;
}

// The project may be a hostile clone: symlinks it planted must never redirect our reads or writes.
export function realInside(root, p) {
  try {
    const r = realpathSync(root);
    const q = realpathSync(p);
    return q.startsWith(r + sep);
  } catch {
    return false;
  }
}

export const isLink = (p) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

// Attempts of a result; serial-group members keep theirs on the group, not on the result.
export function resultAttempts(report, r) {
  if (r.attempts?.length) return r.attempts;
  const g = (report.run.serialGroups ?? []).find((x) =>
    r.serialGroupId
      ? x.id === r.serialGroupId
      : x.memberTestIds?.includes(r.testId) && x.targetId === r.targetId &&
        (x.agent ?? 'default') === (r.agent ?? 'default') && (x.repeat ?? 0) === (r.repeat ?? 0));
  return (g?.attempts ?? []).flatMap((ga) => (ga.members ?? []).filter((m) => m.testId === r.testId));
}

export function readConfig(projectRoot) {
  try {
    return JSON.parse(readFileSync(join(projectRoot, DATA_DIR, 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}

function gitInfo(cwd) {
  try {
    const git = (args) =>
      execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
    return { commit: git(['rev-parse', 'HEAD']), branch: git(['rev-parse', '--abbrev-ref', 'HEAD']), dirty: git(['status', '--porcelain']) !== '' };
  } catch {
    return null;
  }
}

// Attempts (normal + serial group) whose result did not pass, with their attempt- and step-level artifacts.
// With `screenshots: "all"` in the config, screenshots of passed results are kept too (a baseline for
// the visual diff); videos and other files of passed results never are.
// With `videos: "all"`, videos of passed results are kept too (side-by-side pass/fail playback).
function keptArtifacts(report, { allScreenshots = false, allVideos = false } = {}) {
  const out = [];
  const keepPassed = (x) => (allScreenshots && x?.kind === 'screenshot') || (allVideos && x?.kind === 'video');
  const take = (passed) => (a) => {
    const add = (list) => out.push(...(list ?? []).filter((x) => !passed || keepPassed(x)));
    add(a.artifacts);
    for (const s of a.steps ?? []) add(s.artifacts);
    for (const m of a.members ?? []) for (const s of m.steps ?? []) add(s.artifacts);
  };
  const any = allScreenshots || allVideos;
  for (const r of report.run.results ?? []) if (r.status !== 'passed' || any) (r.attempts ?? []).forEach(take(r.status === 'passed'));
  for (const g of report.run.serialGroups ?? []) if (g.status !== 'passed' || any) (g.attempts ?? []).forEach(take(g.status === 'passed'));
  return out;
}

async function copyInto(srcRoot, dstRoot, rel) {
  const src = safeJoin(srcRoot, rel);
  const dst = safeJoin(dstRoot, rel);
  if (!src || !dst || !realInside(srcRoot, src)) return false;
  await mkdir(dirname(dst), { recursive: true });
  await copyFile(src, dst);
  return true;
}

async function findFiles(dir, name, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await findFiles(p, name, out);
    else if (e.isFile() && e.name === name) out.push(p);
  }
  return out;
}

// resultId -> absolute trace.md path. Without an explicit map: e2e names each test's results
// directory `<slug>-<first 16 hex of result id>` (seen in e2e 0.19 and its docs); fall back to the
// result whose artifact paths live under the trace's directory.
async function resolveTraces(projectRoot, report, artRoot, traces) {
  const map = new Map();
  if (traces) {
    for (const [id, p] of traces instanceof Map ? traces : Object.entries(traces)) map.set(id, resolve(projectRoot, p));
    return map;
  }
  const found = await findFiles(artRoot, 'trace.md');
  for (const r of report.run.results ?? []) {
    const paths = (r.attempts ?? []).flatMap((a) => (a.artifacts ?? []).map((x) => x.path).filter(Boolean));
    const byId = typeof r.id === 'string' && found.find((t) => basename(dirname(t)).endsWith(`-${r.id.slice(0, 16)}`));
    const hit = byId || found.find((t) => {
      const dir = relative(artRoot, dirname(t)).split(sep).join('/');
      return paths.some((p) => p.startsWith(`${dir}/`));
    });
    if (hit && typeof r.id === 'string') map.set(r.id, hit);
  }
  return map;
}

const AI_TRACE_MAX = 30 * 1024 * 1024;

// `e2e run --ai-trace` writes {runs[], steps[]} next to report.json and overwrites it on every run: keep it only when
// it belongs to this run (its first model call started after the run did), is a regular file inside the project/output and is small enough.
async function readAiTrace(projectRoot, output, report, aiTracePath) {
  const file = aiTracePath ? resolve(projectRoot, aiTracePath) : join(output, 'ai-trace.json');
  try {
    if (isLink(file) || !(realInside(projectRoot, file) || realInside(output, file))) return null;
    const st = await stat(file);
    if (!st.isFile() || st.size > AI_TRACE_MAX) return null;
    const raw = await readFile(file, 'utf8');
    const doc = JSON.parse(raw);
    if (!Array.isArray(doc?.runs) || !Array.isArray(doc?.steps) || !doc.steps.length) return null;
    const first = Math.min(...doc.runs.map((r) => Date.parse(r?.started_at)).filter(Number.isFinite));
    if (!(first >= Date.parse(report.run.startedAt) - 5000)) return null;
    return { raw, runs: doc.runs.length, calls: doc.steps.length };
  } catch {
    return null;
  }
}

// Creates <project>/.e2e-dashboard (never through a planted symlink) and makes git ignore it.
export async function ensureDataDir(projectRoot) {
  const dataDir = join(projectRoot, DATA_DIR);
  if (isLink(dataDir)) return null;
  await mkdir(dataDir, { recursive: true });
  // run data holds page text and logs: keep it out of git even when nobody ran setup
  if (!existsSync(join(dataDir, '.gitignore'))) await writeFile(join(dataDir, '.gitignore'), '*\n');
  return dataDir;
}

export async function archive(projectRoot, { source, rerunOf = null, report, reportPath, artifactsRoot, traces, outputDir, keep, signal, aiTracePath } = {}) {
  const cfg = readConfig(projectRoot);
  const output = resolve(projectRoot, outputDir ?? cfg.output ?? '.e2e');
  if (!report) {
    try {
      report = JSON.parse(await readFile(reportPath ?? join(output, 'report.json'), 'utf8'));
    } catch (e) {
      return { status: 'skipped', reason: e.code === 'ENOENT' ? 'no-report' : 'unreadable' };
    }
  }
  if (report?.schemaVersion !== 'report-1' || !RUN_ID.test(report.run?.id ?? '')) return { status: 'skipped', reason: 'unsupported-schema' };

  const dataDir = await ensureDataDir(projectRoot);
  const runsDir = join(projectRoot, DATA_DIR, 'runs');
  if (!dataDir || isLink(runsDir)) return { status: 'skipped', reason: 'unsafe-path' };
  await mkdir(runsDir, { recursive: true });
  const name = runRelPath(report);
  const existing = (await listRunDirs(runsDir)).find((d) => d.endsWith(`_${report.run.id}`));
  if (existing) return { status: 'exists', runDir: join(runsDir, existing) };

  const artRoot = resolve(projectRoot, artifactsRoot ?? join(output, 'results'));
  const tmp = join(runsDir, `.tmp-${randomBytes(6).toString('hex')}`);
  const final = join(runsDir, name);
  await mkdir(tmp);
  const aborted = () => {
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { code: 'E2ED_ABORTED' });
  };
  try {
    aborted();
    await writeFile(join(tmp, 'report.json'), JSON.stringify(report));
    const traceMeta = {};
    // a committed `.e2e/results -> ~/.ssh` must not pull files from outside into runs/ (and share push)
    const artOk = !isLink(artRoot);
    for (const [id, abs] of await resolveTraces(projectRoot, report, artRoot, traces)) {
      if (!RESULT_ID.test(id) || !(realInside(projectRoot, abs) || (artOk && realInside(artRoot, abs)))) continue; // CI imports live outside the project
      await mkdir(join(tmp, 'traces'), { recursive: true });
      await copyFile(abs, join(tmp, 'traces', `${id}.md`));
      traceMeta[id] = `traces/${id}.md`;
    }
    const unredacted = new Set(); // videos and downloads e2e could not mask secrets in (redaction: "incomplete"); a hosted video (url) counts too
    for (const a of keptArtifacts(report, { allScreenshots: cfg.screenshots === 'all', allVideos: cfg.videos === 'all' })) {
      aborted();
      const copied = a.path && artOk && (await copyInto(artRoot, join(tmp, 'artifacts'), a.path));
      if (a.redaction === 'incomplete' && (copied || (!a.path && a.url))) unredacted.add(a.path ?? a.url);
    }
    aborted();
    const aiTrace = await readAiTrace(projectRoot, output, report, aiTracePath);
    if (aiTrace) await writeFile(join(tmp, 'ai-trace.json'), aiTrace.raw);
    const meta = { ...summarize(report, { source, rerunOf, git: report.run.vcs ? null : gitInfo(projectRoot) }), traces: traceMeta, ...(unredacted.size ? { unredacted: unredacted.size } : {}), ...(aiTrace ? { aiTrace: { runs: aiTrace.runs, calls: aiTrace.calls } } : {}) };
    await writeFile(join(tmp, 'meta.json'), JSON.stringify(meta, null, 2));
    // runs/YYYY/MM/DD: không cấp nào được là symlink (repo lạ có thể commit sẵn runs/2026 -> ~/)
    const segs = name.split('/').slice(0, -1);
    const unsafe = () => Object.assign(new Error('unsafe run path'), { code: 'E2ED_UNSAFE' });
    for (let i = 1; i <= segs.length; i++) if (isLink(join(runsDir, ...segs.slice(0, i)))) throw unsafe();
    const parent = dirname(final);
    await mkdir(parent, { recursive: true });
    if (!realInside(runsDir, parent) && parent !== runsDir) throw unsafe();
    await rename(tmp, final).catch(async (e) => {
      if (e.code !== 'ENOENT') throw e;
      await mkdir(parent, { recursive: true }); // retention vừa dọn thư mục ngày rỗng: tạo lại, thử một lần nữa
      await rename(tmp, final);
    });
  } catch (e) {
    await rm(tmp, { recursive: true, force: true });
    if (e.code === 'E2ED_ABORTED') return { status: 'skipped', reason: 'aborted' };
    if (e.code === 'E2ED_UNSAFE') return { status: 'skipped', reason: 'unsafe-path' };
    if (e.code === 'ENOTEMPTY' || e.code === 'EEXIST') return { status: 'exists', runDir: final };
    throw e;
  }
  await applyRetention(projectRoot, keep ?? cfg.retention ?? 50);
  return { status: 'archived', runDir: final };
}

// `keep`: a number of runs, or { keep, keepFailed } to hold failed runs longer than passed ones.
export async function applyRetention(projectRoot, keep = 50) {
  let keepFailed = null;
  if (keep && typeof keep === 'object') {
    keepFailed = Number.isInteger(keep.keepFailed) && keep.keepFailed >= 1 ? keep.keepFailed : null;
    keep = keep.keep;
  }
  if (!Number.isInteger(keep) || keep < 1) keep = 50; // config.json is repo-controlled
  const runsDir = join(projectRoot, DATA_DIR, 'runs');
  let all;
  try {
    all = await readdir(runsDir);
  } catch {
    return [];
  }
  // an archive killed mid-copy (hook timeout) leaves .tmp-*; anything older than 10 minutes is dead
  for (const n of all.filter((x) => x.startsWith('.tmp-'))) {
    const st = await stat(join(runsDir, n)).catch(() => null);
    if (st && Date.now() - st.mtimeMs > 600_000) await rm(join(runsDir, n), { recursive: true, force: true });
  }
  const names = await listRunDirs(runsDir); // cả bố cục cũ lẫn mới, mới nhất trước
  const removed = [];
  let kept = 0;
  let keptFailed = 0;
  for (const n of names) {
    let meta;
    try {
      meta = JSON.parse(await readFile(join(runsDir, n, 'meta.json'), 'utf8'));
    } catch {
      continue; // being written or removed by a concurrent archive
    }
    if (meta.pinned) continue;
    if (keepFailed && meta.status !== 'passed') {
      if (++keptFailed <= keepFailed) continue;
    } else if (++kept <= keep) continue;
    await rm(join(runsDir, n), { recursive: true, force: true });
    await pruneEmptyParents(runsDir, n);
    removed.push(n);
  }
  return removed;
}

export function readServerInfo(projectRoot) {
  try {
    const s = JSON.parse(readFileSync(join(projectRoot, DATA_DIR, 'server.json'), 'utf8'));
    // server.json is a file in the user's repo: only a real port and a plain token may reach a URL or header
    const ok = Number.isInteger(s.port) && s.port > 0 && s.port < 65536 && typeof s.token === 'string' && /^[A-Za-z0-9_-]+$/.test(s.token);
    return ok ? s : null;
  } catch {
    return null;
  }
}

export function createReporter({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  let server = null;
  const post = (event) => {
    if (!server) return;
    fetchImpl(`http://127.0.0.1:${server.port}/api/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-e2e-dashboard-token': server.token },
      body: JSON.stringify(event),
    }).catch(() => {
      server = null; // dashboard went away; stop trying for this run
    });
  };
  return {
    name: 'e2e-dashboard',
    onEvent(event) {
      if (env.CI) return;
      try {
        if (event?.type === 'run-started') server = readServerInfo(event.projectRoot);
        if (event) post(event);
      } catch {
        // onEvent must never throw: a throw quarantines the reporter
      }
    },
    async onRunFinished(run, signal) {
      if (env.CI || signal?.aborted) return;
      try {
        const res = await archive(run.projectRoot, {
          source: 'reporter',
          report: run.report,
          reportPath: run.reportPath,
          artifactsRoot: run.artifactsRoot,
          traces: run.traces,
          aiTracePath: run.aiTracePath,
          signal,
        });
        const s = server ?? readServerInfo(run.projectRoot);
        if (res.status !== 'skipped' && s) return [{ label: 'Dashboard', text: `http://127.0.0.1:${s.port}/#/run/${run.report.run.id}` }];
      } catch (e) {
        return [{ label: 'Dashboard', text: `archive failed: ${e.message}` }];
      }
    },
  };
}

export default createReporter();
