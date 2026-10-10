import { readFile, stat } from 'node:fs/promises';
import { createReadStream, readFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { safeJoin, realInside, VERSION } from '../reporter/e2e-dashboard.reporter.mjs';
import { listRuns, getRun, findRunDir, setFlag, testHistory } from './store.mjs';
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

export function createApp({ projectRoot, token, uiDir, live, onEvent = () => {}, lastArchive = () => null }) {
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
      if (p === '/api/info') return send(res, 200, { version: VERSION, pid: process.pid, project: basename(projectRoot), reporter: reporterStatus(projectRoot), lastArchive: lastArchive() });
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
