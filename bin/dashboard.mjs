#!/usr/bin/env node
// Entry for /e2e-dashboard: start | setup | doctor | export | stop | status | digest | report | gate | fix | triage | quarantine | import | share | publish | mark | ci-sync | projects | statusline.
import { spawn } from 'node:child_process';
import { readFile, writeFile, copyFile, mkdir, rm, appendFile, lstat } from 'node:fs/promises';
import { existsSync, openSync, closeSync } from 'node:fs';
import { join, basename, dirname, resolve, relative } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DATA_DIR, VERSION, readServerInfo, ensureDataDir, readConfig, dataPath, legacyDataPath, listRunDirs, isLegacyRunName, nestedFromLegacy, STATE_FILES, RUNTIME_FILES, isLink, pruneEmptyParents } from '../reporter/e2e-dashboard.reporter.mjs';
import { findProjectRoot, findConfig } from './project.mjs';
import { exportRun } from '../server/export.mjs';
import { buildDigest } from '../server/digest.mjs';
import { runGate } from '../server/gate.mjs';
import { getRun, listRuns, getAi, loadHistory } from '../server/store.mjs';
import { cacheKey, commitsBetween } from '../server/ai.mjs';
import { resultAttempts, RESULT_ID } from '../reporter/e2e-dashboard.reporter.mjs';
import { projectSummaries, homeDir } from '../server/projects.mjs';
import { readQuarantine, quarantineFlags } from '../server/quarantine.mjs';
import { importReport, importFromGithub, sharePush, sharePull } from '../server/share.mjs';
import { webhookConfig, sendWebhooks } from '../server/webhook.mjs';
import { buildReport, sendReport } from '../server/reports.mjs';
import { reportMarkdown, reportHtml } from '../server/report-html.mjs';
import { publishSite } from '../server/site.mjs';
import { addEvent, EVENT_KINDS } from '../server/events.mjs';
import { ciConfig, syncCi } from '../server/cisync.mjs';
import { syncTriage, triageBoard } from '../server/triage.mjs';
import { writeText } from '../server/jsonstate.mjs';
import { ensureEnvFile } from '../server/system.mjs';
import { patchBrowser } from '../server/browsers.mjs';

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
  // trình duyệt chọn được khi chạy: config đọc E2E_BROWSER (dashboard truyền khi chạy test, mặc định chromium)
  const b = patchBrowser(await readFile(configPath, 'utf8'));
  if (b.patched) {
    await refuseSymlink(configPath);
    await writeFile(configPath, b.source);
    lines.push(`Đã thêm browser: process.env.E2E_BROWSER ?? 'chromium' vào web({...}) trong ${basename(configPath)}: chọn được trình duyệt khi chạy test.`);
  } else if (b.reason === 'unknown-shape') lines.push(`Không tìm thấy web({...}) trong ${basename(configPath)}: thêm tay browser: process.env.E2E_BROWSER ?? 'chromium' để chọn trình duyệt khi chạy test.`);
  lines.push(...(await ensureEnvFile(root)));
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
    const info = await res.json();
    return info.pid === s.pid ? { ...s, busy: Boolean(info.runner?.running) } : null;
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
  // bản cũ nhưng đang chạy run do dashboard khởi động: tắt server sẽ đứt stdout của run, nên giữ đến khi run xong
  if (existing && (existing.version === VERSION || existing.busy)) {
    const url = `http://127.0.0.1:${existing.port}/?token=${existing.token}`;
    if (open) openBrowser(url);
    return { url, reused: true, ...(existing.version !== VERSION ? { staleVersion: existing.version ?? '?' } : {}) };
  }
  // server của bản plugin cũ (vd. trước khi update): vẫn chạy code ở thư mục cache cũ, phải tắt rồi chạy lại
  if (existing) await stop(root);
  await refuseSymlink(join(root, DATA_DIR));
  await ensureDataDir(root); // self-ignoring .e2e-dashboard/; the user's .gitignore is only touched by setup
  await rm(join(root, DATA_DIR, 'server.json'), { force: true });
  const logPath = dataPath(root, 'server.log'); // runtime/server.log
  await refuseSymlink(dirname(logPath));
  await mkdir(dirname(logPath), { recursive: true });
  await refuseSymlink(logPath);
  const log = openSync(logPath, 'a');
  const child = spawn(process.execPath, [MAIN, root], { cwd: root, detached: true, stdio: ['ignore', 'pipe', log] });
  closeSync(log);
  const line = await new Promise((ok, fail) => {
    let buf = '';
    const timer = setTimeout(() => {
      child.kill(); // a late start would otherwise leave an orphan server that `stop` cannot see
      fail(new Error('server không khởi động sau 10 s, xem .e2e-dashboard/server.log'));
    }, 10_000);
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

const FAILING = new Set(['failed', 'timed-out', 'interrupted', 'flaky']);

// Everything Claude Code needs to fix a failing test, behind a FIX_REQUEST marker that
// commands/e2e-dashboard.md turns into "read, fix, rerun". Report text is fenced as data.
export async function fixContext(root, runId, resultId) {
  const metas = await listRuns(root);
  const id = runId && runId !== 'latest' ? runId : metas.find((m) => m.summary?.failed || m.summary?.flaky)?.runId;
  const run = id && (await getRun(root, id));
  if (!run) return null;
  const results = (run.report.run.results ?? []).filter((r) => (resultId ? r.id === resultId : FAILING.has(r.status))).slice(0, 5);
  if (!results.length) return { run, text: null };
  const prevPass = metas.slice(metas.findIndex((m) => m.runId === id) + 1).find((m) => m.status === 'passed');
  const commits = await commitsBetween(root, prevPass?.git?.commit, run.meta.git?.commit);
  const one = (s, n) => String(s ?? '?').replace(/\s+/g, ' ').slice(0, n); // meta.json is repo-controlled: no injected lines
  const lines = ['FIX_REQUEST', `Run: ${one(run.meta.runId, 40)} · ${one(run.meta.git?.branch, 80)}@${one(run.meta.git?.commit ?? '', 10)}`, '<test-data>'];
  const specs = [];
  for (const r of results) {
    const a = resultAttempts(run.report, r).at(-1);
    const e = a?.error;
    const spec = r.source?.line ? `${r.source.file ?? r.file}:${r.source.line}` : r.source?.file ?? r.file;
    if (/^[\w./@+-]+(:\d+)?$/.test(spec ?? '')) specs.push(spec);
    const failed = (a?.steps ?? []).find((x) => x.status !== 'passed');
    lines.push(`## ${(r.titlePath ?? []).join(' › ')} [${r.targetId}] (${r.status})`, `File: ${spec}`);
    if (e) lines.push(`Lỗi: ${e.code ?? 'ERROR'}: ${String(e.message ?? '').slice(0, 800)}`, ...['locator', 'expected', 'observed'].filter((k) => e.details?.[k]).map((k) => `${k}: ${String(e.details[k]).slice(0, 300)}`));
    if (e?.source) lines.push(`Vị trí lỗi: ${e.source.file}:${e.source.line}`);
    if (failed) lines.push(`Step fail: ${failed.api} "${String(failed.label ?? '').slice(0, 300)}"`);
    if (a?.failure?.url) lines.push(`URL lúc fail: ${a.failure.url}`);
    const logs = (a?.appLog ?? []).filter((l) => l.level === 'error').slice(0, 8);
    if (logs.length) lines.push('Log app:', ...logs.map((l) => `- [${l.source}] ${String(l.text).slice(0, 200)}`));
    if (run.meta.traces?.[r.id] && RESULT_ID.test(r.id)) lines.push(`Trace: ${join(relative(root, run.dir), run.meta.traces[r.id])}`);
    const ai = await getAi(root, run.meta.runId, cacheKey('analyze-failure', run.meta.runId, r.id));
    if (ai?.markdown) lines.push('Phân tích AI đã có:', ai.markdown.slice(0, 3000));
    lines.push('');
  }
  if (commits.length) lines.push(`Commit kể từ lần pass gần nhất:`, ...commits.slice(0, 15).map((c) => `- ${c}`));
  // report text must not be able to close the data fence early
  for (let i = 3; i < lines.length; i++) lines[i] = lines[i].replace(/<(\/?)test-data/gi, '‹$1test-data');
  lines.push('</test-data>', '', `Chạy lại sau khi sửa: npx e2e run ${[...new Set(specs)].join(' ')} --retries 0`);
  return { run, text: lines.join('\n') };
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
    const { url, reused, staleVersion } = await start(root, { open: !process.env.E2E_DASHBOARD_NO_OPEN });
    const lines = [`Dashboard${reused ? ' (đang chạy sẵn)' : ''}: ${url}`];
    if (staleVersion) lines.push(`Dashboard đang chạy bản ${staleVersion} và có run chưa xong — giữ nguyên để không cắt run. Chạy lại \`/e2e-dashboard\` sau khi run xong để lên bản ${VERSION}.`);
    if (!existsSync(join(root, 'e2e-dashboard.reporter.mjs'))) lines.push('Gợi ý: chạy `/e2e-dashboard setup` để xem tiến độ live.');
    return { code: 0, out: lines.join('\n') };
  }
  if (cmd === 'setup') return { code: 0, out: (await setup(root)).join('\n') };
  if (cmd === 'doctor') {
    // chuyển dữ liệu .e2e-dashboard sang bố cục mới (runs theo ngày, state/, runtime/), dựng lại chỉ mục SQLite
    const { doctor } = await import('../server/doctor.mjs');
    const { reporterStatus } = await import('../server/app.mjs');
    const dryRun = argv.includes('--dry-run');
    const r = await doctor(root, { dryRun, reporter: reporterStatus(root) });
    return { code: 0, out: [dryRun ? 'Doctor (xem trước, chưa đổi gì):' : 'Doctor:', ...r.lines.map((l) => `- ${l}`), ...r.warn.map((w) => `- Lưu ý: ${w}`)].join('\n') };
  }
  if (cmd === 'stop') return { code: 0, out: (await stop(root)) ? 'Đã tắt dashboard.' : 'Dashboard không chạy.' };
  if (cmd === 'status') {
    const s = await running(root);
    return { code: 0, out: s ? `Đang chạy: http://127.0.0.1:${s.port}/?token=${s.token}` : 'Dashboard không chạy.' };
  }
  if (cmd === 'export') {
    const p = await exportRun(root, argv[1]);
    return p ? { code: 0, out: `Đã xuất: ${p}` } : { code: 1, out: argv[1] ? `Không tìm thấy run ${argv[1]}.` : 'Chưa có run nào để xuất.' };
  }
  if (cmd === 'gate') {
    const num = (flag) => {
      const i = argv.indexOf(flag);
      return i >= 0 && Number.isFinite(Number(argv[i + 1])) ? Number(argv[i + 1]) : undefined;
    };
    const o = { maxNewFailures: num('--max-new-failures'), minHealth: num('--min-health'), maxTokens: num('--max-tokens'), ...(argv.includes('--slo') ? { requireSlo: true } : {}) };
    const g = await runGate(root, Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)));
    const out = [`${g.pass ? '✅ GATE PASS' : '❌ GATE FAIL'}${g.runId ? ` · run ${g.runId}` : ''}`, ...g.checks.map((c) => `${c.pass ? '  ✓' : '  ✗'} ${c.detail}${c.tests?.length ? `: ${c.tests.join('; ')}` : ''}`)];
    return { code: g.pass ? 0 : 1, out: out.join('\n') };
  }
  if (cmd === 'fix') {
    const r = await fixContext(root, argv[1], argv[2]);
    if (!r) return { code: 1, out: argv[1] ? `Không tìm thấy run ${argv[1]}.` : 'Chưa có run nào có test fail.' };
    if (!r.text) return { code: 0, out: `Run ${r.run.meta.runId} không có test fail${argv[2] ? ` nào khớp ${argv[2]}` : ''}.` };
    return { code: 0, out: r.text };
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
    let sentFailed = false;
    if (argv.includes('--send')) {
      const hooks = await webhookConfig();
      const res = hooks.length ? await sendWebhooks(hooks, 'digest', r.markdown) : [];
      sentFailed = res.length > 0 && !res.some((x) => x.ok);
      sent = res.length ? `\nĐã gửi webhook: ${res.map((x) => `${x.host} ${x.ok ? '✓' : `✗ ${x.status ?? x.error}`}`).join(', ')}` : '\nChưa có webhook (thêm "webhooks" vào ~/.e2e-dashboard/config.json).';
    }
    return { code: sentFailed ? 1 : 0, out: `${r.markdown}\nĐã lưu: ${r.file}${sent}` };
  }
  if (cmd === 'report') {
    const kind = argv.includes('month') || argv.includes('monthly') ? 'monthly' : 'weekly';
    if (argv.includes('--send')) {
      const r = await sendReport(root, kind);
      const hooks = r.webhooks.length ? `Webhook: ${r.webhooks.map((x) => `${x.host} ${x.ok ? '✓' : '✗'}`).join(', ')}` : 'Chưa có webhook nhận sự kiện "report".';
      const mail = r.email ? `Email: ${r.email.ok ? '✓ đã gửi' : `✗ ${r.email.error}`}` : '';
      const tried = [...r.webhooks, ...(r.email ? [r.email] : [])];
      return { code: tried.length && !tried.some((x) => x.ok) ? 1 : 0, out: [r.markdown, '', `Đã lưu: ${r.file}`, hooks, mail].filter(Boolean).join('\n') }; // cron/CI must see a dead webhook
    }
    const data = await buildReport(root, { kind: kind === 'monthly' ? 'month' : 'week' });
    const file = await writeText(root, `reports/${kind}-preview.html`, reportHtml(data));
    return { code: 0, out: `${reportMarkdown(data)}\n\nBản HTML: ${file}\nGửi đi: /e2e-dashboard report ${kind === 'monthly' ? 'month ' : ''}--send` };
  }
  if (cmd === 'publish') {
    const r = await publishSite(root, { dir: argv[1] && !argv[1].startsWith('--') ? resolve(cwd, argv[1]) : null });
    return { code: 0, out: `Đã xuất trang báo cáo tĩnh (${r.runs} run): ${r.index}\nĐẩy thư mục ${r.dir} lên GitHub Pages hoặc thư mục chung để cả team xem.` };
  }
  if (cmd === 'mark') {
    const [, kind, ...rest] = argv;
    const flag = (f) => (rest.indexOf(f) >= 0 ? rest.splice(rest.indexOf(f), 2)[1] : undefined);
    const at = flag('--at');
    const url = flag('--url');
    if (!EVENT_KINDS.includes(kind) || !rest.length) return { code: 1, out: `Dùng: /e2e-dashboard mark <${EVENT_KINDS.join('|')}> <mô tả> [--at 2026-10-11T09:00] [--url https://…]` };
    const e = await addEvent(root, { kind, label: rest.join(' '), at, url });
    return { code: 0, out: `Đã đánh dấu ${e.kind} "${e.label}" lúc ${e.at}.` };
  }
  if (cmd === 'ci-sync') {
    const c = ciConfig(readConfig(root));
    if (!c) return { code: 1, out: 'Chưa cấu hình: thêm "ci": { "github": { "workflow": "e2e.yml", "artifact": "e2e-report" } } vào .e2e-dashboard/config.json.' };
    const r = await syncCi(root, c);
    if (r.error) return { code: 1, out: `Lỗi đồng bộ CI: ${r.error}` };
    return { code: 0, out: r.results.length ? r.results.map((x) => `#${x.id} ${x.branch ?? ''} ${x.conclusion ?? ''}: ${x.archived} report${x.reason ? ` (${x.reason})` : ''}`).join('\n') + `\nĐã nhập ${r.imported} run.` : 'Không có run CI mới.' };
  }
  if (cmd === 'triage') {
    const { entries, failing } = await syncTriage(root, await loadHistory(root, 60));
    const b = triageBoard({ entries, failing });
    if (!b.rows.length) return { code: 0, out: 'Không có test nào đang fail. 🎉' };
    const label = { new: '🆕 Mới', investigating: '🔍 Đang xem', known: '📌 Đã biết', fixed: '✅ Đã sửa', ignored: '🙈 Bỏ qua' };
    return { code: 0, out: b.rows.map((r) => `${label[r.status]} ${r.title} [${r.target ?? '?'}]${r.assignee ? ` · ${r.assignee}` : ''}${r.failingNow ? ` · fail ${r.streak} run` : ' · không còn fail'}`).join('\n') };
  }
  return { code: 1, out: 'Dùng: /e2e-dashboard [setup|doctor [--dry-run]|export [runId]|stop|status|digest [ngày]|report [week|month] [--send]|publish [dir]|mark <loại> <mô tả>|triage|ci-sync|projects|statusline [install]|quarantine|import …|share push|pull [dir]|fix [runId] [resultId]|gate]' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // package.json "engines": >=22 — báo rõ thay vì lỗi khó hiểu giữa chừng trên Node cũ
  if (Number(process.versions.node.split('.')[0]) < 22) {
    process.stdout.write(`e2e-dashboard cần Node.js ≥ 22 (đang chạy ${process.version}). Cài Node 22+ (vd. fnm install 22) rồi chạy lại.\n`);
    process.exit(1);
  }
  const r = await main(process.argv.slice(2), process.cwd()).catch((e) => ({ code: 1, out: `Lỗi: ${e.message}` }));
  process.stdout.write(`${r.out}\n`);
  process.exit(r.code);
}
