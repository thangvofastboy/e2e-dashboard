// History from elsewhere: CI reports imported by hand or from a GitHub Actions artifact, and a team
// folder (any synced or network directory) to push local runs to and pull teammates' runs from.
import { readdir, readFile, writeFile, mkdir, copyFile, rename, rm, lstat, mkdtemp } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, basename, dirname, relative } from 'node:path';
import { randomBytes } from 'node:crypto';
import { junitToReport } from './junit.mjs';
import { DATA_DIR, RUN_ID, archive, ensureDataDir, isLink, listRunDirs, runSortKey, nestedFromLegacy } from '../reporter/e2e-dashboard.reporter.mjs';

const runsDir = (root) => join(root, DATA_DIR, 'runs');

// `path` is a report.json or the e2e output directory holding one (with results/ beside it), or a junit.xml
// (also what a directory without report.json falls back to): far less detail, but CI often keeps only that.
export async function importReport(root, path, { source = 'ci' } = {}) {
  const p = resolve(path);
  const st = await lstat(p).catch(() => null);
  if (!st || st.isSymbolicLink()) return { status: 'skipped', reason: 'not-found' };
  const dir = st.isDirectory() ? p : dirname(p);
  let reportPath = st.isDirectory() ? join(p, 'report.json') : p;
  if (reportPath.endsWith('.xml') || (st.isDirectory() && !(await lstat(reportPath).catch(() => null)))) {
    const xmlPath = reportPath.endsWith('.xml') ? reportPath : join(p, 'junit.xml');
    const xst = await lstat(xmlPath).catch(() => null);
    if (!xst?.isFile() || xst.size > 10 * 1024 * 1024) return { status: 'skipped', reason: 'not-found' };
    let report;
    try {
      report = junitToReport(await readFile(xmlPath, 'utf8'), { startedAt: xst.mtime.toISOString() });
    } catch (e) {
      return { status: 'skipped', reason: `junit: ${e.message}` };
    }
    return archive(root, { source, report });
  }
  return archive(root, { source, reportPath, artifactsRoot: join(dir, 'results') });
}

// `gh run download <id>` into a temp dir, then import every report.json found in it.
export async function importFromGithub(root, runId, { artifact = null, execImpl = execFile } = {}) {
  if (!/^\d{1,20}$/.test(String(runId))) throw new Error('GitHub run id phải là số');
  if (artifact !== null && !/^[\w. -]{1,100}$/.test(artifact)) throw new Error('tên artifact không hợp lệ');
  const tmp = await mkdtemp(join(tmpdir(), 'e2ed-gh-'));
  try {
    await new Promise((ok, fail) =>
      execImpl('gh', ['run', 'download', String(runId), '-D', tmp, ...(artifact ? ['-n', artifact] : [])], { cwd: root, timeout: 300_000 }, (err, _o, stderr) =>
        err ? fail(new Error(err.code === 'ENOENT' ? 'Không tìm thấy GitHub CLI (gh). Cài gh và chạy gh auth login.' : String(stderr || err.message).trim())) : ok()));
    const reports = [];
    const walk = async (d, depth = 0) => {
      for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
        if (e.isDirectory() && depth < 6) await walk(join(d, e.name), depth + 1);
        else if (e.isFile() && (e.name === 'report.json' || e.name === 'junit.xml')) reports.push(join(d, e.name));
      }
    };
    await walk(tmp);
    // junit.xml only where no report.json sits beside it (the e2e output directory holds both)
    for (let i = reports.length - 1; i >= 0; i--) if (reports[i].endsWith('junit.xml') && reports.includes(join(dirname(reports[i]), 'report.json'))) reports.splice(i, 1);
    const out = [];
    for (const r of reports) out.push({ report: relative(tmp, r), ...(await importReport(root, r, { source: 'ci' })) });
    return out;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// Regular files only, never through a symlink, at most `max` bytes in all.
async function copyTree(src, dst, max = 500 * 1024 * 1024) {
  let total = 0;
  const walk = async (s, d) => {
    await mkdir(d, { recursive: true });
    for (const e of await readdir(s, { withFileTypes: true })) {
      const from = join(s, e.name);
      const to = join(d, e.name);
      if (e.isDirectory()) await walk(from, to);
      else if (e.isFile()) {
        total += (await lstat(from)).size;
        if (total > max) throw new Error('run quá lớn');
        await copyFile(from, to);
      }
    }
  };
  await walk(src, dst);
}

const teamDir = (dir, root) => join(resolve(dir), basename(resolve(root)), 'runs');

export async function sharePush(root, dir) {
  const target = teamDir(dir, root);
  await mkdir(target, { recursive: true });
  const there = new Set(await readdir(target).catch(() => []));
  let pushed = 0;
  let unredacted = 0;
  // thư mục chung giữ tên phẳng kiểu cũ (<ISO>_<id>): đồng đội dùng bản cũ vẫn đọc được
  for (const rel of isLink(runsDir(root)) ? [] : await listRunDirs(runsDir(root))) {
    const name = runSortKey(rel);
    if (there.has(name) || rel.split('/').some((_, i, a) => isLink(join(runsDir(root), ...a.slice(0, i + 1))))) continue;
    const meta = JSON.parse(await readFile(join(runsDir(root), rel, 'meta.json'), 'utf8').catch(() => 'null'));
    if (!meta || meta.source === 'shared') continue; // only our own runs travel
    const tmp = join(target, `.tmp-${randomBytes(6).toString('hex')}`);
    try {
      await copyTree(join(runsDir(root), rel), tmp);
      await rename(tmp, join(target, name));
      pushed++;
      unredacted += Number(meta.unredacted) || 0;
    } catch (e) {
      await rm(tmp, { recursive: true, force: true });
      if (e.code !== 'ENOTEMPTY' && e.code !== 'EEXIST') throw e;
    }
  }
  return { pushed, dir: target, unredacted };
}

// A teammate's runs come in as data only: names, ids and both JSON files are checked first.
export async function sharePull(root, dir, { by = null } = {}) {
  const from = teamDir(dir, root);
  if (!(await ensureDataDir(root)) || isLink(runsDir(root))) throw new Error('unsafe data dir');
  await mkdir(runsDir(root), { recursive: true });
  const local = await listRunDirs(runsDir(root));
  let pulled = 0;
  let skipped = 0;
  for (const name of await readdir(from).catch(() => [])) {
    const id = name.split('_').pop();
    if (name.startsWith('.') || !/^[\w-]+_[0-9a-f-]+$/i.test(name) || !RUN_ID.test(id) || local.some((d) => d.endsWith(`_${id}`)) || isLink(join(from, name))) continue;
    const tmp = join(runsDir(root), `.tmp-${randomBytes(6).toString('hex')}`);
    try {
      const meta = JSON.parse(await readFile(join(from, name, 'meta.json'), 'utf8'));
      const report = JSON.parse(await readFile(join(from, name, 'report.json'), 'utf8'));
      if (meta.runId !== id || report.run?.id !== id || report.schemaVersion !== 'report-1') throw new Error('bad run');
      await copyTree(join(from, name), tmp);
      await writeFile(join(tmp, 'meta.json'), JSON.stringify({ ...meta, source: 'shared', sharedSource: String(meta.source ?? ''), sharedBy: by, pinned: false, baseline: false }, null, 2));
      await rm(join(tmp, 'ai'), { recursive: true, force: true }); // AI answers are not ours to show as cached
      const rel = nestedFromLegacy(name) ?? name; // về máy: runs/YYYY/MM/DD/…
      const dest = join(runsDir(root), rel);
      if (rel.split('/').slice(0, -1).some((_, i, a) => isLink(join(runsDir(root), ...a.slice(0, i + 1))))) throw new Error('unsafe');
      await mkdir(dirname(dest), { recursive: true });
      await rename(tmp, dest);
      pulled++;
    } catch {
      await rm(tmp, { recursive: true, force: true });
      skipped++;
    }
  }
  return { pulled, skipped, dir: from };
}

