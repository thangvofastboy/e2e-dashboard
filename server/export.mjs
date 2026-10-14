import { readFile, readdir, stat, mkdir, writeFile, rename, lstat } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { join, relative, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, realInside } from '../reporter/e2e-dashboard.reporter.mjs';
import { listRuns, getRun, listAi } from './store.mjs';
import { bundleUi } from '../ui/bundle.mjs';

const UI_DIR = fileURLToPath(new URL('../ui', import.meta.url));
const MAX_FILE = 5 * 1024 * 1024;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.md': 'text/markdown', '.txt': 'text/plain', '.log': 'text/plain', '.json': 'application/json' };

export function embedJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.isFile()) out.push(p); // symlinks planted in a run dir are never followed
  }
  return out;
}

async function embeddedFiles(runDir, runId) {
  const files = {};
  for (const sub of ['artifacts', 'traces']) {
    for (const p of await walk(join(runDir, sub))) {
      const type = MIME[extname(p).toLowerCase()];
      if (!type || !realInside(runDir, p) || (await stat(p)).size > MAX_FILE) continue; // videos and unknown types stay out
      const rel = relative(runDir, p).split(sep).join('/');
      files[`runs/${runId}/${rel}`] = `data:${type};base64,${(await readFile(p)).toString('base64')}`;
    }
  }
  return files;
}

export async function buildExportHtml(root, runId) {
  const id = runId ?? (await listRuns(root))[0]?.runId;
  const run = id && (await getRun(root, id));
  if (!run) return null;
  const data = {
    runId: run.meta.runId,
    exportedAt: new Date().toISOString(),
    api: {
      '/api/runs': [run.meta],
      [`/api/runs/${run.meta.runId}`]: { meta: run.meta, report: run.report },
      [`/api/runs/${run.meta.runId}/ai`]: { entries: (await listAi(root, run.meta.runId)) ?? [] },
    },
    files: await embeddedFiles(run.dir, run.meta.runId),
  };
  const [index, css, js] = await Promise.all([readFile(join(UI_DIR, 'index.html'), 'utf8'), readFile(join(UI_DIR, 'style.css'), 'utf8'), bundleUi(UI_DIR)]);
  const dataScript = `globalThis.__E2ED_EXPORT__ = ${embedJson(data)};`;
  const appScript = `\n${js.replace(/<\/script/gi, '<\\/script')}\n`;
  const hash = (s) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;
  // the file is opened outside the server, so it carries its own CSP: only these two scripts may run
  const csp = `default-src 'none'; script-src ${hash(dataScript)} ${hash(appScript)}; style-src 'unsafe-inline'; img-src data:; media-src https:; connect-src data:`;
  const html = index
    .replace('<meta charset="utf-8">', () => `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`)
    .replace('<link rel="stylesheet" href="/style.css">', () => `<style>\n${css}\n</style>`)
    .replace('<script src="/app.js"></script>', () => `<script>${dataScript}</script>\n<script>${appScript}</script>`);
  // id đã qua RUN_ID (findRunDir); meta.runId là dữ liệu trong repo / CI, không được thành tên file hay header
  return { html, runId: id };
}

export async function exportRun(root, runId) {
  const out = await buildExportHtml(root, runId);
  if (!out) return null;
  const dir = join(root, DATA_DIR, 'exports');
  if ((await lstat(dir).catch(() => null))?.isSymbolicLink()) throw new Error(`Từ chối ghi qua symlink: ${dir}`);
  await mkdir(dir, { recursive: true });
  const p = join(dir, `run-${out.runId}.html`);
  // write then rename: a symlink planted at p is replaced, never written through
  const tmp = join(dir, `.tmp-${randomBytes(6).toString('hex')}`);
  await writeFile(tmp, out.html);
  await rename(tmp, p);
  return p;
}
