// Static report site (M7): index.html (90-day report + 12-month calendar) and the latest runs as
// self-contained HTML, in a folder you can push to GitHub Pages or a shared drive. The folder is
// .e2e-dashboard/site unless the user passes one (CLI) or sets "publish": { "dir" } in their own
// ~/.e2e-dashboard/config.json — never from the repo's config, which a clone controls.
import { mkdir, writeFile, rename, rm, lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DATA_DIR, ensureDataDir } from '../reporter/e2e-dashboard.reporter.mjs';
import { listRuns } from './store.mjs';
import { buildExportHtml } from './export.mjs';
import { buildReport } from './reports.mjs';
import { reportHtml } from './report-html.mjs';
import { homeDir } from './projects.mjs';

export async function siteDir(root, dir = null, env = process.env) {
  if (dir) return resolve(dir);
  try {
    const d = JSON.parse(await readFile(join(homeDir(env), 'config.json'), 'utf8'))?.publish?.dir;
    if (typeof d === 'string' && d) return resolve(d);
  } catch {
    // default below
  }
  return join(root, DATA_DIR, 'site');
}

async function put(dir, name, text) {
  const p = join(dir, name);
  const tmp = join(dir, `.tmp-${randomBytes(6).toString('hex')}`);
  await writeFile(tmp, text, { flag: 'wx' });
  try {
    await rename(tmp, p); // a symlink planted at p is replaced, never written through
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

export async function publishSite(root, { dir = null, runs = 10, env = process.env } = {}) {
  const out = await siteDir(root, dir, env);
  if (out.startsWith(join(root, DATA_DIR)) && !(await ensureDataDir(root))) throw new Error('unsafe data dir');
  for (const d of [out, join(out, 'runs')]) {
    if ((await lstat(d).catch(() => null))?.isSymbolicLink()) throw new Error(`Từ chối ghi qua symlink: ${d}`);
    await mkdir(d, { recursive: true });
  }
  const metas = (await listRuns(root)).filter((m) => m.kind !== 'explore').slice(0, Math.max(0, Math.min(50, runs)));
  const links = [];
  for (const m of metas) {
    const x = await buildExportHtml(root, m.runId).catch(() => null);
    if (!x) continue;
    await put(join(out, 'runs'), `${x.runId}.html`, x.html);
    links.push({ href: `runs/${x.runId}.html`, label: `${m.git?.branch ?? ''}${m.git?.commit ? `@${String(m.git.commit).slice(0, 7)}` : ''} ${m.runId.slice(-8)}`.trim(), status: m.status, at: m.startedAt });
  }
  const data = await buildReport(root, { kind: 'site', calendar: true });
  await put(out, 'index.html', reportHtml(data, { runs: links }));
  await put(out, '.nojekyll', '');
  return { dir: out, runs: links.length, index: join(out, 'index.html') };
}
