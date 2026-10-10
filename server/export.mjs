import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { join, relative, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from '../reporter/e2e-dashboard.reporter.mjs';
import { listRuns, getRun } from './store.mjs';
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
    else out.push(p);
  }
  return out;
}

async function embeddedFiles(runDir, runId) {
  const files = {};
  for (const sub of ['artifacts', 'traces']) {
    for (const p of await walk(join(runDir, sub))) {
      const type = MIME[extname(p).toLowerCase()];
      if (!type || (await stat(p)).size > MAX_FILE) continue; // videos and unknown types stay out
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
    api: { '/api/runs': [run.meta], [`/api/runs/${run.meta.runId}`]: { meta: run.meta, report: run.report } },
    files: await embeddedFiles(run.dir, run.meta.runId),
  };
  const [index, css, js] = await Promise.all([readFile(join(UI_DIR, 'index.html'), 'utf8'), readFile(join(UI_DIR, 'style.css'), 'utf8'), bundleUi(UI_DIR)]);
  const html = index
    .replace('<link rel="stylesheet" href="/style.css">', () => `<style>\n${css}\n</style>`)
    .replace('<script src="/app.js"></script>', () =>
      `<script>globalThis.__E2ED_EXPORT__ = ${embedJson(data)};</script>\n<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`);
  return { html, runId: run.meta.runId };
}

export async function exportRun(root, runId) {
  const out = await buildExportHtml(root, runId);
  if (!out) return null;
  const dir = join(root, DATA_DIR, 'exports');
  await mkdir(dir, { recursive: true });
  const p = join(dir, `run-${out.runId}.html`);
  await writeFile(p, out.html);
  return p;
}
