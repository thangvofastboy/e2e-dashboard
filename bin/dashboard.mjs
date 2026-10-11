#!/usr/bin/env node
// Entry for /e2e-dashboard: start | setup | export | stop | status | digest | projects | statusline.
import { spawn } from 'node:child_process';
import { readFile, writeFile, copyFile, mkdir, rm, appendFile, lstat } from 'node:fs/promises';
import { existsSync, openSync, closeSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DATA_DIR, readServerInfo, ensureDataDir } from '../reporter/e2e-dashboard.reporter.mjs';
import { findProjectRoot, findConfig } from './project.mjs';
import { exportRun } from '../server/export.mjs';
import { buildDigest } from '../server/digest.mjs';
import { projectSummaries, homeDir } from '../server/projects.mjs';
import { readQuarantine, quarantineFlags } from '../server/quarantine.mjs';
import { importReport, importFromGithub, sharePush, sharePull } from '../server/share.mjs';
import { webhookConfig, sendWebhooks } from '../server/webhook.mjs';

const PLUGIN = fileURLToPath(new URL('..', import.meta.url));
const MAIN = join(PLUGIN, 'server/main.mjs');
const REPORTER = join(PLUGIN, 'reporter/e2e-dashboard.reporter.mjs');
const STATUSLINE = join(PLUGIN, 'bin/statusline.mjs');
const IMPORT_LINE = "import dashboardReporter from './e2e-dashboard.reporter.mjs';";
const TYPES = "import type { Reporter } from 'e2e';\ndeclare const reporter: Reporter;\nexport default reporter;\n";

export function patchConfig(source) {
  if (source.includes('e2e-dashboard.reporter')) return { source, patched: false, reason: 'already' };
  let out = source;
  const arr = /reporters\s*:\s*\[([^\]]*)\]/.exec(out);
  const odd = (s, q) => (s.split(q).length - 1) % 2 === 1;
  if (arr && (/[[\](){}]|\/\/|\/\*/.test(arr[1]) || odd(arr[1], "'") || odd(arr[1], '"') || odd(arr[1], '`')))
    return { source, patched: false, reason: 'unknown-shape' }; // nested or commented arrays: leave it to a human
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

// The project is someone else's repo: never follow a symlink it planted where we write.
async function refuseSymlink(p) {
  const st = await lstat(p).catch(() => null);
  if (st?.isSymbolicLink()) throw new Error(`Từ chối ghi qua symlink: ${p}`);
}

async function ensureGitignore(root) {
  const p = join(root, '.gitignore');
  await refuseSymlink(p);
  const cur = existsSync(p) ? await readFile(p, 'utf8') : '';
  if (cur.split(/\r?\n/).includes(`${DATA_DIR}/`)) return;
  await appendFile(p, `${cur && !cur.endsWith('\n') ? '\n' : ''}${DATA_DIR}/\n`);
}

export async function setup(root) {
  const lines = [];
  await refuseSymlink(join(root, DATA_DIR));
  await mkdir(join(root, DATA_DIR), { recursive: true });
  await refuseSymlink(join(root, 'e2e-dashboard.reporter.mjs'));
  await copyFile(REPORTER, join(root, 'e2e-dashboard.reporter.mjs'));
  await refuseSymlink(join(root, 'e2e-dashboard.reporter.d.mts'));
  await writeFile(join(root, 'e2e-dashboard.reporter.d.mts'), TYPES);
  await ensureGitignore(root);
  lines.push('Đã copy e2e-dashboard.reporter.mjs (+ .d.mts) vào project — hãy commit 2 file này.');
  const configPath = findConfig(root);
  const r = patchConfig(await readFile(configPath, 'utf8'));
  if (r.patched) {
    await refuseSymlink(configPath);
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
    if (!res.ok) return null;
    // server.json comes from the repo: trust the pid only when our server reports the same one
    return (await res.json()).pid === s.pid ? s : null;
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
  await refuseSymlink(join(root, DATA_DIR));
  await ensureDataDir(root); // self-ignoring .e2e-dashboard/; the user's .gitignore is only touched by setup
  await rm(join(root, DATA_DIR, 'server.json'), { force: true });
  await refuseSymlink(join(root, DATA_DIR, 'server.log'));
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
  const s = await running(root);
  if (!s) {
    await rm(join(root, DATA_DIR, 'server.json'), { force: true });
    return false;
  }
  process.kill(s.pid, 'SIGTERM');
  for (let i = 0; i < 30 && alive(s.pid); i++) await new Promise((r) => setTimeout(r, 100));
  await rm(join(root, DATA_DIR, 'server.json'), { force: true });
  return true;
}

// Weekly digest as Markdown: printed, and kept in .e2e-dashboard/digests/<date>.md.
export async function writeDigest(root, days = 7, now = Date.now()) {
  const out = await buildDigest(root, { days, now });
  const dir = join(root, DATA_DIR, 'digests');
  await refuseSymlink(join(root, DATA_DIR));
  await ensureDataDir(root);
  await refuseSymlink(dir);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${new Date(now).toISOString().slice(0, 10)}.md`);
  await refuseSymlink(file);
  await writeFile(file, out.markdown);
  return { ...out, file };
}

const claudeDir = (env = process.env) => env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');

// Copies the status line script to ~/.e2e-dashboard (stable across plugin updates) and, unless the
// user already has a status line, points ~/.claude/settings.json at it.
export async function installStatusline(env = process.env) {
  const target = join(homeDir(env), 'statusline.mjs');
  await mkdir(dirname(target), { recursive: true });
  await refuseSymlink(target);
  await copyFile(STATUSLINE, target);
  const command = `node "${target}"`;
  const settingsPath = join(claudeDir(env), 'settings.json');
  await refuseSymlink(settingsPath);
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    } catch {
      return { target, command, changed: false, reason: 'unreadable', settingsPath };
    }
  }
  if (settings.statusLine) {
    return { target, command, changed: false, reason: settings.statusLine.command === command ? 'already' : 'exists', settingsPath };
  }
  settings.statusLine = { type: 'command', command, padding: 0 };
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  return { target, command, changed: true, settingsPath };
}

export async function main(argv, cwd) {
  const [first] = argv;
  if (first === 'projects') {
    const list = await projectSummaries(findProjectRoot(cwd) ?? cwd);
    if (!list.length) return { code: 0, out: 'Chưa có project nào mở dashboard.' };
    return { code: 0, out: list.map((p) => `${p.current ? '▸' : ' '} ${p.name} — ${p.latest ? `${p.latest.status}, ${p.runs} run` : 'chưa có run'}${p.health ? `, health ${p.health.score}` : ''}${p.url ? ` · ${p.url}` : ''}\n    ${p.root}`).join('\n') };
  }
  if (first === 'statusline') {
    if (argv[1] !== 'install') {
      return { code: 0, out: ['Status line cho Claude Code: kết quả run e2e mới nhất, hoặc tiến độ khi đang chạy.', 'Cài: /e2e-dashboard statusline install', `Hoặc thêm thủ công vào ~/.claude/settings.json:`, `  "statusLine": { "type": "command", "command": "node \"${join(homeDir(), 'statusline.mjs')}\"" }`].join('\n') };
    }
    const r = await installStatusline();
    if (r.changed) return { code: 0, out: `Đã cài status line (${r.target}) vào ${r.settingsPath}.` };
    if (r.reason === 'already') return { code: 0, out: 'Status line đã được cài.' };
    return { code: 0, out: [`Đã copy script vào ${r.target}.`, r.reason === 'unreadable' ? `Không đọc được ${r.settingsPath}: tự thêm statusLine.` : `Bạn đã có statusLine trong ${r.settingsPath}, nên không ghi đè.`, `Lệnh: ${r.command}`].join('\n') };
  }
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
  if (cmd === 'export') {
    const p = await exportRun(root, argv[1]);
    return p ? { code: 0, out: `Đã xuất: ${p}` } : { code: 1, out: argv[1] ? `Không tìm thấy run ${argv[1]}.` : 'Chưa có run nào để xuất.' };
  }
  if (cmd === 'quarantine') {
    const q = quarantineFlags(await readQuarantine(root));
    if (!q.active.length && !q.expired.length) return { code: 0, out: 'Không có test nào đang cách ly. Cách ly từ trang Flaky của dashboard.' };
    return {
      code: 0,
      out: [
        ...q.active.map((x) => `🔒 ${x.title} — đến ${x.until.slice(0, 10)}${x.reason ? ` (${x.reason})` : ''}`),
        ...q.expired.map((x) => `⚠️ ${x.title} — quá hạn từ ${x.until.slice(0, 10)}: sửa hoặc gỡ cách ly`),
        '',
        q.command ? `Chạy bỏ qua test đang cách ly (dùng được trong CI):\n${q.command}` : '',
      ].join('\n').trim(),
    };
  }
  if (cmd === 'import') {
    const gh = argv.indexOf('--gh');
    if (gh >= 0) {
      const name = argv.indexOf('--name') >= 0 ? argv[argv.indexOf('--name') + 1] : null;
      const res = await importFromGithub(root, argv[gh + 1], { artifact: name });
      if (!res.length) return { code: 1, out: 'Artifact không có report.json nào.' };
      return { code: 0, out: res.map((r) => `${r.report}: ${r.status}${r.reason ? ` (${r.reason})` : ''}`).join('\n') };
    }
    if (!argv[1]) return { code: 1, out: 'Dùng: /e2e-dashboard import <report.json | thư mục output> hoặc import --gh <run id> [--name <artifact>]' };
    const r = await importReport(root, resolve(cwd, argv[1]));
    return { code: r.status === 'skipped' ? 1 : 0, out: r.status === 'archived' ? `Đã nhập run vào lịch sử (${r.runDir}).` : r.status === 'exists' ? 'Run này đã có trong lịch sử.' : `Không nhập được: ${r.reason}` };
  }
  if (cmd === 'share') {
    const [, sub, dirArg] = argv;
    let dir = dirArg;
    if (!dir) {
      try {
        dir = JSON.parse(await readFile(join(homeDir(), 'config.json'), 'utf8'))?.share?.dir;
      } catch {
        dir = null;
      }
    }
    if ((sub !== 'push' && sub !== 'pull') || typeof dir !== 'string' || !dir) return { code: 1, out: 'Dùng: /e2e-dashboard share push|pull <thư mục chung> (hoặc đặt "share": { "dir": … } trong ~/.e2e-dashboard/config.json)' };
    if (sub === 'push') {
      const r = await sharePush(root, dir);
      return { code: 0, out: `Đã đẩy ${r.pushed} run lên ${r.dir}.` };
    }
    const r = await sharePull(root, dir, { by: process.env.USER ?? null });
    return { code: 0, out: `Đã lấy ${r.pulled} run từ ${r.dir}${r.skipped ? ` (bỏ qua ${r.skipped} run không hợp lệ)` : ''}.` };
  }
  if (cmd === 'digest') {
    const days = Number.parseInt(argv.slice(1).find((a) => /^\d+$/.test(a)) ?? '7', 10);
    const r = await writeDigest(root, days > 0 && days <= 90 ? days : 7);
    let sent = '';
    if (argv.includes('--send')) {
      const hooks = await webhookConfig();
      const res = hooks.length ? await sendWebhooks(hooks, 'digest', r.markdown) : [];
      sent = res.length ? `\nĐã gửi webhook: ${res.map((x) => `${x.host} ${x.ok ? '✓' : `✗ ${x.status ?? x.error}`}`).join(', ')}` : '\nChưa có webhook (thêm "webhooks" vào ~/.e2e-dashboard/config.json).';
    }
    return { code: 0, out: `${r.markdown}\nĐã lưu: ${r.file}${sent}` };
  }
  return { code: 1, out: 'Dùng: /e2e-dashboard [setup|export [runId]|stop|status|digest [ngày]|projects|statusline [install]|quarantine|import …|share push|pull [dir]]' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await main(process.argv.slice(2), process.cwd()).catch((e) => ({ code: 1, out: `Lỗi: ${e.message}` }));
  process.stdout.write(`${r.out}\n`);
  process.exit(r.code);
}
