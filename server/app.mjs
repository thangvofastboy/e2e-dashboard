import { readFile, stat, lstat } from 'node:fs/promises';
import { createReadStream, readFileSync } from 'node:fs';
import { pipeline } from 'node:stream';
import { join, extname, basename, relative } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { safeJoin, realInside, readConfig, VERSION, RUN_ID, RESULT_ID, resultAttempts } from '../reporter/e2e-dashboard.reporter.mjs';
import { listRuns, getRun, findRunDir, setFlag, testHistory, getAi, writeAi, listAi, loadHistory } from './store.mjs';
import { flakyTests, compareRuns, groupErrors, costStats, slowSteps, routeMap, branchStats, compareBranches, locatorCandidates, traceToCode, testKey } from './analytics.mjs';
import { projectSummaries, forgetProject } from './projects.mjs';
import { issueDraft, claudePrompt, linearConfig, createLinear, readIssueLinks, saveIssueLink } from './linear.mjs';
import { healthScore } from '../ui/health.js';
import { search, anomalies, lintAgentSteps, LINT_RULES, modelStats, bisectPlan, flakyEvidence, testDetail, appErrors, setupTiming } from './insights.mjs';
import { changedFiles, impactedTests } from './impact.mjs';
import { appRoutes, coverageGaps } from './coverage.mjs';
import { runGate, sloConfig, sloHistory } from './gate.mjs';
import { environmentBreakdown, sloStatus } from './insights.mjs';
import { csvRuns, csvTests, csvFlaky } from './csv.mjs';
import { readChangelog } from './changelog.mjs';
import { storageUsage, pruneVideos, deleteRun } from './storage.mjs';
import { webhookConfig, sendWebhooks } from './webhook.mjs';
import { readCodeowners, ownersOf } from './owners.mjs';
import { readQuarantine, addQuarantine, removeQuarantine, quarantineFlags } from './quarantine.mjs';
import { buildDigest, flakyShare } from './digest.mjs';
import { importFromGithub } from './share.mjs';
import { createGithub, prCommentMarkdown } from './github.mjs';
import { buildPrompt, cacheKey, commitsBetween } from './ai.mjs';
import { estimateEta } from './live.mjs';
import { bundleUi } from '../ui/bundle.mjs';
import { buildExportHtml } from './export.mjs';
import { readSettings, writeSettings, autoWorkers } from './settings.mjs';
import { syncLongterm, readDays, daySeries, totals, reliability, lifecycle, dayKey } from './longterm.mjs';
import { syncTriage, triageBoard, updateTriage, TRIAGE_STATUSES } from './triage.mjs';
import { groupReport } from './groups.mjs';
import { traceMatrix, storyList } from './traceability.mjs';
import { addEvent, removeEvent, timeline, lastCommits, EVENT_KINDS } from './events.mjs';
import { releaseReport } from './release.mjs';
import { alertRules, readAlerts, describeRule } from './alerts.mjs';
import { ciConfig, readCiState } from './cisync.mjs';
import { buildReport, reportSchedule, readReportState, lastOccurrence, emailConfig } from './reports.mjs';
import { reportHtml } from './report-html.mjs';
import { siteDir } from './site.mjs';

const MAX_BODY = 1024 * 1024;
const FILE_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.webm': 'video/webm', '.mp4': 'video/mp4', '.json': 'application/json',
  '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8',
  '.html': 'text/plain; charset=utf-8', '.htm': 'text/plain; charset=utf-8', '.svg': 'text/plain; charset=utf-8',
};
const UI_CSP = "default-src 'self'; img-src 'self' data:; media-src 'self' https:; style-src 'self' 'unsafe-inline'";

const same = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
// one cookie per port: several project dashboards can be open at once
const cookieName = (req) => `e2ed_${req.socket.localPort}`;
const cookieToken = (req) =>
  (req.headers.cookie ?? '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === cookieName(req))?.[1];

function send(res, status, body, headers = {}) {
  const isText = typeof body === 'string';
  res.writeHead(status, { 'content-type': isText ? 'text/plain; charset=utf-8' : 'application/json', 'referrer-policy': 'no-referrer', ...headers });
  res.end(isText ? body : JSON.stringify(body));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

async function serveFile(req, res, path) {
  const st = await stat(path).catch(() => null);
  if (!st?.isFile()) return send(res, 404, 'not found');
  const headers = {
    'content-type': FILE_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
    'content-security-policy': 'sandbox',
    'referrer-policy': 'no-referrer',
  };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (m && (m[1] || m[2])) {
    const start = m[1] === '' ? Math.max(0, st.size - Number(m[2])) : Number(m[1]);
    const end = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
    if (start > end) return send(res, 416, '', { 'content-range': `bytes */${st.size}` });
    res.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${st.size}` });
    return pipeline(createReadStream(path, { start, end }), res, () => {}); // destroys the fd on abort, no crash if the file vanished
  }
  res.writeHead(200, { ...headers, 'content-length': st.size });
  pipeline(createReadStream(path), res, () => {});
}

function reporterStatus(projectRoot) {
  try {
    const src = readFileSync(join(projectRoot, 'e2e-dashboard.reporter.mjs'), 'utf8');
    return { installed: true, version: src.match(/VERSION = '([^']+)'/)?.[1] ?? null, latest: VERSION };
  } catch {
    return { installed: false, version: null, latest: VERSION };
  }
}

const NO_AI = { run: async ({ onEvent }) => onEvent({ type: 'error', message: 'AI chưa sẵn sàng trên server này.' }) };

function startSse(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
  return (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
}

// Commits since the test (or the run) last passed, for the AI prompt.
async function commitsFor(projectRoot, run, action, resultId) {
  const to = run.meta.git?.commit;
  if (!to) return [];
  const metas = await listRuns(projectRoot);
  const i = metas.findIndex((m) => m.runId === run.meta.runId);
  const older = metas.slice(i + 1, i + 21);
  if (action === 'analyze-run') return commitsBetween(projectRoot, older[0]?.git?.commit, to);
  const r = (run.report.run.results ?? []).find((x) => x.id === resultId);
  const ids = new Set(older.map((m) => m.runId));
  for (const { meta: m, report } of (await loadHistory(projectRoot, i + 21)).filter((h) => ids.has(h.meta.runId))) {
    const same = report.run.results?.find((x) => x.testId === r.testId && x.targetId === r.targetId && (x.agent ?? 'default') === (r.agent ?? 'default'));
    if (same?.status === 'passed') return commitsBetween(projectRoot, m.git?.commit, to);
  }
  return [];
}

// ?n= for the analyses: how many recent runs to look at.
const runCount = (url, def = 30) => {
  const n = Number.parseInt(url.searchParams.get('n') ?? '', 10);
  return Number.isInteger(n) ? Math.max(2, Math.min(200, n)) : def;
};

// The e2e replay cache entry a step used (`.e2e/cache/<entry>.json`, trace-1), read-only and only
// from inside the project.
export async function readCacheEntry(projectRoot, entry, cfg = readConfig(projectRoot)) {
  if (!/^[0-9a-f]{64}$/.test(entry ?? '')) return null;
  const dir = safeJoin(projectRoot, typeof cfg.cacheDir === 'string' ? cfg.cacheDir : `${typeof cfg.output === 'string' ? cfg.output : '.e2e'}/cache`);
  const file = dir && safeJoin(dir, `${entry}.json`);
  const st = file && (await lstat(file).catch(() => null));
  if (!st?.isFile() || st.size > 1024 * 1024 || !realInside(projectRoot, file)) return null;
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

// A compact text picture of the suite for the free-form AI question.
async function askContext(projectRoot) {
  const history = await loadHistory(projectRoot, 30);
  const fmt = (ms) => (ms == null ? '?' : `${Math.round(ms / 1000)}s`);
  const lines = ['Các run gần nhất (mới → cũ):'];
  for (const { meta } of history.slice(0, 20)) {
    const s = meta.summary ?? {};
    lines.push(`- ${meta.startedAt} ${meta.runId.slice(-8)} ${meta.git?.branch ?? '?'}@${String(meta.git?.commit ?? '').slice(0, 7)} ${meta.status} pass ${s.passed ?? 0} flaky ${s.flaky ?? 0} fail ${s.failed ?? 0} skip ${s.skipped ?? 0} · ${fmt(meta.durationMs)} · ${(meta.tokens?.input ?? 0) + (meta.tokens?.output ?? 0)} tok`);
  }
  lines.push('', 'Test flaky:', ...flakyTests(history).slice(0, 10).map((t) => `- ${t.title} [${t.target}] điểm ${t.score}, flaky ${t.flaky}, đổi kết quả ${t.flips}/${t.runs} run`));
  lines.push('', 'Nhóm lỗi:', ...groupErrors(history).slice(0, 10).map((g) => `- ${g.code}: ${g.message.slice(0, 160)} (${g.tests.length} test, ${g.count} lần, gần nhất ${g.lastSeen})`));
  lines.push('', 'Lỗi phía app:', ...appErrors(history).slice(0, 8).map((g) => `- [${g.source}/${g.level}] ${g.signature} (${g.runs} run)`));
  lines.push('', 'Bất thường ở run mới nhất:', ...anomalies(history).slice(0, 5).map((a) => `- ${a.title}: ${a.label} ${a.value} (TB ${a.mean})`));
  const c = costStats(history);
  lines.push('', `Chi phí: TB ${c.totals.avgTokens} token/run, replay cache ${c.cache.replayed}/${c.cache.replayed + c.cache.handedOff + c.cache.missed} step agent.act`);
  const q = quarantineFlags(await readQuarantine(projectRoot));
  if (q.active.length) lines.push('', 'Test đang cách ly:', ...q.active.map((x) => `- ${x.title} đến ${x.until.slice(0, 10)}`));
  return lines.join('\n');
}

const IDLE_RUNNER = { start: () => ({ ok: false, error: 'unavailable' }), stop: () => false, state: () => ({ running: false, pid: null }) };

export function createApp({ projectRoot, token, uiDir, live, onEvent = () => {}, lastArchive = () => null, runner = IDLE_RUNNER, ai = NO_AI, env = process.env, linearFetch, github = createGithub({ projectRoot }), ghImport = importFromGithub, automation = null, tracking = null }) {
  let avgByKey = new Map();
  const refreshAverages = () =>
    testHistory(projectRoot, 10)
      .then((rows) => {
        avgByKey = new Map(rows.filter((r) => r.avgDurationMs != null).map((r) => [r.key, r.avgDurationMs]));
      })
      .catch(() => {});
  refreshAverages();
  const withEta = (s) => ({ ...s, etaMs: estimateEta(s, avgByKey) });

  // one ETA + JSON.stringify per live snapshot, shared by every open tab
  const frames = new WeakMap();
  const sseFrame = (s) => {
    if (!frames.has(s)) frames.set(s, `data: ${JSON.stringify(withEta(s))}\n\n`);
    return frames.get(s);
  };

  async function route(req, res) {
    const url = new URL(req.url, 'http://local');
    const port = req.socket.localPort;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) return send(res, 403, 'bad host');

    const urlToken = url.searchParams.get('token');
    if (urlToken !== null) {
      if (!same(urlToken, token)) return send(res, 401, 'token sai');
      res.writeHead(302, { 'set-cookie': `${cookieName(req)}=${token}; HttpOnly; SameSite=Strict; Path=/`, location: url.pathname, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      return res.end();
    }
    if (!same(req.headers['x-e2e-dashboard-token'], token) && !same(cookieToken(req), token))
      return send(res, 401, 'Mở dashboard bằng lệnh /e2e-dashboard trong Claude Code.');
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)
      return send(res, 403, 'bad origin');

    const p = url.pathname;
    const ui = { 'content-security-policy': UI_CSP, 'cache-control': 'no-store' };
    if (req.method === 'GET') {
      if (p === '/') return send(res, 200, await readFile(join(uiDir, 'index.html'), 'utf8'), { ...ui, 'content-type': 'text/html; charset=utf-8' });
      if (p === '/app.js') return send(res, 200, await bundleUi(uiDir), { ...ui, 'content-type': 'text/javascript; charset=utf-8' });
      if (p === '/style.css') return send(res, 200, await readFile(join(uiDir, 'style.css'), 'utf8'), { ...ui, 'content-type': 'text/css; charset=utf-8' });
      if (p === '/api/settings') return send(res, 200, { ...(await readSettings(projectRoot)), autoWorkers: autoWorkers() });
      if (p === '/api/info') return send(res, 200, { version: VERSION, pid: process.pid, project: basename(projectRoot), reporter: reporterStatus(projectRoot), lastArchive: lastArchive(), thresholds: readConfig(projectRoot).thresholds ?? null, runner: runner.state() });
      if (p === '/api/runs') return send(res, 200, await listRuns(projectRoot));
      if (p === '/api/tests') return send(res, 200, await testHistory(projectRoot, 10));
      if (p === '/api/live') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        const write = (s) => res.write(sseFrame(s));
        write(live.snapshot());
        const off = live.subscribe(write);
        const beat = setInterval(() => res.write(': ping\n\n'), 15_000);
        req.on('close', () => {
          off();
          clearInterval(beat);
        });
        return;
      }
      if (p === '/api/health') {
        const history = (await loadHistory(projectRoot, 30)).filter((h) => h.meta.kind !== 'explore').slice(0, 20);
        const flaky = flakyTests(history);
        return send(res, 200, { health: healthScore(history.map((h) => h.meta), { flakyShare: flakyShare(history, flaky) }) });
      }
      if (p === '/api/flaky') return send(res, 200, { tests: flakyTests(await loadHistory(projectRoot, runCount(url))) });
      if (p === '/api/compare') {
        const [a, b] = await Promise.all([getRun(projectRoot, url.searchParams.get('a')), getRun(projectRoot, url.searchParams.get('b'))]);
        if (!a || !b) return send(res, 404, { error: 'run not found' });
        const out = compareRuns(a, b);
        return send(res, 200, { ...out, traces: { a: a.meta.traces ?? {}, b: b.meta.traces ?? {} } });
      }
      if (p === '/api/errors') {
        const runId = url.searchParams.get('runId');
        if (runId) {
          const run = await getRun(projectRoot, runId);
          return run ? send(res, 200, { groups: groupErrors([run]) }) : send(res, 404, { error: 'run not found' });
        }
        return send(res, 200, { groups: groupErrors(await loadHistory(projectRoot, runCount(url))) });
      }
      if (p === '/api/cost') {
        const cfg = readConfig(projectRoot);
        const history = await loadHistory(projectRoot, runCount(url));
        return send(res, 200, { ...costStats(history, { pricing: cfg.pricing, budget: cfg.budget }), slowSteps: slowSteps(history) });
      }
      if (p === '/api/routes') return send(res, 200, routeMap(await loadHistory(projectRoot, runCount(url))));
      if (p === '/api/branches') return send(res, 200, { branches: branchStats(await listRuns(projectRoot)) });
      if (p === '/api/branches/compare') {
        const a = url.searchParams.get('a');
        const b = url.searchParams.get('b');
        if (!a || !b) return send(res, 400, { error: 'a and b are required' });
        return send(res, 200, compareBranches(await loadHistory(projectRoot, 100), a, b));
      }
      if (p === '/api/projects') return send(res, 200, { projects: await projectSummaries(projectRoot, env) });
      if (p === '/api/digest') {
        const days = Math.max(1, Math.min(90, Number.parseInt(url.searchParams.get('days') ?? '7', 10) || 7));
        return send(res, 200, await buildDigest(projectRoot, { days }));
      }
      if (p === '/api/test') {
        const key = String(url.searchParams.get('key') ?? '');
        const d = testDetail(await loadHistory(projectRoot, 60), key);
        if (!d) return send(res, 404, { error: 'test not found' });
        const flaky = flakyTests(await loadHistory(projectRoot, 30)).find((f) => f.key === key) ?? null;
        const q = (await readQuarantine(projectRoot)).find((x) => x.key === key) ?? null;
        return send(res, 200, { ...d, owners: ownersOf(readCodeowners(projectRoot).rules, d.file), flaky: flaky && { score: flaky.score, flaky: flaky.flaky, flips: flaky.flips }, quarantine: q });
      }
      if (p === '/api/app-errors') return send(res, 200, { groups: appErrors(await loadHistory(projectRoot, runCount(url))) });
      if (p === '/api/timing') return send(res, 200, setupTiming(await loadHistory(projectRoot, runCount(url))));
      if (p === '/api/impact') {
        const base = url.searchParams.get('base') || 'main';
        let files;
        try {
          files = await changedFiles(projectRoot, base);
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
        if (!files) return send(res, 200, { base, files: [], tests: [], error: 'Không đọc được git diff (không phải repo git, hoặc không có nhánh này).' });
        return send(res, 200, { base, files, tests: impactedTests(await loadHistory(projectRoot, 10), files) });
      }
      if (p === '/api/storage') return send(res, 200, await storageUsage(projectRoot));
      if (p === '/api/automation') return send(res, 200, { ...(automation?.state() ?? { schedule: null, watch: { enabled: false, supported: false } }), webhooks: (await webhookConfig(env)).map((w) => ({ host: new URL(w.url).host, events: w.events })) });
      if (p === '/api/coverage') {
        const cfg = readConfig(projectRoot);
        const routes = await appRoutes(projectRoot, Array.isArray(cfg.coverage?.routes) ? cfg.coverage.routes : []);
        return send(res, 200, coverageGaps(routes, routeMap(await loadHistory(projectRoot, runCount(url))), { ignore: Array.isArray(cfg.coverage?.ignore) ? cfg.coverage.ignore : [] }));
      }
      if (p === '/api/environment') return send(res, 200, environmentBreakdown(await loadHistory(projectRoot, runCount(url))));
      if (p === '/api/slo') {
        const c = sloConfig(readConfig(projectRoot));
        return send(res, 200, sloStatus(await sloHistory(projectRoot, c.days), c));
      }
      if (p === '/api/gate') return send(res, 200, await runGate(projectRoot));
      if (p === '/api/changelog') return send(res, 200, { version: VERSION, entries: await readChangelog() });
      // ---- M7: tracking & reporting
      const DAY = 86_400_000;
      const spanDays = (def = 90) => {
        const d = Number.parseInt(url.searchParams.get('days') ?? '', 10);
        return Number.isInteger(d) ? Math.max(7, Math.min(730, d)) : def;
      };
      const ownersFn = () => {
        const { rules } = readCodeowners(projectRoot);
        return rules.length ? (f) => ownersOf(rules, f) : null;
      };
      if (p === '/api/trends') {
        const days = spanDays(90);
        const cfg = readConfig(projectRoot);
        const { index } = await syncLongterm(projectRoot);
        const now = Date.now();
        const series = daySeries(await readDays(projectRoot, { from: now - (days - 1) * DAY, to: now }));
        const prev = daySeries(await readDays(projectRoot, { from: now - (2 * days - 1) * DAY, to: now - days * DAY }));
        const calendar = daySeries(await readDays(projectRoot, { from: now - 364 * DAY, to: now }));
        const events = (await timeline(projectRoot, { from: now - 364 * DAY, to: now })).map((e) => ({ ...e, date: dayKey(Date.parse(e.at)) }));
        const runs = Object.keys(index.seen).length;
        return send(res, 200, { days, series, current: totals(series), previous: totals(prev), calendar, events, reliability: reliability(index, { days, now, branch: typeof cfg.mainBranch === 'string' ? cfg.mainBranch : null }), trackedRuns: runs, since: Object.values(index.seen).sort()[0] ?? null });
      }
      if (p === '/api/reliability') {
        const { index } = await syncLongterm(projectRoot);
        return send(res, 200, reliability(index, { days: spanDays(30) }));
      }
      if (p === '/api/lifecycle') {
        const { index } = await syncLongterm(projectRoot);
        const life = lifecycle(index, { days: spanDays(30) });
        const now = Date.now();
        const sizes = daySeries(await readDays(projectRoot, { from: now - 179 * DAY, to: now })).map((d) => ({ date: d.date, tests: d.runs ? d.tests : null }));
        const commits = url.searchParams.get('git') === '0' ? {} : await lastCommits(projectRoot, life.tests.map((t) => t.file));
        return send(res, 200, { ...life, sizes, commits });
      }
      if (p === '/api/triage') {
        const history = await loadHistory(projectRoot, 60);
        const { entries, failing } = await syncTriage(projectRoot, history);
        return send(res, 200, { ...triageBoard({ entries, failing, links: await readIssueLinks(projectRoot), ownersOf: ownersFn() }), statuses: TRIAGE_STATUSES });
      }
      if (p === '/api/groups') {
        const by = ['module', 'tag', 'owner'].includes(url.searchParams.get('by')) ? url.searchParams.get('by') : 'module';
        return send(res, 200, groupReport(await loadHistory(projectRoot, runCount(url)), { by, modules: readConfig(projectRoot).modules, ownersOf: ownersFn() }));
      }
      if (p === '/api/traceability') return send(res, 200, traceMatrix(await loadHistory(projectRoot, runCount(url)), { stories: storyList(readConfig(projectRoot)) }));
      if (p === '/api/timeline') {
        const days = spanDays(365);
        return send(res, 200, { kinds: EVENT_KINDS, events: await timeline(projectRoot, { from: Date.now() - days * DAY }) });
      }
      if (p === '/api/release') {
        const cfg = readConfig(projectRoot);
        const { entries, failing } = await syncTriage(projectRoot, await loadHistory(projectRoot, 60));
        const open = triageBoard({ entries, failing }).rows.filter((r) => r.status === 'new' || r.status === 'investigating').length;
        return send(res, 200, await releaseReport(projectRoot, { from: url.searchParams.get('from') || null, to: url.searchParams.get('to') || null, slo: sloConfig(cfg).target, openTriage: open }));
      }
      if (p === '/api/alerts') {
        const rules = alertRules(readConfig(projectRoot));
        const st = await readAlerts(projectRoot);
        return send(res, 200, { rules: rules.map((r) => ({ ...r, description: describeRule(r) })), active: Object.entries(st.active).map(([id, a]) => ({ id, ...a })), log: st.log.slice(-50).reverse(), configured: Array.isArray(readConfig(projectRoot).alerts) });
      }
      if (p === '/api/ci') {
        const c = ciConfig(readConfig(projectRoot));
        const st = await readCiState(projectRoot);
        return send(res, 200, { config: c, state: { lastSync: st.lastSync, lastError: st.lastError, lastImported: st.lastImported, recent: Object.entries(st.imported).sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, 10).map(([id, x]) => ({ id: Number(id), ...x })) }, timer: tracking?.ci?.state() ?? null });
      }
      if (p === '/api/reports') {
        const cfg = readConfig(projectRoot);
        const schedule = reportSchedule(cfg);
        const st = await readReportState(projectRoot);
        const next = (spec, kind) => {
          if (!spec) return null;
          const last = lastOccurrence(spec, kind);
          const d = new Date(last);
          if (kind === 'weekly') d.setDate(d.getDate() + 7);
          else d.setMonth(d.getMonth() + 1);
          return d.toISOString();
        };
        const mail = await emailConfig(env);
        return send(res, 200, { schedule, next: { weekly: next(schedule.weekly, 'weekly'), monthly: next(schedule.monthly, 'monthly') }, sent: st.sent, log: st.log.slice(-20).reverse(), webhooks: (await webhookConfig(env)).filter((w) => w.events.includes('report') || w.events.includes('*')).map((w) => new URL(w.url).host), email: mail ? { to: mail.to.length } : null, siteDir: await siteDir(projectRoot, null, env) });
      }
      const rep = /^\/api\/reports\/(week|month)\.(json|html)$/.exec(p);
      if (rep) {
        const data = await buildReport(projectRoot, { kind: rep[1] });
        if (rep[2] === 'json') return send(res, 200, data);
        return send(res, 200, reportHtml(data), { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:", 'x-content-type-options': 'nosniff' });
      }
      const csv = /^\/api\/export\/(runs|tests|flaky)\.csv$/.exec(p);
      if (csv) {
        const n = runCount(url, 100);
        const body = csv[1] === 'runs' ? csvRuns(await listRuns(projectRoot)) : csv[1] === 'tests' ? csvTests(await testHistory(projectRoot, Math.min(n, 30))) : csvFlaky(flakyTests(await loadHistory(projectRoot, n)));
        return send(res, 200, body, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="e2e-${csv[1]}.csv"` });
      }
      if (p === '/api/search') {
        const q = String(url.searchParams.get('q') ?? '').slice(0, 200);
        return send(res, 200, { hits: q.trim() ? search(await loadHistory(projectRoot, 50), q) : [] });
      }
      if (p === '/api/anomalies') {
        const runId = url.searchParams.get('runId');
        return send(res, 200, { anomalies: anomalies(await loadHistory(projectRoot, 60), { runId: runId && RUN_ID.test(runId) ? runId : null }) });
      }
      if (p === '/api/lint') return send(res, 200, { findings: lintAgentSteps(await loadHistory(projectRoot, runCount(url))), rules: LINT_RULES });
      if (p === '/api/models') return send(res, 200, modelStats(await loadHistory(projectRoot, runCount(url)), { budget: readConfig(projectRoot).budget }));
      if (p === '/api/bisect') {
        const plan = bisectPlan(await loadHistory(projectRoot, 100), url.searchParams.get('runId'), url.searchParams.get('resultId'));
        return plan ? send(res, 200, plan) : send(res, 404, { error: 'result not found' });
      }
      if (p === '/api/owners') {
        const { file, rules } = readCodeowners(projectRoot);
        const files = String(url.searchParams.get('files') ?? '').split(',').filter(Boolean).slice(0, 200);
        return send(res, 200, { file, owners: Object.fromEntries(files.map((f) => [f, ownersOf(rules, f)])) });
      }
      if (p === '/api/quarantine') {
        const list = await readQuarantine(projectRoot);
        const flags = quarantineFlags(list);
        return send(res, 200, { list, active: flags.active.map((q) => q.key), expired: flags.expired.map((q) => q.key), command: flags.command, args: flags.args });
      }
      if (p === '/api/locators') {
        const cfg = readConfig(projectRoot);
        const out = [];
        for (const c of locatorCandidates(await loadHistory(projectRoot, runCount(url)))) {
          const entry = c.entry ? await readCacheEntry(projectRoot, c.entry, cfg) : null;
          out.push({ ...c, suggestion: entry ? traceToCode(entry) : null });
        }
        return send(res, 200, { candidates: out });
      }
      if (p === '/api/linear') {
        const { apiKey, team } = await linearConfig(readConfig(projectRoot), env);
        return send(res, 200, { configured: Boolean(apiKey), team, links: await readIssueLinks(projectRoot) });
      }
      const aiList = /^\/api\/runs\/([^/]+)\/ai$/.exec(p);
      if (aiList) {
        const entries = await listAi(projectRoot, aiList[1]);
        return entries ? send(res, 200, { entries }) : send(res, 404, { error: 'run not found' });
      }
      const ex = /^\/api\/runs\/([^/]+)\/export$/.exec(p);
      if (ex) {
        const out = await buildExportHtml(projectRoot, ex[1]);
        if (!out) return send(res, 404, { error: 'run not found' });
        return send(res, 200, out.html, {
          'content-type': 'text/html; charset=utf-8',
          'content-disposition': `attachment; filename="e2e-run-${out.runId}.html"`,
        });
      }
      let m = /^\/api\/runs\/([^/]+)$/.exec(p);
      if (m) {
        const run = await getRun(projectRoot, m[1]);
        return run ? send(res, 200, { meta: run.meta, report: run.report }) : send(res, 404, { error: 'run not found' });
      }
      m = /^\/files\/runs\/([^/]+)\/(.+)$/.exec(p);
      if (m) {
        const dir = await findRunDir(projectRoot, m[1]);
        let rel;
        try {
          rel = decodeURIComponent(m[2]);
        } catch {
          return send(res, 404, 'not found');
        }
        const file = dir && safeJoin(dir, rel);
        return file && realInside(dir, file) ? serveFile(req, res, file) : send(res, 404, 'not found');
      }
    }
    if (req.method === 'POST') {
      if (p === '/api/events') {
        const event = await readBody(req);
        live.apply(event);
        if (event?.type === 'run-started') refreshAverages();
        onEvent(event);
        res.writeHead(204);
        return res.end();
      }
      if (p.startsWith('/api/ai/')) {
        const action = /^\/api\/ai\/(analyze-failure|analyze-run|suggest-locator|why-flaky|explore-to-test|route-test|ask|followup)$/.exec(p)?.[1];
        if (!action) return send(res, 404, { error: 'unknown action' });
        const body = await readBody(req);
        // a question about the whole suite, or a follow-up in an existing session, needs no run
        const run = action === 'ask' || action === 'followup' || action === 'route-test' ? { meta: { runId: null }, report: null, dir: projectRoot } : await getRun(projectRoot, body.runId);
        if (!run) return send(res, 404, { error: 'run not found' });
        const ac = new AbortController();
        res.on('close', () => !res.writableEnded && ac.abort()); // tab closed → never start or keep claude
        let prompt;
        let resume;
        let key = null;
        if (action === 'route-test') {
          if (typeof body.route !== 'string' || !/^\/[\w\-./:]{0,300}$/.test(body.route)) return send(res, 400, { error: 'invalid route' });
          const routes = await appRoutes(projectRoot);
          if (!routes.has(body.route)) return send(res, 404, { error: 'route not found' });
          prompt = buildPrompt('route-test', { route: body.route, source: routes.get(body.route), language: readConfig(projectRoot).ai?.language });
        } else if (action === 'ask') {
          if (typeof body.question !== 'string' || !body.question.trim() || body.question.length > 4000) return send(res, 400, { error: 'invalid question' });
          prompt = buildPrompt('ask', { context: await askContext(projectRoot), question: body.question, language: readConfig(projectRoot).ai?.language });
        } else if (action === 'followup') {
          const ok = typeof body.sessionId === 'string' && /^[\w-]{1,100}$/.test(body.sessionId) && typeof body.question === 'string' && body.question.trim() && body.question.length <= 4000;
          if (!ok) return send(res, 400, { error: 'invalid follow-up' });
          prompt = body.question;
          resume = body.sessionId;
        } else {
          const perResult = action === 'analyze-failure' || action === 'suggest-locator' || action === 'why-flaky';
          if (perResult && !RESULT_ID.test(String(body.resultId ?? ''))) return send(res, 400, { error: 'invalid resultId' });
          const result = perResult && (run.report.run.results ?? []).find((r) => r.id === body.resultId);
          if (perResult && !result) return send(res, 404, { error: 'result not found' });
          let draft = '';
          if (action === 'suggest-locator') {
            if (!Number.isInteger(body.stepIndex) || body.stepIndex < 0 || body.stepIndex > 10_000) return send(res, 400, { error: 'invalid stepIndex' });
            const step = resultAttempts(run.report, result).flatMap((a) => a.steps ?? []).find((s) => s.index === body.stepIndex);
            if (!step) return send(res, 404, { error: 'step not found' });
            const entry = await readCacheEntry(projectRoot, step.cache?.entry);
            draft = (entry && traceToCode(entry)?.code) || '';
          }
          let evidence = null;
          let newest = '';
          if (action === 'why-flaky') {
            // the answer depends on the history, so the cache key follows the newest run too
            const history = await loadHistory(projectRoot, 60);
            evidence = flakyEvidence(history, testKey(result));
            newest = history[0]?.meta.runId ?? '';
          }
          key = cacheKey(action, run.meta.runId, action === 'suggest-locator' ? `${body.resultId}:${body.stepIndex}` : action === 'why-flaky' ? `${body.resultId}:${newest}` : perResult ? body.resultId : '');
          const cached = body.refresh ? null : await getAi(projectRoot, run.meta.runId, key);
          if (cached) {
            const write = startSse(res);
            write({ type: 'cached', ...cached });
            write({ type: 'done', cached: true });
            return res.end();
          }
          if (action === 'explore-to-test' && !run.report.run.explore) return send(res, 400, { error: 'not an explore run' });
          const commits = action === 'suggest-locator' || action === 'why-flaky' || action === 'explore-to-test' ? [] : await commitsFor(projectRoot, run, action, body.resultId);
          prompt = buildPrompt(action, { report: run.report, meta: run.meta, resultId: body.resultId, runDir: relative(projectRoot, run.dir), commits, language: readConfig(projectRoot).ai?.language, stepIndex: body.stepIndex, draft, evidence });
        }
        if (ac.signal.aborted) return res.end();
        const write = startSse(res);
        let text = '';
        let final = null;
        await ai.run({
          prompt,
          resume,
          signal: ac.signal,
          onEvent: (e) => {
            if (e.type === 'text') text += `${e.text}\n`;
            if (e.type === 'done' && !e.isError) final = e.result || text;
            write(e);
          },
        });
        if (key && final) await writeAi(projectRoot, run.meta.runId, key, { action, resultId: body.resultId ?? null, markdown: final, createdAt: new Date().toISOString() });
        return res.end();
      }
      if (p === '/api/linear/draft' || p === '/api/linear/issue') {
        const body = await readBody(req);
        const run = await getRun(projectRoot, body.runId);
        if (!run) return send(res, 404, { error: 'run not found' });
        if (!RESULT_ID.test(String(body.resultId ?? '')) || !(run.report.run.results ?? []).some((r) => r.id === body.resultId)) return send(res, 404, { error: 'result not found' });
        const cfg = readConfig(projectRoot);
        const saved = await getAi(projectRoot, run.meta.runId, cacheKey('analyze-failure', run.meta.runId, body.resultId));
        const draft = issueDraft({ meta: run.meta, report: run.report, resultId: body.resultId, commits: await commitsFor(projectRoot, run, 'analyze-failure', body.resultId), analysis: saved?.markdown ?? null, project: basename(projectRoot), owners: ownersOf(readCodeowners(projectRoot).rules, (run.report.run.results ?? []).find((r) => r.id === body.resultId)?.source?.file) });
        const { apiKey, team } = await linearConfig(cfg, env);
        const links = await readIssueLinks(projectRoot);
        if (p === '/api/linear/draft') return send(res, 200, { draft, prompt: claudePrompt(draft, team), configured: Boolean(apiKey), team, link: links[draft.fingerprint] ?? null });
        if (!apiKey) return send(res, 400, { error: 'Chưa cấu hình LINEAR_API_KEY: dùng nút "Copy cho Claude" để gửi qua Linear MCP.', prompt: claudePrompt(draft, team) });
        const linear = createLinear({ apiKey, team, ...(linearFetch ? { fetchImpl: linearFetch } : {}) });
        const found = await linear.find(draft.fingerprint);
        if (found.open) {
          if (body.mode !== 'comment') return send(res, 200, { status: 'duplicate', issue: found.open, fingerprint: draft.fingerprint });
          const where = run.meta.git?.commit ? ` trên \`${run.meta.git.branch ?? '?'}@${String(run.meta.git.commit).slice(0, 10)}\`` : '';
          await linear.comment(found.open.id, `Lỗi xảy ra lại ở run \`${run.meta.runId}\` (${run.meta.startedAt})${where}.`);
          await saveIssueLink(projectRoot, draft.fingerprint, found.open);
          return send(res, 200, { status: 'commented', issue: found.open, fingerprint: draft.fingerprint });
        }
        const old = found.closed[0];
        const issue = await linear.create(old ? { ...draft, description: `Tái phát của ${old.identifier} (đã đóng).\n\n${draft.description}` } : draft);
        await saveIssueLink(projectRoot, draft.fingerprint, issue);
        return send(res, 201, { status: 'created', issue, reopenedFrom: old?.identifier ?? null, fingerprint: draft.fingerprint });
      }
      if (p === '/api/triage') {
        const body = await readBody(req);
        try {
          return send(res, 200, await updateTriage(projectRoot, body.fp, { status: body.status, assignee: body.assignee, note: body.note }, body.row && typeof body.row === 'object' ? body.row : {}));
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
      }
      if (p === '/api/timeline' || p === '/api/timeline/remove') {
        const body = await readBody(req);
        if (p === '/api/timeline/remove') return send(res, 200, { removed: await removeEvent(projectRoot, String(body.id ?? '')) });
        try {
          return send(res, 201, await addEvent(projectRoot, { kind: body.kind, label: body.label, at: body.at, url: body.url }));
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
      }
      if (p === '/api/ci/sync') {
        if (!tracking?.ci || !ciConfig(readConfig(projectRoot))) return send(res, 400, { error: 'Chưa cấu hình "ci": { "github": { "workflow": … } } trong .e2e-dashboard/config.json.' });
        return send(res, 200, await tracking.ci.now());
      }
      if (p === '/api/reports/send') {
        const { kind } = await readBody(req);
        if (kind !== 'weekly' && kind !== 'monthly') return send(res, 400, { error: 'kind phải là weekly hoặc monthly' });
        if (!tracking?.sendReport) return send(res, 503, { error: 'unavailable' });
        return send(res, 200, await tracking.sendReport(kind));
      }
      if (p === '/api/publish') {
        if (!tracking?.publish) return send(res, 503, { error: 'unavailable' });
        try {
          return send(res, 200, await tracking.publish());
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
      }
      if (p === '/api/storage/prune') {
        const { days } = await readBody(req);
        try {
          return send(res, 200, await pruneVideos(projectRoot, days));
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
      }
      const del = /^\/api\/runs\/([^/]+)\/delete$/.exec(p);
      if (del) {
        if (!RUN_ID.test(del[1])) return send(res, 400, { error: 'invalid run id' });
        const out = await deleteRun(projectRoot, del[1]);
        return send(res, out.deleted ? 200 : out.reason === 'not-found' ? 404 : 409, out);
      }
      if (p === '/api/settings') {
        const { workers } = await readBody(req);
        return send(res, 200, { ...(await writeSettings(projectRoot, { workers })), autoWorkers: autoWorkers() });
      }
      if (p === '/api/watch') {
        const { enabled } = await readBody(req);
        if (!automation) return send(res, 503, { error: 'unavailable' });
        return send(res, 200, automation.setWatch(Boolean(enabled)));
      }
      if (p === '/api/webhook/test') {
        const hooks = await webhookConfig(env);
        if (!hooks.length) return send(res, 400, { error: 'Chưa có webhook: thêm "webhooks" vào ~/.e2e-dashboard/config.json hoặc đặt E2E_DASHBOARD_WEBHOOK.' });
        return send(res, 200, { sent: await sendWebhooks(hooks.map((h) => ({ ...h, events: ['*'] })), 'test', `🧪 e2e-dashboard (${basename(projectRoot)}): webhook hoạt động.`) });
      }
      if (p === '/api/github/status') {
        const { runId } = await readBody(req);
        const run = await getRun(projectRoot, runId);
        if (!run) return send(res, 404, { error: 'run not found' });
        const s = run.meta.summary ?? {};
        const state = run.meta.status === 'passed' ? 'success' : ['failed', 'interrupted', 'error', 'timed-out'].includes(run.meta.status) ? 'failure' : 'error';
        const description = `${run.meta.status}: ${s.passed ?? 0} pass, ${s.flaky ?? 0} flaky, ${s.failed ?? 0} fail`;
        try {
          return send(res, 200, { state, description, url: await github.setStatus(run.meta.git?.commit, state, description) });
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
      }
      if (p === '/api/quarantine' || p === '/api/quarantine/remove') {
        const body = await readBody(req);
        if (p === '/api/quarantine/remove') return send(res, 200, { removed: await removeQuarantine(projectRoot, body.key) });
        try {
          return send(res, 201, await addQuarantine(projectRoot, { key: body.key, title: body.title, file: body.file, line: body.line, reason: body.reason, days: body.days }));
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
      }
      if (p === '/api/github/pr') {
        const body = await readBody(req);
        const [a, b] = await Promise.all([getRun(projectRoot, body.a), getRun(projectRoot, body.b)]);
        if (!a || !b) return send(res, 404, { error: 'run not found' });
        const markdown = prCommentMarkdown(compareRuns(a, b), { project: basename(projectRoot) });
        let pr = null;
        try {
          pr = await github.findPr(b.meta.git?.branch);
        } catch (e) {
          return send(res, 200, { markdown, pr: null, error: e.message });
        }
        if (!body.post || !pr) return send(res, 200, { markdown, pr });
        try {
          return send(res, 200, { markdown, pr, posted: await github.comment(pr.number, markdown) });
        } catch (e) {
          return send(res, 502, { error: e.message });
        }
      }
      if (p === '/api/import/github') {
        const body = await readBody(req);
        try {
          return send(res, 200, { imported: await ghImport(projectRoot, body.runId, { artifact: body.artifact || null }) });
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
      }
      if (p === '/api/projects/forget') {
        const { root } = await readBody(req);
        if (typeof root !== 'string') return send(res, 400, { error: 'invalid root' });
        return send(res, 200, { removed: await forgetProject(root, env) });
      }
      if (p === '/api/run') {
        const body = await readBody(req);
        if (body.rerunOf !== undefined && !RUN_ID.test(String(body.rerunOf))) return send(res, 400, { error: 'invalid rerunOf' });
        let out;
        try {
          const RUN_KEYS = ['tests', 'targets', 'agents', 'retries', 'repeatEach', 'noCache', 'rerunOf', 'workers'];
          const opts = Object.fromEntries(RUN_KEYS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
          // workers: không gửi = mặc định ở Settings; null = để e2e tự chọn theo máy cho lần chạy này
          if (body.workers === undefined) {
            const { workers } = await readSettings(projectRoot);
            if (workers) opts.workers = workers;
          } else if (body.workers === null) delete opts.workers;
          if (body.excludeQuarantined === true) opts.grepInvert = quarantineFlags(await readQuarantine(projectRoot)).args.filter((x) => x !== '--grep-invert');
          out = runner.start(opts);
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
        if (out.ok) return send(res, 202, { started: true, pid: out.pid ?? null });
        if (out.error === 'busy') return send(res, 409, { error: 'busy' });
        return send(res, 503, { error: out.error === 'e2e-missing' ? 'Project chưa cài e2e (node_modules/e2e) — chạy npm install rồi thử lại.' : out.error });
      }
      if (p === '/api/run/stop') return send(res, 200, { stopped: runner.stop() });
      const m = /^\/api\/runs\/([^/]+)\/(pin|baseline)$/.exec(p);
      if (m) {
        const { value } = await readBody(req);
        const meta = await setFlag(projectRoot, m[1], m[2] === 'pin' ? 'pinned' : 'baseline', value);
        return meta ? send(res, 200, meta) : send(res, 404, { error: 'run not found' });
      }
    }
    send(res, 404, 'not found');
  }

  return async (req, res) => {
    try {
      await route(req, res);
    } catch (e) {
      if (!res.headersSent) send(res, e.status ?? (e instanceof SyntaxError ? 400 : 500), { error: e.message });
      else res.end();
    }
  };
}
