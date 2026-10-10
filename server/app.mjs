import { readFile, stat } from 'node:fs/promises';
import { createReadStream, readFileSync } from 'node:fs';
import { join, extname, basename, relative } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { safeJoin, realInside, readConfig, VERSION, RUN_ID, RESULT_ID } from '../reporter/e2e-dashboard.reporter.mjs';
import { listRuns, getRun, findRunDir, setFlag, testHistory, getAi, writeAi, listAi } from './store.mjs';
import { buildPrompt, cacheKey, commitsBetween } from './ai.mjs';
import { estimateEta } from './live.mjs';
import { bundleUi } from '../ui/bundle.mjs';
import { buildExportHtml } from './export.mjs';

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
    return createReadStream(path, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'content-length': st.size });
  createReadStream(path).pipe(res);
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
  const older = metas.slice(metas.findIndex((m) => m.runId === run.meta.runId) + 1, metas.findIndex((m) => m.runId === run.meta.runId) + 21);
  if (action === 'analyze-run') return commitsBetween(projectRoot, older[0]?.git?.commit, to);
  const r = (run.report.run.results ?? []).find((x) => x.id === resultId);
  for (const m of older) {
    const prev = await getRun(projectRoot, m.runId).catch(() => null);
    const same = prev?.report.run.results?.find((x) => x.testId === r.testId && x.targetId === r.targetId && (x.agent ?? 'default') === (r.agent ?? 'default'));
    if (same?.status === 'passed') return commitsBetween(projectRoot, m.git?.commit, to);
  }
  return [];
}

const IDLE_RUNNER = { start: () => ({ ok: false, error: 'unavailable' }), stop: () => false, state: () => ({ running: false, pid: null }) };

export function createApp({ projectRoot, token, uiDir, live, onEvent = () => {}, lastArchive = () => null, runner = IDLE_RUNNER, ai = NO_AI }) {
  let avgByKey = new Map();
  const refreshAverages = () =>
    testHistory(projectRoot, 10)
      .then((rows) => {
        avgByKey = new Map(rows.filter((r) => r.avgDurationMs != null).map((r) => [r.key, r.avgDurationMs]));
      })
      .catch(() => {});
  refreshAverages();
  const withEta = (s) => ({ ...s, etaMs: estimateEta(s, avgByKey) });

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
      if (p === '/api/info') return send(res, 200, { version: VERSION, pid: process.pid, project: basename(projectRoot), reporter: reporterStatus(projectRoot), lastArchive: lastArchive(), thresholds: readConfig(projectRoot).thresholds ?? null, runner: runner.state() });
      if (p === '/api/runs') return send(res, 200, await listRuns(projectRoot));
      if (p === '/api/tests') return send(res, 200, await testHistory(projectRoot, 10));
      if (p === '/api/live') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        const write = (s) => res.write(`data: ${JSON.stringify(withEta(s))}\n\n`);
        write(live.snapshot());
        const off = live.subscribe(write);
        const beat = setInterval(() => res.write(': ping\n\n'), 15_000);
        req.on('close', () => {
          off();
          clearInterval(beat);
        });
        return;
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
        const file = dir && safeJoin(dir, decodeURIComponent(m[2]));
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
        const action = /^\/api\/ai\/(analyze-failure|analyze-run|followup)$/.exec(p)?.[1];
        if (!action) return send(res, 404, { error: 'unknown action' });
        const body = await readBody(req);
        const run = await getRun(projectRoot, body.runId);
        if (!run) return send(res, 404, { error: 'run not found' });
        const ac = new AbortController();
        res.on('close', () => !res.writableEnded && ac.abort()); // tab closed → never start or keep claude
        let prompt;
        let resume;
        let key = null;
        if (action === 'followup') {
          const ok = typeof body.sessionId === 'string' && /^[\w-]{1,100}$/.test(body.sessionId) && typeof body.question === 'string' && body.question.trim() && body.question.length <= 4000;
          if (!ok) return send(res, 400, { error: 'invalid follow-up' });
          prompt = body.question;
          resume = body.sessionId;
        } else {
          if (action === 'analyze-failure' && !RESULT_ID.test(String(body.resultId ?? ''))) return send(res, 400, { error: 'invalid resultId' });
          if (action === 'analyze-failure' && !(run.report.run.results ?? []).some((r) => r.id === body.resultId)) return send(res, 404, { error: 'result not found' });
          key = cacheKey(action, run.meta.runId, action === 'analyze-failure' ? body.resultId : '');
          const cached = body.refresh ? null : await getAi(projectRoot, run.meta.runId, key);
          if (cached) {
            const write = startSse(res);
            write({ type: 'cached', ...cached });
            write({ type: 'done', cached: true });
            return res.end();
          }
          const commits = await commitsFor(projectRoot, run, action, body.resultId);
          prompt = buildPrompt(action, { report: run.report, meta: run.meta, resultId: body.resultId, runDir: relative(projectRoot, run.dir), commits, language: readConfig(projectRoot).ai?.language });
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
      if (p === '/api/run') {
        const body = await readBody(req);
        if (body.rerunOf !== undefined && !RUN_ID.test(String(body.rerunOf))) return send(res, 400, { error: 'invalid rerunOf' });
        let out;
        try {
          const RUN_KEYS = ['tests', 'targets', 'agents', 'retries', 'repeatEach', 'noCache', 'rerunOf'];
          out = runner.start(Object.fromEntries(RUN_KEYS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]])));
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
