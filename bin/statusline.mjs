#!/usr/bin/env node
// Claude Code status line for e2e projects (M3). Self-contained (node:* only): `statusline install`
// copies it to ~/.e2e-dashboard/, a path that survives plugin updates. Reads files only, never the
// network, and prints nothing outside an e2e project. Usage in settings.json:
//   "statusLine": { "type": "command", "command": "node ~/.e2e-dashboard/statusline.mjs" }
// To keep an existing status line, pipe the same stdin to both and join the outputs.
import { readFileSync, existsSync, lstatSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { listRunDirsSync } from '../reporter/e2e-dashboard.reporter.mjs';

const CONFIGS = ['e2e.config.ts', 'e2e.config.mts', 'e2e.config.js', 'e2e.config.mjs'];
const DATA = '.e2e-dashboard';

function projectRoot(start) {
  let d = resolve(start);
  for (let i = 0; i < 40; i++) {
    if (CONFIGS.some((n) => existsSync(join(d, n)))) return d;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
  return null;
}

const readJson = (p) => {
  try {
    if (lstatSync(p).isSymbolicLink()) return null;
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

const ago = (iso, now) => {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)}p trước`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h trước`;
  return `${Math.floor(s / 86_400)}d trước`;
};

const n = (v) => Number(v) || 0;
const rate = (m) => {
  const s = m?.summary ?? {};
  const ok = n(s.passed) + n(s.flaky);
  const done = ok + n(s.failed) + n(s.interrupted);
  return done ? ok / done : null;
};

export function statusText(cwd, { now = Date.now(), color = true } = {}) {
  const root = projectRoot(cwd);
  if (!root) return '';
  const paint = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const data = join(root, DATA);
  const live = readJson(join(data, 'runtime', 'live.json')) ?? readJson(join(data, 'live.json'));
  const server = readJson(join(data, 'server.json'));
  if (live?.status === 'running' && Number.isInteger(server?.pid) && alive(server.pid)) {
    return `🧪 ${paint('36', `▶ e2e ${n(live.done)}/${n(live.total) || '?'}`)}`;
  }
  let names = [];
  try {
    names = listRunDirsSync(join(data, 'runs')).slice(0, 10); // runs/YYYY/MM/DD/… và bố cục cũ
  } catch {
    return '🧪 e2e: chưa có run';
  }
  const metas = names.map((x) => readJson(join(data, 'runs', x, 'meta.json'))).filter(Boolean);
  const m = metas[0];
  if (!m) return '🧪 e2e: chưa có run';
  const s = m.summary ?? {};
  const failed = n(s.failed) + n(s.interrupted);
  const ok = n(s.passed) + n(s.flaky);
  const head = m.status === 'passed' ? paint('32', `✓ ${ok}/${ok + failed}`) : paint('31', `✗ ${failed ? `${failed} fail` : m.status}`);
  const rates = metas.map(rate).filter((v) => v != null);
  const avg = rates.length ? `${Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100)}% (${rates.length} run)` : '';
  return [`🧪 e2e ${head}`, n(s.flaky) ? paint('33', `${n(s.flaky)} flaky`) : '', avg, ago(m.startedAt, now)].filter(Boolean).join(' · ');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = '';
  let printed = false;
  const done = () => {
    if (printed) return;
    printed = true;
    let cwd = process.cwd();
    try {
      const j = JSON.parse(input || '{}');
      cwd = j.workspace?.current_dir ?? j.cwd ?? cwd;
    } catch {
      // not JSON: use the process cwd
    }
    let text = '';
    try {
      text = statusText(cwd, { color: !process.env.NO_COLOR });
    } catch {
      // a status line must never fail loudly
    }
    process.stdout.write(text, () => process.exit(0));
  };
  setTimeout(done, 300); // never wait for stdin longer than this
  process.stdin.on('data', (c) => (input += c));
  process.stdin.on('end', done);
}
