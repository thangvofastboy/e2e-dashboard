import { RUN_OPTION_KEYS } from './runner.mjs';
import { readFile, readdir, stat, lstat, rm, mkdir, writeFile } from 'node:fs/promises';
import { installedBrowsers, configSupport, validBrowser } from './browsers.mjs';
import { quickSetupPlan, runQuickSetup, quickSetupRunning } from './quicksetup.mjs';
import { findConfig as findConfigPath } from '../bin/project.mjs';
import { indexedTestHistory, syncIndex, sqliteSupport, closeIndex, indexPath } from './runindex.mjs';
import { failuresEvidence, runSummaryEvidence, whySlowEvidence, groupEvidence, triageEvidence, parseTriage, summaryState, testFiles, ticketEvidence, writeNewTest, selectTestsEvidence, locatorBatchEvidence, duplicateEvidence, releaseEvidence, visualEvidence } from './aiextra.mjs';
import { envSummary, readEnvFile, writeEnvFile, userSummary, writeUser, setupStatus, aiPrefs } from './system.mjs';
import { createReadStream, readFileSync, existsSync } from 'node:fs';
import { pipeline } from 'node:stream';
import { join, extname, basename, relative, resolve, dirname } from 'node:path';
import { platform, release, hostname, arch } from 'node:os';
import { timingSafeEqual, createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { safeJoin, realInside, readConfig, VERSION, DATA_DIR, RUN_ID, RESULT_ID, resultAttempts, isLink } from '../reporter/e2e-dashboard.reporter.mjs';
import { listRuns, getRun, findRunDir, setFlag, testHistory, getAi, writeAi, listAi, loadHistory, dropCaches } from './store.mjs';
import { resetPreview, resetAll } from './reset.mjs';
import { scanJunk, cleanJunk } from './junk.mjs';
import { flakyTests, compareRuns, groupErrors, costStats, slowSteps, routeMap, branchStats, compareBranches, locatorCandidates, traceToCode, testKey, resultError } from './analytics.mjs';
import { projectSummaries, forgetProject, addProject, updateProject, listDirs, readRegistry } from './projects.mjs';
import { acceptDescription, acceptTitle, issueMeta, metaLine, placeImages, issueDraft, claudePrompt, linearConfig, readIssueLinks, saveIssueLink, parseIssueRef, removeIssueLink, fingerprint as issueFingerprint } from './linear.mjs';
import { healthScore } from '../ui/health.js';
import { search, anomalies, lintAgentSteps, agentScan, LINT_RULES, modelStats, bisectPlan, flakyEvidence, testDetail, appErrors, setupTiming } from './insights.mjs';
import { changedFiles, impactedTests } from './impact.mjs';
import { appRoutes, coverageGaps } from './coverage.mjs';
import { scanSource } from './sourcescan.mjs';
import { readIgnored, changeIgnored } from './coverageignore.mjs';
import { runGate, sloConfig, sloHistory } from './gate.mjs';
import { environmentBreakdown, sloStatus } from './insights.mjs';
import { csvRuns, csvTests, csvFlaky } from './csv.mjs';
import { readChangelog } from './changelog.mjs';
import { cleanupRuns, storageUsage, pruneVideos, deleteRun } from './storage.mjs';
import { webhookConfig, sendWebhooks } from './webhook.mjs';
import { readCodeowners, ownersOf } from './owners.mjs';
import { readQuarantine, addQuarantine, removeQuarantine, quarantineFlags } from './quarantine.mjs';
import { buildDigest, flakyShare } from './digest.mjs';
import { importFromGithub } from './share.mjs';
import { createGithub, prCommentMarkdown } from './github.mjs';
import { buildPrompt, cacheKey, commitsBetween, qualityEvidence, validModel, AI_EFFORTS, projectBlock } from './ai.mjs';
import { estimateEta } from './live.mjs';
import { bundleUi } from '../ui/bundle.mjs';
import { buildExportHtml } from './export.mjs';
import { readSettings, writeSettings, autoWorkers } from './settings.mjs';
import { syncLongterm, readDays, daySeries, totals, reliability, lifecycle, dayKey } from './longterm.mjs';
import { syncTriage, triageBoard, updateTriage, TRIAGE_STATUSES } from './triage.mjs';
import { groupReport } from './groups.mjs';
import { traceMatrix, storyList } from './traceability.mjs';
import { aiTraceView, aiTraceCall } from './aitrace.mjs';
import { listCache, clearCache, cacheDir } from './replaycache.mjs';
import { validateFeedback, buildIssue, rateOk, createIssue, SECRET } from './feedback.mjs';
import { commentIfNewBug, signatureOf } from './knownbug.mjs';
import { resolveLinear, detectMcpLinear } from './linear-mcp.mjs';
import { createLinearIssuesApi } from './linear-issues.mjs';
import { findDuplicates, splitCandidates, actionPrompt, latestWithResults } from './dupes.mjs';
import { analyzeQuality } from './quality.mjs';
import { machineResources, runnerResources, dashboardResources } from './resources.mjs';
import { readTemplates, findTemplate, saveTemplate, resultVars, runVars, renderPrompt, aiParts, keepFingerprint, PLACEHOLDERS } from './qc-templates.mjs';
import { markKnown, readNotes, setNote, readAudit, verifyQueue, waiverActive, titleOf as resultTitle, readManual, saveManual, manualSummary, bugReport, buildMatrix, bugRows, bugsCsv } from './qc.mjs';
import { addEvent, removeEvent, timeline, lastCommits, EVENT_KINDS } from './events.mjs';
import { releaseReport } from './release.mjs';
import { alertRules, readAlerts, describeRule } from './alerts.mjs';
import { ciConfig, readCiState, writeCiConfig } from './cisync.mjs';
import { readSchedules, saveSchedule, deleteSchedule, nextFire } from './schedules.mjs';
import { buildReport, reportSchedule, readReportState, lastOccurrence, emailConfig } from './reports.mjs';
import { reportHtml } from './report-html.mjs';
import { siteDir, siteZip } from './site.mjs';

const MAX_BODY = 1024 * 1024;
const FILE_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.webm': 'video/webm', '.mp4': 'video/mp4', '.json': 'application/json',
  '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8',
  '.html': 'text/plain; charset=utf-8', '.htm': 'text/plain; charset=utf-8', '.svg': 'text/plain; charset=utf-8',
};
const UI_CSP = "default-src 'self'; img-src 'self' data:; media-src 'self' https:; style-src 'self' 'unsafe-inline'";

// so độ dài theo byte: token có ký tự ngoài ASCII cùng số ký tự làm timingSafeEqual ném RangeError (500)
const same = (a, b) => {
  if (typeof a !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
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
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  // mọi handler đọc body.x: null / số / chuỗi là lỗi của client (400), không phải TypeError 500
  if (body === null || typeof body !== 'object') throw Object.assign(new Error('body phải là JSON object'), { status: 400 });
  return body;
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

export function reporterStatus(projectRoot) {
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
  // phân tích cả run (không gắn test nào): commit giữa run trước và run này
  const r = resultId ? (run.report.run.results ?? []).find((x) => x.id === resultId) : null;
  // resultId không có trong run (các action không kiểm tra nó): coi như cả run, không đọc r.testId của undefined
  if (action === 'analyze-run' || !r) return commitsBetween(projectRoot, older[0]?.git?.commit, to);
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
// Quét source (coverage.source) đọc mọi file của repo app: repo frontend vài nghìn file mất ~350 ms mỗi lần.
// Giữ kết quả 30 giây theo thư mục + danh sách domain bỏ qua (đổi danh sách là khoá mới); lỗi thì không giữ.
const SCAN_TTL_MS = 30_000;
const scanCache = new Map();
function cachedScan(srcDir, ignore) {
  const key = `${srcDir}\0${ignore.join('\n')}`;
  const hit = scanCache.get(key);
  if (hit && Date.now() - hit.at < SCAN_TTL_MS) return hit.promise;
  const promise = scanSource(srcDir, { ignore });
  promise.catch(() => scanCache.delete(key));
  if (scanCache.size > 20) scanCache.clear();
  scanCache.set(key, { at: Date.now(), promise });
  return promise;
}

// Route của app như trang Coverage thấy: thư mục app/pages/router, "coverage.routes", rồi route quét từ "coverage.source"
async function coverageRoutes(projectRoot, cfg, ignoreDomains = []) {
  // "coverage.source": đường dẫn repo app (tương đối với project hoặc tuyệt đối); bỏ trống thì không quét source
  const srcDir = typeof cfg.coverage?.source === 'string' && cfg.coverage.source ? resolve(projectRoot, cfg.coverage.source) : null;
  const scan = srcDir ? await cachedScan(srcDir, ignoreDomains) : { routes: new Map(), domains: [], files: 0 };
  const routes = await appRoutes(projectRoot, Array.isArray(cfg.coverage?.routes) ? cfg.coverage.routes : []);
  for (const [r, src] of scan.routes) if (!routes.has(r)) routes.set(r, `source:${src}`);
  return { routes, scan, srcDir };
}

export async function readCacheEntry(projectRoot, entry, cfg = readConfig(projectRoot)) {
  if (!/^[0-9a-f]{64}$/.test(entry ?? '')) return null;
  const dir = cacheDir(projectRoot, cfg);
  const file = dir && safeJoin(dir, `${entry}.json`);
  const st = file && (await lstat(file).catch(() => null));
  if (!st?.isFile() || st.size > 1024 * 1024 || !realInside(projectRoot, file)) return null;
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

// Test ids of the latest run: a cache entry of any other test belongs to a test that was deleted or renamed.
async function currentTestIds(projectRoot) {
  const [latest] = await loadHistory(projectRoot, 1);
  const ids = new Set((latest?.report?.run?.results ?? []).map((r) => r.testId).filter(Boolean));
  return ids.size ? ids : null;
}

async function cacheView(projectRoot) {
  const out = await listCache(projectRoot, { testIds: await currentTestIds(projectRoot) });
  const byTest = new Map();
  for (const e of out.entries) {
    const k = `${e.testId ?? '-'}|${e.targetId ?? '-'}`;
    if (!byTest.has(k)) byTest.set(k, { testId: e.testId, targetId: e.targetId, entries: 0, actions: 0, bytes: 0, newest: null, stale: 0, orphan: e.orphan });
    const t = byTest.get(k);
    t.entries++;
    t.actions += e.actions;
    t.bytes += e.bytes;
    t.stale += e.stale ? 1 : 0;
    if (!t.newest || e.createdAt > t.newest) t.newest = e.createdAt;
  }
  return { ...out, tests: [...byTest.values()].sort((a, b) => String(a.testId).localeCompare(String(b.testId))) };
}

// Variables for a prompt template: one result of a run when resultId is given, else the whole run (the newest by default).
async function qcVars(projectRoot, { runId = null, resultId = null } = {}) {
  const run = runId ? await getRun(projectRoot, String(runId)) : ((await loadHistory(projectRoot, 1))[0] ?? null);
  if (!run) return null;
  if (resultId == null) return runVars(run);
  if (!RESULT_ID.test(String(resultId))) throw new Error('invalid resultId');
  const r = (run.report.run.results ?? []).find((x) => x.id === resultId);
  if (!r) throw new Error('result not found');
  const n = (await readNotes(projectRoot))[testKey(r)] ?? {};
  return resultVars(run, resultId, n.note || null, n.known || null);
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

// lịch sử từng test: từ chỉ mục SQLite khi có, không thì parse report như cũ
// model / effort chọn cho riêng một lần gọi AI: hợp lệ thì vào khoá cache, sai thì bỏ (ai.run cũng bỏ)
const aiVariant = (b) => [validModel(b?.model) ? b.model : '', AI_EFFORTS.includes(b?.effort) ? b.effort : ''].join('|').replace(/^\|$/, '');
const SUITE_AI = new Set(['quality-review', 'ask', 'followup', 'route-test', 'ticket-test', 'select-tests', 'locator-batch', 'duplicate-tests', 'release-notes']);
const SUITE_EVIDENCE = new Set(['ticket-test', 'select-tests', 'locator-batch', 'duplicate-tests', 'release-notes']);
const DRAFT_DIR = /^(?!.*(?:^|\/)\.)(?!.*\.\.)[\w./ -]{1,150}$/;
const historyTable = async (root, n) => (await indexedTestHistory(root, n).catch(() => null)) ?? testHistory(root, n);

export function createApp({ projectRoot, token, uiDir, live, onEvent = () => {}, lastArchive = () => null, runner = IDLE_RUNNER, ai = NO_AI, qcAi = null, env = process.env, linearFetch, mcpDetect = detectMcpLinear, github = createGithub({ projectRoot }), ghImport = importFromGithub, automation = null, tracking = null, selfHeal = null }) {
  // Linear: API key nếu có, không thì MCP Linear của Claude CLI. `settings` giống các phiên AI khác (model, effort).
  // force: dò lại MCP Linear ngay (nút Kiểm tra lại), không dùng kết quả trong cache
  const linearBackend = ({ force = false } = {}) => resolveLinear({ projectRoot, cfg: readConfig(projectRoot), env, fetchImpl: linearFetch, detect: force ? () => mcpDetect({ force: true }) : mcpDetect, settings: () => aiPrefs(env, readConfig(projectRoot)) });
  // Issue Linear: AI trả về văn bản; lỗi AI có status 502 để route trả đúng mã
  const runAiText = async (prompt) => {
    let final = null;
    let error = null;
    await ai.run({ prompt, onEvent: (e) => {
      if (e.type === 'done' && !e.isError) final = e.result;
      if (e.type === 'error') error = e.message;
    } });
    if (!final) throw Object.assign(new Error(error ?? 'AI không trả lời'), { status: 502 });
    return final;
  };
  const linearIssuesApi = createLinearIssuesApi({ projectRoot, linearBackend, runAi: runAiText });
  const NO_LINEAR = 'Chưa có Linear: nhập LINEAR_API_KEY ở Cài đặt hệ thống → Tích hợp, hoặc đăng nhập MCP Linear cho Claude CLI (chạy `claude`, gõ /mcp).';
  let avgByKey = new Map();
  const refreshAverages = () =>
    historyTable(projectRoot, 10)
      .then((rows) => {
        avgByKey = new Map(rows.filter((r) => r.avgDurationMs != null).map((r) => [r.key, r.avgDurationMs]));
      })
      .catch(() => {});
  refreshAverages();

  // one ETA + JSON.stringify per live snapshot, shared by every open tab
  const frames = new WeakMap();
  // live sends `full` once then `patch`es (server/live.mjs); every tab shares the same JSON per message
  const sseFrame = (msg) => {
    if (!frames.has(msg)) frames.set(msg, `data: ${JSON.stringify({ ...msg, etaMs: estimateEta(live.view(), avgByKey) })}\n\n`);
    return frames.get(msg);
  };
  // badge "Đang chạy" ở các trang khác chỉ cần tiến độ
  const liteFrame = (s) => `data: ${JSON.stringify({ runId: s.runId, status: s.status, runStatus: s.runStatus, startedAt: s.startedAt, done: s.done, total: s.total })}\n\n`;

  const triageMemo = { key: null, value: null };
  const assets = new Map(); // path -> { sig, body, etag }
  async function uiSig() {
    const names = await readdir(uiDir, { recursive: true });
    let sig = 0;
    for (const n of names) sig = Math.max(sig, (await stat(join(uiDir, n))).mtimeMs);
    return sig;
  }
  async function uiAsset(path) {
    const sig = await uiSig();
    const hit = assets.get(path);
    if (hit?.sig === sig) return hit;
    const body = path === '/app.js' ? await bundleUi(uiDir) : await readFile(join(uiDir, 'style.css'), 'utf8');
    const a = { sig, body, gz: gzipSync(body, { level: 9 }), etag: `"${createHash('sha1').update(body).digest('base64url')}"` };
    assets.set(path, a);
    return a;
  }

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
    if (p.startsWith('/api/linear/issues')) {
      const out = await linearIssuesApi(req, p, req.method, readBody);
      if (out) return send(res, out.status, out.body);
    }
    if (req.method === 'GET') {
      if (p === '/') return send(res, 200, await readFile(join(uiDir, 'index.html'), 'utf8'), { ...ui, 'content-type': 'text/html; charset=utf-8' });
      if (p === '/app.js' || p === '/style.css') {
        // bundle / đọc một lần cho tới khi file trong ui/ đổi; ETag để trình duyệt nhận 304 thay vì tải lại ~320KB
        const a = await uiAsset(p);
        // ~420 KB còn ~130 KB khi nén: nén một lần cho mỗi phiên bản của file, ETag riêng cho bản nén
        const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
        const etag = gzip ? `${a.etag.slice(0, -1)}-gz"` : a.etag;
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, { etag, vary: 'accept-encoding', 'cache-control': 'no-cache' });
          return res.end();
        }
        const headers = { ...ui, 'cache-control': 'no-cache', etag, vary: 'accept-encoding', 'content-type': `text/${p === '/app.js' ? 'javascript' : 'css'}; charset=utf-8` };
        if (!gzip) return send(res, 200, a.body, headers);
        res.writeHead(200, { 'referrer-policy': 'no-referrer', ...headers, 'content-encoding': 'gzip' });
        return res.end(a.gz);
      }
      if (p === '/api/system') {
        const summary = await envSummary(projectRoot); // dùng chung cho env và setup (mỗi lần tính chạy git 2 lần)
        return send(res, 200, {
          version: VERSION, node: process.version, platform: `${platform()} ${release()}`, arch: arch(), hostname: hostname(), projectRoot, dataDir: join(projectRoot, DATA_DIR),
          sqlite: (await readSettings(projectRoot)).sqlite, sqliteSupport: sqliteSupport(),
          env: summary, user: await userSummary(env), setup: await setupStatus(projectRoot, { reporter: reporterStatus(projectRoot), summary }),
        });
      }
      if (p === '/api/system/envfile') return send(res, 200, await readEnvFile(projectRoot, url.searchParams.get('name') ?? ''));
      if (p === '/api/system/quick-setup') {
        return send(res, 200, await quickSetupPlan(projectRoot, { reporter: reporterStatus(projectRoot) }));
      }
      if (p === '/api/system/e2e-config') {
        const { e2eConfigStatus } = await import('./e2econfig.mjs');
        const { aiStatus, AI_PROVIDERS, CLAUDE_CODE_WARNING } = await import('./e2eai.mjs');
        return send(res, 200, { ...(await e2eConfigStatus(projectRoot)), ai: await aiStatus(projectRoot), providers: Object.entries(AI_PROVIDERS).map(([id, x]) => ({ id, label: x.label, kind: x.kind, env: x.env ?? null, ...(x.experimental ? { experimental: true, warning: CLAUDE_CODE_WARNING } : {}) })) });
      }
      if (p === '/api/ai/chats') {
        const { listChats, getChat } = await import('./aichats.mjs');
        const id = url.searchParams.get('id');
        if (!id) return send(res, 200, await listChats(projectRoot));
        const chat = await getChat(projectRoot, id);
        return chat ? send(res, 200, chat) : send(res, 404, { error: 'chat not found' });
      }
      if (p === '/api/ai/summary') {
        const runId = url.searchParams.get('runId') ?? '';
        if (!RUN_ID.test(runId)) return send(res, 400, { error: 'invalid runId' });
        return send(res, 200, { state: summaryState(runId), saved: await getAi(projectRoot, runId, cacheKey('run-summary', runId)) });
      }
      if (p === '/api/selfheal') return send(res, 200, { config: selfHeal?.config() ?? null, errors: (await selfHeal?.list()) ?? [] });
      if (p === '/api/resources') {
        const pid = runner.state().pid;
        const [machine, run] = await Promise.all([machineResources(projectRoot), runnerResources(pid)]);
        return send(res, 200, { machine, app: { dashboard: dashboardResources(), runner: run } });
      }
      if (p === '/api/settings') return send(res, 200, { ...(await readSettings(projectRoot)), autoWorkers: autoWorkers(), browsers: { installed: installedBrowsers(env), configReadsBrowser: configSupport(findConfigPath(projectRoot)) } });
      if (p === '/api/info') return send(res, 200, { version: VERSION, pid: process.pid, project: basename(projectRoot), reporter: reporterStatus(projectRoot), lastArchive: lastArchive(), thresholds: readConfig(projectRoot).thresholds ?? null, runner: runner.state() });
      if (p === '/api/runs') return send(res, 200, await listRuns(projectRoot));
      if (p === '/api/tests') {
        // ?root=: test của project khác trong danh sách Projects (form Lịch chạy); thư mục lạ thì từ chối
        const root = url.searchParams.get('root');
        if (!root) return send(res, 200, await historyTable(projectRoot, 10));
        if (!(await readRegistry(env)).some((x) => resolve(x.root) === resolve(root))) return send(res, 400, { error: 'Project chưa có trong danh sách Projects' });
        return send(res, 200, await historyTable(resolve(root), 10));
      }
      if (p === '/api/schedules') {
        const schedules = (await readSchedules(env)).map((s) => ({ ...s, next: nextFire(s) }));
        const projects = (await readRegistry(env)).map((x) => ({ root: resolve(x.root), name: x.name ?? basename(x.root) }));
        return send(res, 200, { schedules, projects, current: resolve(projectRoot) });
      }
      if (p === '/api/live/test') return send(res, 200, live.test(url.searchParams.get('key') ?? '') ?? { steps: [] });
      if (p === '/api/live') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        let last = '';
        const lite = url.searchParams.has('lite');
        const write = (s) => {
          if (!lite) return res.write(sseFrame(s)); // patch: never dedupe (two equal patches = two equal output lines)
          const f = liteFrame(s);
          if (f !== last) res.write((last = f));
        };
        write(live.full());
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
      if (p === '/api/fs/dirs') {
        try {
          return send(res, 200, await listDirs(url.searchParams.get('path') || dirname(projectRoot)));
        } catch (e) {
          return send(res, 400, { error: e.code === 'ENOENT' ? 'Thư mục không tồn tại' : e.code === 'EACCES' ? 'Không có quyền đọc thư mục' : e.message });
        }
      }
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
      if (p === '/api/storage/cleanup') {
        // xem trước: GET ?from=&to=&olderThanDays=&status=
        const q = Object.fromEntries(url.searchParams);
        return send(res, 200, await cleanupRuns(projectRoot, { ...q, olderThanDays: q.olderThanDays ? Number(q.olderThanDays) : null }, { preview: true }));
      }
      if (p === '/api/automation') return send(res, 200, { ...(automation?.state() ?? { schedule: null, watch: { enabled: false, supported: false } }), webhooks: (await webhookConfig(env)).map((w) => ({ host: new URL(w.url).host, events: w.events })) });
      if (p === '/api/coverage') {
        const cfg = readConfig(projectRoot);
        const manual = await readIgnored(projectRoot); // bấm "Bỏ qua" trên trang Coverage
        const ignoreRoutes = [...(Array.isArray(cfg.coverage?.ignore) ? cfg.coverage.ignore : []), ...manual.routes];
        const ignoreDomains = [...(Array.isArray(cfg.coverage?.domainIgnore) ? cfg.coverage.domainIgnore : []), ...manual.domains];
        const { routes, scan, srcDir } = await coverageRoutes(projectRoot, cfg, ignoreDomains);
        const gaps = coverageGaps(routes, routeMap(await loadHistory(projectRoot, runCount(url))), { ignore: ignoreRoutes });
        return send(res, 200, { ...gaps, domains: scan.domains.filter((d) => !manual.domains.includes(d.host)), sourceFiles: scan.files, source: srcDir ? cfg.coverage.source : null, ignored: manual });
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
      if (p === '/api/publish/site.zip') {
        const zip = await siteZip(projectRoot, env);
        if (!zip) return send(res, 404, { error: 'Chưa xuất trang tĩnh' });
        res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="e2e-report.zip"', 'content-length': zip.length, 'referrer-policy': 'no-referrer' });
        return res.end(zip);
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
      if (p === '/api/lint') {
        const history = await loadHistory(projectRoot, runCount(url));
        const findings = lintAgentSteps(history);
        return send(res, 200, { findings, rules: LINT_RULES, scan: findings.length ? null : agentScan(history) }); // scan chỉ để giải thích trang trống
      }
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
        const history = await loadHistory(projectRoot, runCount(url));
        for (const c of locatorCandidates(history)) {
          const entry = c.entry ? await readCacheEntry(projectRoot, c.entry, cfg) : null;
          out.push({ ...c, suggestion: entry ? traceToCode(entry) : null });
        }
        return send(res, 200, { candidates: out, scan: out.length ? null : agentScan(history) });
      }
      if (p === '/api/linear') {
        const lin = await linearBackend({ force: url.searchParams.get('refresh') === '1' });
        return send(res, 200, { configured: lin.mode !== null, mode: lin.mode, team: lin.team, mcp: lin.mcp ? { connected: lin.mcp.connected, needsAuth: lin.mcp.needsAuth, installed: lin.mcp.installed, servers: lin.mcp.servers.map((x) => ({ name: x.name, connected: x.connected })) } : null, links: await readIssueLinks(projectRoot) });
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
      if (p === '/api/cache') return send(res, 200, await cacheView(projectRoot));
      if (p === '/api/junk') return send(res, 200, await scanJunk(projectRoot, { testIds: await currentTestIds(projectRoot) }));
      if (p === '/api/reset/preview') return send(res, 200, await resetPreview(projectRoot, { env }));
      if (p === '/api/qc/notes') return send(res, 200, await readNotes(projectRoot));
      if (p === '/api/qc/quality') return send(res, 200, analyzeQuality(await loadHistory(projectRoot, Math.min(runCount(url), 30))));
      if (p === '/api/qc/dupes') {
        const latest = latestWithResults(await loadHistory(projectRoot, 30));
        if (!latest) return send(res, 200, { runId: null, groups: [] });
        const groups = [...findDuplicates(latest.report), ...splitCandidates(latest.report)].map((g) => ({ ...g, prompt: actionPrompt(g) }));
        return send(res, 200, { runId: latest.meta.runId, groups });
      }
      if (p === '/api/qc/audit') return send(res, 200, { items: (await readAudit(projectRoot)).slice(-200).reverse() });
      if (p === '/api/qc/verify') {
        const history = await loadHistory(projectRoot, 30);
        const notes = await readNotes(projectRoot);
        const latest = latestWithResults(history);
        const failing = (latest?.report.run.results ?? []).filter((r) => ['failed', 'timed-out'].includes(r.status)).map((r) => ({ key: testKey(r), title: resultTitle(r) }));
        const waivers = Object.entries(notes).filter(([, n]) => n.waiver).map(([key, n]) => ({ key, ...n.waiver, active: waiverActive(n.waiver) }));
        return send(res, 200, { runId: latest?.meta.runId ?? null, queue: verifyQueue(history, notes), failing, waivers });
      }
      if (p === '/api/qc/templates') return send(res, 200, { templates: await readTemplates(projectRoot), placeholders: PLACEHOLDERS });
      if (p === '/api/qc/results') {
        const [latest] = await loadHistory(projectRoot, 1);
        return send(res, 200, { runId: latest?.meta.runId ?? null, results: bugRows(latest, await readNotes(projectRoot)).map(({ id, runId, test, target, status }) => ({ id, runId, test, target, status })) });
      }
      if (p === '/api/qc/manual') {
        const items = await readManual(projectRoot);
        return send(res, 200, { items, summary: manualSummary(items) });
      }
      // ma trận build: tối đa 60 report trong bộ nhớ
      if (p === '/api/build-matrix') return send(res, 200, buildMatrix(await loadHistory(projectRoot, Math.min(runCount(url), 60)), { builds: Math.min(Math.max(Number(url.searchParams.get('builds')) || 8, 2), 12) }));
      if (p === '/api/export/bugs.csv') {
        const [latest] = await loadHistory(projectRoot, 1);
        return send(res, 200, bugsCsv(bugRows(latest, await readNotes(projectRoot))), { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="e2e-bugs.csv"' });
      }
      const bug = /^\/api\/runs\/([^/]+)\/bug-report$/.exec(p);
      if (bug) {
        const run = await getRun(projectRoot, bug[1]);
        if (!run) return send(res, 404, { error: 'run not found' });
        const rid = url.searchParams.get('resultId') ?? '';
        if (!RESULT_ID.test(rid)) return send(res, 400, { error: 'invalid resultId' });
        const r = (run.report.run.results ?? []).find((x) => x.id === rid);
        const n = r ? (await readNotes(projectRoot))[testKey(r)] ?? {} : {};
        const md = r ? bugReport({ meta: run.meta, report: run.report, resultId: rid, note: n.note || null, known: n.known || null }) : null;
        return md ? send(res, 200, md, { 'content-type': 'text/markdown; charset=utf-8' }) : send(res, 404, { error: 'result not found' });
      }
      const aiTr = /^\/api\/runs\/([^/]+)\/ai-trace(?:\/([\w.:-]{1,80}))?$/.exec(p);
      if (aiTr) {
        const dir = await findRunDir(projectRoot, aiTr[1]);
        if (!dir) return send(res, 404, { error: 'run not found' });
        const out = aiTr[2] ? await aiTraceCall(dir, aiTr[2]) : await aiTraceView(dir, { testId: url.searchParams.get('testId') });
        return out ? send(res, 200, out) : send(res, 404, { error: 'no ai-trace for this run (chạy với --ai-trace)' });
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
      // lịch sử chat AI (server/aichats.mjs): trước khối /api/ai/<action> vì khối đó trả 404 cho tên lạ
      if (p === '/api/ai/chats') {
        const { appendChat } = await import('./aichats.mjs');
        return send(res, 200, await appendChat(projectRoot, await readBody(req))); // dữ liệu sai: aichats ném lỗi status 400
      }
      if (p === '/api/ai/chats/delete') {
        const { deleteChat } = await import('./aichats.mjs');
        return send(res, 200, await deleteChat(projectRoot, (await readBody(req)).id));
      }
      if (p.startsWith('/api/ai/')) {
        const action = /^\/api\/ai\/(analyze-failure|analyze-run|suggest-locator|why-flaky|explore-to-test|route-test|ask|followup|run-summary|why-slow|explain-group|ticket-test|select-tests|locator-batch|duplicate-tests|release-notes|explain-visual|repro-steps|severity|dedupe-failures|quality-review)$/.exec(p)?.[1];
        if (!action) return send(res, 404, { error: 'unknown action' });
        const body = await readBody(req);
        // a question about the whole suite, or a follow-up in an existing session, needs no run
        let run = SUITE_AI.has(action) ? { meta: { runId: null }, report: null, dir: projectRoot } : await getRun(projectRoot, body.runId);
        if (!run) return send(res, 404, { error: 'run not found' });
        const ac = new AbortController();
        res.on('close', () => !res.writableEnded && ac.abort()); // tab closed → never start or keep claude
        let prompt;
        let resume;
        let key = null;
        // bối cảnh dự án (Cài đặt › Dự án) đổi thì câu trả lời cũ không còn đúng: đưa vào khoá cache; trống thì giữ khoá cũ
        const variant = [aiVariant(body), projectBlock(await readSettings(projectRoot))].filter(Boolean).join('\0');
        // trả câu trả lời đã lưu (nút "Chạy lại" gửi refresh để bỏ qua)
        const replayCached = async () => {
          const cached = body.refresh ? null : await getAi(projectRoot, run.meta.runId, key);
          if (!cached) return false;
          const write = startSse(res);
          write({ type: 'cached', ...cached });
          write({ type: 'done', cached: true });
          res.end();
          return true;
        };
        if (action === 'quality-review') {
          // điểm công thức của run mới nhất + lý do trừ điểm + file test; cache theo run mới nhất, số run, model, effort
          const n = Math.min(runCount(url), 30);
          const q = analyzeQuality(await loadHistory(projectRoot, n));
          if (!q.rows.length) return send(res, 400, { error: 'Chưa có run nào có kết quả để đánh giá' });
          run = { meta: { runId: q.runId }, report: null, dir: projectRoot };
          key = cacheKey(action, q.runId, `runs:${n}`, variant);
          if (await replayCached()) return;
          prompt = buildPrompt(action, { evidence: qualityEvidence(q), language: readConfig(projectRoot).ai?.language });
        } else if (action === 'route-test') {
          if (typeof body.route !== 'string' || !/^\/[\w\-./:]{0,300}$/.test(body.route)) return send(res, 400, { error: 'invalid route' });
          const { routes } = await coverageRoutes(projectRoot, readConfig(projectRoot)); // cùng danh sách trang Coverage hiển thị
          if (!routes.has(body.route)) return send(res, 404, { error: 'route not found' });
          prompt = buildPrompt('route-test', { route: body.route, source: routes.get(body.route), language: readConfig(projectRoot).ai?.language });
        } else if (action === 'ask') {
          if (typeof body.question !== 'string' || !body.question.trim() || body.question.length > 4000) return send(res, 400, { error: 'invalid question' });
          prompt = buildPrompt('ask', { context: await askContext(projectRoot), question: body.question, language: readConfig(projectRoot).ai?.language });
        } else if (SUITE_EVIDENCE.has(action)) {
          // tính năng AI cấp cả suite: bằng chứng soạn ở aiextra.mjs, không gắn run nào, không cache
          let evidence = null;
          if (action === 'ticket-test') {
            if (typeof body.ticket !== 'string' || body.ticket.trim().length < 10 || body.ticket.length > 8000) return send(res, 400, { error: 'Dán nội dung ticket (10–8000 ký tự)' });
            const folder = typeof body.folder === 'string' && DRAFT_DIR.test(body.folder) ? body.folder : null;
            evidence = ticketEvidence(body.ticket, folder, await testFiles(projectRoot));
          } else if (action === 'select-tests') {
            const base = typeof body.base === 'string' && /^[\w./-]{1,100}$/.test(body.base) ? body.base : 'main';
            const files = await changedFiles(projectRoot, base).catch(() => null);
            if (!files?.length) return send(res, 400, { error: files ? `Không có file nào đổi so với ${base}` : 'Không đọc được git diff (không phải repo git, hoặc không có nhánh này)' });
            evidence = selectTestsEvidence(base, files, await historyTable(projectRoot, 10));
          } else if (action === 'locator-batch') {
            const cfg = readConfig(projectRoot);
            const cands = [];
            for (const c of locatorCandidates(await loadHistory(projectRoot, runCount(url))).slice(0, 25)) {
              const entry = c.entry ? await readCacheEntry(projectRoot, c.entry, cfg) : null;
              cands.push({ ...c, suggestion: entry ? traceToCode(entry) : null });
            }
            if (!cands.length) return send(res, 400, { error: 'Chưa có bước agent.act nào replay đủ ổn định để đổi sang locator' });
            evidence = locatorBatchEvidence(cands);
          } else if (action === 'duplicate-tests') {
            evidence = duplicateEvidence(await loadHistory(projectRoot, 1));
          } else if (action === 'release-notes') {
            const tag = (v) => (typeof v === 'string' && /^[\w./-]{1,100}$/.test(v) ? v : null);
            evidence = releaseEvidence(await releaseReport(projectRoot, { from: tag(body.from), to: tag(body.to), slo: sloConfig(readConfig(projectRoot)).target }));
          }
          if (!evidence) return send(res, 400, { error: 'Chưa đủ dữ liệu cho phân tích này' });
          prompt = buildPrompt(action, { evidence, language: readConfig(projectRoot).ai?.language });
        } else if (action === 'followup') {
          const ok = typeof body.sessionId === 'string' && /^[\w-]{1,100}$/.test(body.sessionId) && typeof body.question === 'string' && body.question.trim() && body.question.length <= 4000;
          if (!ok) return send(res, 400, { error: 'invalid follow-up' });
          prompt = body.question;
          resume = body.sessionId;
        } else {
          const perResult = action === 'analyze-failure' || action === 'suggest-locator' || action === 'why-flaky' || action === 'explain-visual' || action === 'repro-steps' || action === 'severity';
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
          if (action === 'run-summary' || action === 'why-slow') {
            evidence = (action === 'run-summary' ? runSummaryEvidence : whySlowEvidence)(await loadHistory(projectRoot, 31), run.meta.runId);
            if (!evidence) return send(res, 404, { error: 'run quá cũ để so với lịch sử' });
          }
          if (action === 'explain-visual') {
            evidence = visualEvidence(run.report, body.resultId, relative(projectRoot, run.dir).split('\\').join('/'), typeof body.name === 'string' ? body.name : null);
            if (!evidence) return send(res, 404, { error: 'Không có cặp ảnh expected / actual cho test này' });
            newest = typeof body.name === 'string' ? body.name.slice(0, 120) : '';
          }
          if (action === 'dedupe-failures') {
            evidence = failuresEvidence(run.report);
            if (evidence.length < 2) return send(res, 400, { error: 'Cần ít nhất 2 test fail để gom' });
          }
          if (action === 'explain-group') {
            if (!/^[0-9a-f]{12}$/.test(String(body.groupId ?? ''))) return send(res, 400, { error: 'invalid groupId' });
            const g = groupEvidence(await loadHistory(projectRoot, runCount(url)), body.groupId);
            if (!g) return send(res, 404, { error: 'group not found' });
            evidence = g.lines;
            newest = body.groupId; // cache theo nhóm
          }
          if (action === 'why-flaky') {
            // the answer depends on the history, so the cache key follows the newest run too
            const history = await loadHistory(projectRoot, 60);
            evidence = flakyEvidence(history, testKey(result));
            newest = history[0]?.meta.runId ?? '';
          }
          key = cacheKey(action, run.meta.runId, action === 'suggest-locator' ? `${body.resultId}:${body.stepIndex}` : action === 'why-flaky' ? `${body.resultId}:${newest}` : action === 'explain-group' ? `group:${newest}` : action === 'explain-visual' ? `${body.resultId}:visual:${newest}` : perResult ? body.resultId : '', variant);
          if (await replayCached()) return;
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
          model: body.model,
          effort: body.effort,
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
      if (p === '/api/linear/comment-known') {
        // test known bug fail lại với lỗi khác: comment nội dung lỗi mới vào issue đã gắn (mỗi dạng lỗi một lần)
        const b = await readBody(req);
        const run = await getRun(projectRoot, String(b.runId ?? ''));
        if (!run) return send(res, 404, { error: 'run not found' });
        if (!RESULT_ID.test(String(b.resultId ?? ''))) return send(res, 400, { error: 'invalid resultId' });
        const failing = (run.report.run.results ?? []).find((x) => x.id === b.resultId);
        if (!failing) return send(res, 404, { error: 'result not found' });
        const lin = await linearBackend();
        if (!lin.client) return send(res, 400, { error: NO_LINEAR });
        try {
          const linear = lin.client;
          return send(res, 200, await commentIfNewBug({ projectRoot, run, result: failing, linear, notes: await readNotes(projectRoot) }));
        } catch (e) {
          return send(res, 502, { error: e.message });
        }
      }
      if (p === '/api/linear/detach') {
        // gỡ liên kết bug ↔ issue: xoá mã known bug và liên kết đã lưu; issue trên Linear giữ nguyên
        const b = await readBody(req);
        const run = await getRun(projectRoot, String(b.runId ?? ''));
        if (!run) return send(res, 404, { error: 'run not found' });
        if (!RESULT_ID.test(String(b.resultId ?? ''))) return send(res, 400, { error: 'invalid resultId' });
        const failing = (run.report.run.results ?? []).find((x) => x.id === b.resultId);
        if (!failing) return send(res, 404, { error: 'result not found' });
        const known = (await readNotes(projectRoot))[testKey(failing)]?.known ?? null;
        const linked = await removeIssueLink(projectRoot, issueFingerprint(failing, resultError(run.report, failing)));
        if (known) await setNote(projectRoot, testKey(failing), { known: '' });
        return send(res, 200, { removed: { known, link: linked } });
      }
      if (p === '/api/linear/attach') {
        // gắn một issue Linear có sẵn vào một bug: lưu liên kết (lần sau gửi sẽ thấy "đã có") và đánh dấu known bug
        const b = await readBody(req);
        const run = await getRun(projectRoot, String(b.runId ?? ''));
        if (!run) return send(res, 404, { error: 'run not found' });
        if (!RESULT_ID.test(String(b.resultId ?? ''))) return send(res, 400, { error: 'invalid resultId' });
        const failing = (run.report.run.results ?? []).find((x) => x.id === b.resultId);
        if (!failing) return send(res, 404, { error: 'result not found' });
        const identifier = parseIssueRef(b.ref);
        if (!identifier) return send(res, 400, { error: 'Nhập mã issue (ví dụ ENG-123) hoặc link Linear' });
        const lin = await linearBackend();
        let issue = { identifier, url: null, title: '' };
        let verified = false;
        if (lin.client) {
          try {
            const found = await lin.client.get(identifier);
            if (!found) return send(res, 404, { error: `Linear không có issue ${identifier}` });
            issue = found;
            verified = true;
          } catch (e) {
            return send(res, 502, { error: e.message });
          }
        }
        await saveIssueLink(projectRoot, issueFingerprint(failing, resultError(run.report, failing)), issue);
        await markKnown(projectRoot, failing, issue, signatureOf(run.report, failing));
        return send(res, 200, { issue: { identifier: issue.identifier, url: issue.url ?? null, title: issue.title ?? '', state: issue.state?.name ?? null }, verified });
      }
      if (p === '/api/linear/draft' || p === '/api/linear/issue' || p === '/api/linear/rewrite') {
        const body = await readBody(req);
        const run = await getRun(projectRoot, body.runId);
        if (!run) return send(res, 404, { error: 'run not found' });
        if (!RESULT_ID.test(String(body.resultId ?? '')) || !(run.report.run.results ?? []).some((r) => r.id === body.resultId)) return send(res, 404, { error: 'result not found' });
        const cfg = readConfig(projectRoot);
        const saved = await getAi(projectRoot, run.meta.runId, cacheKey('analyze-failure', run.meta.runId, body.resultId));
        const draft = issueDraft({ meta: run.meta, report: run.report, resultId: body.resultId, commits: await commitsFor(projectRoot, run, 'analyze-failure', body.resultId), analysis: saved?.markdown ?? null, project: basename(projectRoot), owners: ownersOf(readCodeowners(projectRoot).rules, (run.report.run.results ?? []).find((r) => r.id === body.resultId)?.source?.file) });
        const lin = p === '/api/linear/draft' ? await linearBackend() : null; // chỉ cần biết chế độ khi mở hộp thoại
        const { team } = lin ?? (await linearConfig(cfg, env));
        const links = await readIssueLinks(projectRoot);
        // ảnh minh hoạ nằm trong thư mục run: Claude (Linear MCP) nhận đường dẫn trên máy để tự đính kèm nếu được
        const localDraft = { ...draft, description: draft.description.replace(/\(e2ed-image:(\d+)\)/g, (m, i) => (draft.images[i] ? `(${join(run.dir, draft.images[i].path)})` : m)) };
        if (p === '/api/linear/draft') return send(res, 200, { draft, prompt: claudePrompt(localDraft, team), imagePaths: draft.images.map((im) => join(run.dir, im.path)), configured: lin.mode !== null, mode: lin.mode, team, link: links[draft.fingerprint] ?? null });
        if (p === '/api/linear/rewrite') {
          // viết lại cho tự nhiên; chỉ nhận khi AI giữ đủ dòng fingerprint và mọi chỗ đặt ảnh
          const base = acceptDescription(draft, body.description);
          let final = null;
          let error = null;
          const ac = new AbortController();
          res.on('close', () => !res.writableEnded && ac.abort());
          await ai.run({ signal: ac.signal, prompt: buildPrompt('linear-rewrite', { evidence: base.split('\n'), language: cfg.ai?.language }), onEvent: (e) => {
            if (e.type === 'done' && !e.isError) final = e.result;
            if (e.type === 'error') error = e.message;
          } });
          if (!final) return send(res, 502, { error: error ?? 'AI không trả lời' });
          const text = final.trim().replace(/^```(?:markdown|md)?\n([\s\S]*)\n```$/, '$1');
          const refs = [...base.matchAll(/\(e2ed-image:\d+\)/g)].map((m) => m[0]);
          if (acceptDescription(draft, text) !== text || refs.some((x) => !text.includes(x))) return send(res, 502, { error: 'Bản AI viết lại làm mất dòng fingerprint hoặc ảnh: giữ bản cũ, thử lại.' });
          return send(res, 200, { description: text });
        }
        let meta;
        try {
          meta = body.mode === 'comment' ? issueMeta() : issueMeta({ type: body.type, relatedId: body.relatedId }); // Bug bắt buộc có mã liên quan
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
        const back = await linearBackend();
        if (!back.client) return send(res, 400, { error: `${NO_LINEAR} Hoặc dùng nút "Copy cho Claude".`, prompt: claudePrompt(draft, team) });
        const linear = back.client;
        const found = await linear.find(draft.fingerprint);
        const failing = (run.report.run.results ?? []).find((x) => x.id === body.resultId);
        const attached = links[draft.fingerprint]; // issue gắn tay: không chứa fingerprint nên find() không thấy
        if (!found.open && attached?.identifier && body.mode !== 'new' && !found.closed.some((c) => c.identifier === attached.identifier)) {
          // chưa rõ trạng thái: hỏi Linear; đã đóng thì cho tạo issue mới (tái phát), còn lại coi là đã có
          const live = await linear.get(attached.identifier).catch(() => null);
          if (!['completed', 'canceled'].includes(live?.state?.type)) {
            await markKnown(projectRoot, failing, live ?? attached, signatureOf(run.report, failing));
            return send(res, 200, { status: 'duplicate', issue: live ?? attached, fingerprint: draft.fingerprint });
          }
        }
        if (found.open) {
          await markKnown(projectRoot, failing, found.open, signatureOf(run.report, failing)); // đã có issue đang mở: test này là known bug
          if (body.mode !== 'comment') return send(res, 200, { status: 'duplicate', issue: found.open, fingerprint: draft.fingerprint });
          const where = run.meta.git?.commit ? ` trên \`${run.meta.git.branch ?? '?'}@${String(run.meta.git.commit).slice(0, 10)}\`` : '';
          await linear.comment(found.open.id, `Lỗi xảy ra lại ở run \`${run.meta.runId}\` (${run.meta.startedAt})${where}.`);
          await saveIssueLink(projectRoot, draft.fingerprint, found.open);
          return send(res, 200, { status: 'commented', issue: found.open, fingerprint: draft.fingerprint });
        }
        // nội dung đã sửa trong hộp thoại (phải còn dòng fingerprint), rồi tải ảnh minh hoạ lên Linear
        let description = acceptDescription(draft, body.description);
        const urls = [];
        for (const [i, im] of draft.images.entries()) {
          try {
            const full = safeJoin(run.dir, im.path);
            const st = full && !isLink(full) && realInside(run.dir, full) ? await lstat(full) : null; // artifacts/ là symlink thì không đọc
            if (!st?.isFile() || st.size > 5 * 1024 * 1024) continue;
            const ext = extname(full).toLowerCase();
            if (typeof linear.uploadImage !== 'function') break; // MCP không tải ảnh lên: ảnh thành ghi chú đường dẫn
            urls[i] = await linear.uploadImage(await readFile(full), basename(full), ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg');
          } catch {
            // ảnh không tải được: thay bằng ghi chú, không làm hỏng cả issue
          }
        }
        description = placeImages(description, urls, draft.images);
        if (meta.type) description = `${metaLine(meta)}\n\n${description}`;
        const old = found.closed[0];
        const issue = await linear.create({ ...draft, type: meta.type, title: acceptTitle(draft, body.title), description: old ? `Tái phát của ${old.identifier} (đã đóng).\n\n${description}` : description });
        await saveIssueLink(projectRoot, draft.fingerprint, issue);
        await markKnown(projectRoot, failing, issue, signatureOf(run.report, failing)); // thêm task lên Linear = tự đánh dấu known bug
        return send(res, 201, { status: 'created', issue, reopenedFrom: old?.identifier ?? null, fingerprint: draft.fingerprint, images: urls.filter(Boolean).length });
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
      if (p === '/api/ci/config') {
        try {
          const config = await writeCiConfig(projectRoot, await readBody(req));
          tracking?.reloadCi?.();
          return send(res, 200, { config });
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
      }
      if (p === '/api/schedules/save') {
        try {
          return send(res, 200, { schedule: await saveSchedule(await readBody(req), env) });
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
      }
      if (p === '/api/schedules/delete') {
        const { id } = await readBody(req);
        if (typeof id !== 'string') return send(res, 400, { error: 'invalid id' });
        return send(res, 200, { removed: await deleteSchedule(id, env) });
      }
      if (p === '/api/schedules/run') {
        const { id } = await readBody(req);
        const s = (await readSchedules(env)).find((x) => x.id === id);
        if (!s) return send(res, 404, { error: 'Không thấy lịch' });
        if (!automation?.runSchedule) return send(res, 503, { error: 'unavailable' });
        const r = await automation.runSchedule(s);
        return r.ok ? send(res, 200, r) : send(res, r.error === 'busy' ? 409 : 400, { error: r.error });
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
      if (p === '/api/storage/cleanup') {
        const b = await readBody(req);
        const r = await cleanupRuns(projectRoot, { from: b.from, to: b.to, olderThanDays: Number.isInteger(b.olderThanDays) ? b.olderThanDays : null, status: b.status ?? 'all' }, { preview: false });
        void syncIndex(projectRoot).catch(() => {});
        return send(res, 200, r);
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
      if (p === '/api/system/envfile') {
        const body = await readBody(req);
        return send(res, 200, { ...(await writeEnvFile(projectRoot, body.name, body.content)), env: await envSummary(projectRoot) });
      }
      if (p === '/api/system/user') return send(res, 200, await writeUser(env, await readBody(req)));
      if (p === '/api/tests/draft') {
        // lưu test nháp AI viết từ ticket: chỉ trong project, đuôi .e2e.ts, không ghi đè, không đi qua symlink
        const b = await readBody(req);
        const rel = String(b.path ?? '').replace(/^\.\//, '');
        try {
          return send(res, 200, await writeNewTest(projectRoot, rel, b.content));
        } catch (e) {
          if (e.status) return send(res, e.status, { error: e.message });
          throw e;
        }
      }
      if (p === '/api/ai/triage-suggest') {
        // gợi ý triage cho các test đang fail; nhớ theo run mới nhất (đổi khi có run mới)
        const history = await loadHistory(projectRoot, 60);
        const { entries, failing } = await syncTriage(projectRoot, history);
        const rows = triageBoard({ entries, failing, links: {}, ownersOf: ownersFn() }).rows.filter((r) => r.failingNow);
        const memoKey = `${history[0]?.meta.runId}:${rows.map((r) => r.fp).join(',')}`;
        if (!(await readBody(req)).refresh && triageMemo.key === memoKey) return send(res, 200, { suggestions: triageMemo.value, cached: true });
        if (!rows.length) return send(res, 200, { suggestions: [] });
        let final = null;
        let error = null;
        const ac = new AbortController();
        res.on('close', () => !res.writableEnded && ac.abort()); // tab đóng: không chạy / dừng claude
        await ai.run({ signal: ac.signal, prompt: buildPrompt('triage-suggest', { evidence: triageEvidence(rows), language: readConfig(projectRoot).ai?.language }), onEvent: (e) => {
          if (e.type === 'done' && !e.isError) final = e.result;
          if (e.type === 'error') error = e.message;
        } });
        if (!final) return send(res, 502, { error: error ?? 'AI không trả lời' });
        const suggestions = parseTriage(final, rows);
        Object.assign(triageMemo, { key: memoKey, value: suggestions });
        return send(res, 200, { suggestions });
      }
      if (p === '/api/app-error') {
        // lỗi JS của giao diện (ui/app.js): ghi lại cho tự sửa lỗi
        const b = await readBody(req);
        await selfHeal?.report({ source: 'ui', message: b.message, stack: b.stack, route: b.route, file: b.file });
        return send(res, 204, '');
      }
      if (p === '/api/selfheal/retry') return send(res, 200, { ok: Boolean(await selfHeal?.retry(String((await readBody(req)).fingerprint ?? ''))) });
      if (p === '/api/selfheal/approve') return send(res, 200, { ok: Boolean(await selfHeal?.approve(String((await readBody(req)).fingerprint ?? ''))) });
      if (p === '/api/selfheal/reject') return send(res, 200, { ok: Boolean(await selfHeal?.reject(String((await readBody(req)).fingerprint ?? ''))) });
      if (p === '/api/system/e2e-config') {
        // chỉ URL app và lệnh khởi động; e2econfig kiểm tra URL (http/https) và lệnh (không nháy, không ; | & $)
        const { appUrl, command } = await readBody(req);
        if ((appUrl !== undefined && typeof appUrl !== 'string') || (command !== undefined && typeof command !== 'string') || String(appUrl ?? '').length > 2000 || String(command ?? '').length > 500) return send(res, 400, { error: 'invalid body' });
        const { updateE2eConfig } = await import('./e2econfig.mjs');
        return send(res, 200, await updateE2eConfig(projectRoot, { appUrl, command }));
      }
      if (p === '/api/system/ai') {
        // đổi provider trong e2e.config (+ API key vào .env); gói npm cài qua Quick Setup, đăng nhập subscription chạy trong terminal
        const { provider, apiKey, baseURL, modelId } = await readBody(req);
        const str = (v, max) => v === undefined || (typeof v === 'string' && v.length <= max);
        if (typeof provider !== 'string' || !str(apiKey, 4000) || !str(baseURL, 2000) || !str(modelId, 100)) return send(res, 400, { error: 'invalid body' });
        const { setAiProvider } = await import('./e2eai.mjs');
        return send(res, 200, await setAiProvider(projectRoot, provider, { apiKey: apiKey || undefined, baseURL: baseURL || undefined, modelId: modelId || undefined }));
      }
      if (p === '/api/system/doctor') {
        const { doctor } = await import('./doctor.mjs');
        return send(res, 200, await doctor(projectRoot, { dryRun: Boolean((await readBody(req)).dryRun), reporter: reporterStatus(projectRoot) }));
      }
      if (p === '/api/system/quick-setup/run') {
        // body chỉ là id bước; lệnh lấy từ kế hoạch server dựng lại lúc bấm
        const ids = (await readBody(req)).ids;
        if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string' && /^[a-z0-9-]{1,30}$/.test(x))) return send(res, 400, { error: 'invalid ids' });
        if (runner.state().running || live.snapshot().status === 'running') return send(res, 409, { error: 'Đang có run chạy: dừng run trước khi cài (npm install dưới run đang chạy dễ làm hỏng run)' });
        if (quickSetupRunning(projectRoot)) return send(res, 409, { error: 'Quick Setup đang chạy' }); // hai npm install cùng lúc giẫm lên node_modules
        const ac = new AbortController();
        res.on('close', () => !res.writableEnded && ac.abort()); // tab đóng: dừng lệnh đang cài
        const write = startSse(res);
        try {
          await runQuickSetup(projectRoot, ids, { onEvent: write, signal: ac.signal, reporter: () => reporterStatus(projectRoot) });
        } catch (e) {
          write({ type: 'error', message: e.message });
        }
        return res.end();
      }
      if (p === '/api/system/setup') {
        const { setup } = await import('../bin/dashboard.mjs'); // lazy: bin kéo theo nhiều module server
        return send(res, 200, { lines: await setup(projectRoot) });
      }
      if (p === '/api/settings') {
        const { workers, sqlite, browser, linear, headed, sources, prompt } = await readBody(req);
        if (sqlite === true) {
          const sup = sqliteSupport();
          if (!sup.ok) return send(res, 400, { error: sup.reason });
        }
        const saved = await writeSettings(projectRoot, { workers, sqlite, browser, linear, headed, sources, prompt });
        if (sqlite === true) void syncIndex(projectRoot).catch(() => {});
        if (sqlite === false) {
          closeIndex(projectRoot);
          for (const f of ['', '-wal', '-shm']) await rm(`${indexPath(projectRoot)}${f}`, { force: true }).catch(() => {});
        }
        return send(res, 200, { ...saved, autoWorkers: autoWorkers() });
      }
      if (p === '/api/coverage/ignore') {
        const { kind, value, remove } = await readBody(req);
        return send(res, 200, await changeIgnored(projectRoot, { kind, value, remove: Boolean(remove) }));
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
      if (p === '/api/projects/add') {
        const { root } = await readBody(req);
        if (typeof root !== 'string' || !root.trim()) return send(res, 400, { error: 'invalid root' });
        try {
          return send(res, 200, await addProject(root.trim(), env));
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
      }
      if (p === '/api/projects/update') {
        const { root, name, newRoot } = await readBody(req);
        if (typeof root !== 'string' || (name !== undefined && typeof name !== 'string') || (newRoot !== undefined && (typeof newRoot !== 'string' || !newRoot.trim()))) return send(res, 400, { error: 'invalid body' });
        // server đang phục vụ project này: đổi thư mục sẽ làm dashboard trỏ sai, chỉ cho đổi tên
        if (newRoot !== undefined && resolve(newRoot.trim()) !== resolve(root) && resolve(root) === resolve(projectRoot)) return send(res, 400, { error: 'Không đổi thư mục của project đang mở' });
        try {
          return send(res, 200, await updateProject(root, { name, newRoot: newRoot?.trim() }, env));
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
        if (quickSetupRunning(projectRoot)) return send(res, 409, { error: 'Quick Setup đang cài thư viện: chờ cài xong rồi chạy test' });
        const body = await readBody(req);
        if (body.rerunOf !== undefined && !RUN_ID.test(String(body.rerunOf))) return send(res, 400, { error: 'invalid rerunOf' });
        let out;
        try {
          const RUN_KEYS = RUN_OPTION_KEYS;
          const opts = Object.fromEntries(RUN_KEYS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
          // workers: không gửi = mặc định ở Settings; null = để e2e tự chọn theo máy cho lần chạy này
          if (body.workers === undefined) {
            const { workers } = await readSettings(projectRoot);
            if (workers) opts.workers = workers;
          } else if (body.workers === null) delete opts.workers;
          // trình duyệt: không gửi = mặc định ở Settings (chromium)
          if (body.browser === undefined) opts.browser = (await readSettings(projectRoot)).browser;
          else if (!validBrowser(body.browser)) return send(res, 400, { error: 'Trình duyệt phải là chromium, firefox hoặc webkit' });
          // headed: không gửi = mặc định ở Settings (tắt)
          if (body.headed === undefined && (await readSettings(projectRoot)).headed) opts.headed = true;
          if (body.excludeQuarantined === true) opts.grepInvert = quarantineFlags(await readQuarantine(projectRoot)).args.filter((x) => x !== '--grep-invert');
          out = runner.start(opts);
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
        if (out.ok) return send(res, 202, { started: true, pid: out.pid ?? null });
        if (out.error === 'busy') return send(res, 409, { error: 'busy' });
        return send(res, 503, { error: out.error === 'e2e-missing' ? 'Project chưa cài e2e (node_modules/e2e) — chạy npm install rồi thử lại.' : out.error });
      }
      if (p === '/api/junk/clean') {
        const b = await readBody(req);
        try {
          return send(res, 200, await cleanJunk(projectRoot, b.categories, { testIds: await currentTestIds(projectRoot) }));
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
      }
      if (p === '/api/reset') {
        const b = await readBody(req);
        if (b.confirm !== 'RESET') return send(res, 400, { error: 'Gõ đúng RESET để xác nhận' });
        if (runner.state().running || live.snapshot().status === 'running') return send(res, 409, { error: 'Đang có run chạy: dừng run trước khi reset' });
        try {
          closeIndex(projectRoot); // trước khi xoá cache/index.sqlite
          const r = await resetAll(projectRoot, b.scopes, { env });
          dropCaches();
          return send(res, 200, r);
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
      }
      if (p === '/api/feedback') {
        let f;
        try {
          f = validateFeedback(await readBody(req));
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
        if (!rateOk()) return send(res, 429, { error: 'Đã gửi quá nhiều phản hồi trong 10 phút, thử lại sau' });
        try {
          return send(res, 201, await createIssue(buildIssue(f, { version: VERSION, node: process.version, platform: `${platform()} ${release()}` })));
        } catch (e) {
          return send(res, 502, { error: e.message });
        }
      }
      if (p === '/api/qc/templates') {
        try {
          return send(res, 200, await saveTemplate(projectRoot, await readBody(req)));
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
      }
      if (p === '/api/qc/render' || p === '/api/qc/generate') {
        const b = await readBody(req);
        const tpl = findTemplate(await readTemplates(projectRoot), String(b.templateId ?? ''));
        if (!tpl) return send(res, 404, { error: 'mẫu không tồn tại' });
        let vars;
        try {
          vars = await qcVars(projectRoot, b);
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
        if (!vars) return send(res, 404, { error: 'chưa có run nào' });
        const { prompt, missing } = renderPrompt(tpl, vars);
        if (p === '/api/qc/render') return send(res, 200, { prompt, missing });
        const ac = new AbortController();
        res.on('close', () => !res.writableEnded && ac.abort());
        let final = null;
        let error = null;
        // dữ liệu từ app / test đi qua khối không tin cậy, và AI không có công cụ nào (không đọc được .env hay mã nguồn)
        const { instructions, evidence } = aiParts(tpl, vars);
        await (qcAi ?? ai).run({ signal: ac.signal, prompt: buildPrompt('qc-template', { instructions, evidence, language: readConfig(projectRoot).ai?.language }), onEvent: (e) => {
          if (e.type === 'done' && !e.isError) final = e.result;
          if (e.type === 'error') error = e.message;
        } });
        if (!final) return send(res, 502, { error: error ?? 'AI không trả lời' });
        let text = final.trim().replace(/^```(?:markdown|md)?\n([\s\S]*)\n```$/, '$1');
        if (SECRET.test(text)) return send(res, 502, { error: 'AI trả về nội dung có dạng token hoặc khoá bí mật: đã bỏ. Kiểm tra dữ liệu của test.' });
        if (typeof b.fingerprintLine === 'string') text = keepFingerprint(text, b.fingerprintLine.slice(0, 300));
        return send(res, 200, { text, missing });
      }
      if (p === '/api/qc/notes') {
        const b = await readBody(req);
        try {
          // đặt mã known bug cho một result cụ thể: lỗi hiện tại được coi là lỗi đã biết của issue đó
          let seen;
          if (b.known && RESULT_ID.test(String(b.resultId ?? ''))) {
            const run = await getRun(projectRoot, String(b.runId ?? ''));
            const r = run?.report.run.results?.find((x) => x.id === b.resultId);
            if (r) seen = [signatureOf(run.report, r)];
          }
          return send(res, 200, { note: await setNote(projectRoot, b.key, { ...b, seen }) });
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
      }
      if (p === '/api/qc/manual') {
        const b = await readBody(req);
        try {
          return send(res, 200, await saveManual(projectRoot, b));
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
      }
      if (p === '/api/cache/clear') {
        const body = await readBody(req);
        const ids = body.ids;
        if (ids !== undefined && !(Array.isArray(ids) && ids.length <= 5000 && ids.every((x) => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x)))) return send(res, 400, { error: 'invalid ids' });
        if (body.testId !== undefined && (typeof body.testId !== 'string' || body.testId.length > 500)) return send(res, 400, { error: 'invalid testId' });
        if (ids === undefined && body.testId === undefined && body.orphans !== true && body.all !== true) return send(res, 400, { error: 'Chỉ rõ cần xoá gì: ids, testId, orphans hoặc all' });
        const orphans = body.orphans === true ? await currentTestIds(projectRoot) : null;
        if (body.orphans === true && !orphans) return send(res, 409, { error: 'Chưa có run nào để biết test nào còn tồn tại' });
        return send(res, 200, { removed: await clearCache(projectRoot, { ids, testId: body.testId, orphansOf: orphans }) });
      }
      if (p === '/api/run/stop') {
        const external = !runner.state().running; // run từ terminal: chỉ đánh dấu interrupted, không giết được process
        const stopped = runner.stop();
        return send(res, 200, { stopped, ...(stopped && external ? { external: true } : {}) });
      }
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
      const status = e.status ?? (e instanceof SyntaxError ? 400 : 500);
      if (status >= 500) void selfHeal?.report({ source: 'server', message: e.message, stack: e.stack, route: req.url?.split('?')[0] }).catch(() => {});
      if (!res.headersSent) send(res, status, { error: e.message });
      else res.end();
    }
  };
}
