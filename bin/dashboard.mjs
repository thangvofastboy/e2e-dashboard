#!/usr/bin/env node
// Entry for /e2e-dashboard: start | setup | stop | status (Task 13 adds export).
import { spawn } from 'node:child_process';
import { readFile, writeFile, copyFile, mkdir, rm, appendFile } from 'node:fs/promises';
import { existsSync, openSync, closeSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DATA_DIR, readServerInfo } from '../reporter/e2e-dashboard.reporter.mjs';
import { findProjectRoot, findConfig } from './project.mjs';

const PLUGIN = fileURLToPath(new URL('..', import.meta.url));
const MAIN = join(PLUGIN, 'server/main.mjs');
const REPORTER = join(PLUGIN, 'reporter/e2e-dashboard.reporter.mjs');
const IMPORT_LINE = "import dashboardReporter from './e2e-dashboard.reporter.mjs';";
const TYPES = "import type { Reporter } from 'e2e';\ndeclare const reporter: Reporter;\nexport default reporter;\n";

export function patchConfig(source) {
  if (source.includes('e2e-dashboard.reporter')) return { source, patched: false, reason: 'already' };
  let out = source;
  if (/reporters\s*:\s*\[/.test(out)) {
    out = out.replace(/(reporters\s*:\s*\[)([^\]]*)\]/, (_m, open, items) =>
      `${open}${items.trim() ? `${items.replace(/,?\s*$/, '')}, ` : ''}dashboardReporter]`);
  } else if (/export\s+default\s+(defineConfig\s*\(\s*)?\{/.test(out)) {
    out = out.replace(/export\s+default\s+(defineConfig\s*\(\s*)?\{/, (m) => `${m}\n  reporters: ['list', dashboardReporter],`);
  } else {
    return { source, patched: false, reason: 'unknown-shape' };
  }
  const imports = [...out.matchAll(/^import .*;\s*$/gm)];
  const at = imports.length ? imports.at(-1).index + imports.at(-1)[0].length : 0;
  out = at ? `${out.slice(0, at)}\n${IMPORT_LINE}${out.slice(at)}` : `${IMPORT_LINE}\n${out}`;
  return { source: out, patched: true };
}

async function ensureGitignore(root) {
  const p = join(root, '.gitignore');
  const cur = existsSync(p) ? await readFile(p, 'utf8') : '';
  if (cur.split(/\r?\n/).includes(`${DATA_DIR}/`)) return;
  await appendFile(p, `${cur && !cur.endsWith('\n') ? '\n' : ''}${DATA_DIR}/\n`);
}

export async function setup(root) {
  const lines = [];
  await mkdir(join(root, DATA_DIR), { recursive: true });
  await copyFile(REPORTER, join(root, 'e2e-dashboard.reporter.mjs'));
  await writeFile(join(root, 'e2e-dashboard.reporter.d.mts'), TYPES);
  await ensureGitignore(root);
  lines.push('Đã copy e2e-dashboard.reporter.mjs (+ .d.mts) vào project — hãy commit 2 file này.');
  const configPath = findConfig(root);
  const r = patchConfig(await readFile(configPath, 'utf8'));
  if (r.patched) {
    await writeFile(configPath, r.source);
    lines.push(`Đã thêm reporter vào ${basename(configPath)}.`);
  } else if (r.reason === 'already') {
    lines.push(`${basename(configPath)} đã có reporter.`);
  } else {
    lines.push(
      `NEEDS_MANUAL_EDIT ${configPath}`,
      `Thêm dòng import: ${IMPORT_LINE}`,
      "Thêm dashboardReporter vào mảng reporters (nếu chưa có mảng: reporters: ['list', dashboardReporter]).",
    );
  }
  return lines;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

async function running(root) {
  const s = readServerInfo(root);
  if (!s?.pid || !alive(s.pid)) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${s.port}/api/info`, { headers: { 'x-e2e-dashboard-token': s.token }, signal: AbortSignal.timeout(2000) });
    return res.ok ? s : null;
  } catch {
    return null;
  }
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch {
    // no browser available (SSH, container); the URL is printed anyway
  }
}

export async function start(root, { open = true } = {}) {
  const existing = await running(root);
  if (existing) {
    const url = `http://127.0.0.1:${existing.port}/?token=${existing.token}`;
    if (open) openBrowser(url);
    return { url, reused: true };
  }
  await mkdir(join(root, DATA_DIR), { recursive: true });
  await ensureGitignore(root); // the dashboard creates .e2e-dashboard/ in the user's repo
  await rm(join(root, DATA_DIR, 'server.json'), { force: true });
  const log = openSync(join(root, DATA_DIR, 'server.log'), 'a');
  const child = spawn(process.execPath, [MAIN, root], { cwd: root, detached: true, stdio: ['ignore', 'pipe', log] });
  closeSync(log);
  const line = await new Promise((ok, fail) => {
    let buf = '';
    const timer = setTimeout(() => fail(new Error('server không khởi động sau 10 s, xem .e2e-dashboard/server.log')), 10_000);
    child.stdout.on('data', (c) => {
      buf += c;
      const i = buf.indexOf('\n');
      if (i >= 0) {
        clearTimeout(timer);
        ok(buf.slice(0, i));
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      fail(new Error(`server thoát với mã ${code}, xem .e2e-dashboard/server.log`));
    });
  });
  child.stdout.destroy();
  child.unref();
  const { url } = JSON.parse(line);
  if (open) openBrowser(url);
  return { url, reused: false };
}

export async function stop(root) {
  const s = readServerInfo(root);
  if (!s?.pid || !alive(s.pid)) {
    await rm(join(root, DATA_DIR, 'server.json'), { force: true });
    return false;
  }
  process.kill(s.pid, 'SIGTERM');
  for (let i = 0; i < 30 && alive(s.pid); i++) await new Promise((r) => setTimeout(r, 100));
  await rm(join(root, DATA_DIR, 'server.json'), { force: true });
  return true;
}

export async function main(argv, cwd) {
  const root = findProjectRoot(cwd);
  if (!root) return { code: 1, out: 'Không tìm thấy e2e.config.(ts|mts|js|mjs) từ thư mục hiện tại trở lên. Chạy `npx e2e init` trước.' };
  const [cmd = 'start'] = argv;
  if (cmd === 'start' || cmd === 'open') {
    const { url, reused } = await start(root, { open: !process.env.E2E_DASHBOARD_NO_OPEN });
    const lines = [`Dashboard${reused ? ' (đang chạy sẵn)' : ''}: ${url}`];
    if (!existsSync(join(root, 'e2e-dashboard.reporter.mjs'))) lines.push('Gợi ý: chạy `/e2e-dashboard setup` để xem tiến độ live.');
    return { code: 0, out: lines.join('\n') };
  }
  if (cmd === 'setup') return { code: 0, out: (await setup(root)).join('\n') };
  if (cmd === 'stop') return { code: 0, out: (await stop(root)) ? 'Đã tắt dashboard.' : 'Dashboard không chạy.' };
  if (cmd === 'status') {
    const s = await running(root);
    return { code: 0, out: s ? `Đang chạy: http://127.0.0.1:${s.port}/?token=${s.token}` : 'Dashboard không chạy.' };
  }
  return { code: 1, out: 'Dùng: /e2e-dashboard [setup|export [runId]|stop|status]' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await main(process.argv.slice(2), process.cwd()).catch((e) => ({ code: 1, out: `Lỗi: ${e.message}` }));
  process.stdout.write(`${r.out}\n`);
  process.exit(r.code);
}
