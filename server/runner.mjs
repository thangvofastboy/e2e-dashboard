// Starts and stops `e2e run` for the dashboard (spec §4.5). One run per project at a time:
// e2e overwrites report.json, so two concurrent runs would clobber each other.
import { spawn as nodeSpawn } from 'node:child_process';
import { validBrowser } from './browsers.mjs';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

// file or file:line, relative to the project: no flags, no spaces, no `..`, no absolute or drive paths
const TEST = /^(?![-/\\])(?![A-Za-z]:)(?!.*(^|\/)\.\.(\/|:|$))[\w./@+-]+(:\d+)?$/;
const NAME = /^(?!-)[\w.-]+$/;

function list(v, rx, what) {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && rx.test(x))) throw new Error(`invalid ${what}`);
  return v;
}

function int(v, min, max, what) {
  if (v === undefined) return undefined;
  if (!Number.isInteger(v) || v < min || v > max) throw new Error(`invalid ${what}`);
  return v;
}

// --grep-invert patterns (quarantined tests): one regex each, bounded, never mistaken for a flag
const PATTERN = /^(?!-)[^\n\r\0]{1,400}$/;

const TAG = /^(?!-)[\w.@:/+-]{1,100}$/;
const MODES = ['off', 'on', 'retain-on-failure', 'on-first-retry', 'on-all-retries'];
const flag = (v, what) => {
  if (v !== undefined && typeof v !== 'boolean') throw new Error(`invalid ${what}`);
  return v === true;
};

export function buildRunArgs({ tests, targets, agents, retries, repeatEach, noCache, grepInvert, workers, tag, tagMode, excludeTag, grep, shard, maxFailures, strictCache, trace, video, lastFailed, updateSnapshots, aiTrace, headed } = {}) {
  const args = ['e2e', 'run', ...list(tests, TEST, 'tests')];
  const t = list(targets, NAME, 'targets');
  const a = list(agents, NAME, 'agents');
  if (t.length) args.push('--target', t.join(','));
  if (a.length) args.push('--agent', a.join(','));
  const r = int(retries, 0, 10, 'retries');
  const n = int(repeatEach, 1, 50, 'repeatEach');
  if (r !== undefined) args.push('--retries', String(r));
  if (n !== undefined) args.push('--repeat-each', String(n));
  const w = int(workers, 1, 1024, 'workers'); // không truyền = e2e tự chọn (config hoặc nửa số core)
  if (w !== undefined) args.push('--workers', String(w));
  if (noCache !== undefined && typeof noCache !== 'boolean') throw new Error('invalid noCache');
  if (noCache) args.push('--no-cache');
  for (const p of list(grepInvert, PATTERN, 'grepInvert').slice(0, 100)) args.push('--grep-invert', p);
  const tags = list(tag, TAG, 'tag');
  if (tags.length) args.push('--tag', tags.join(','));
  if (tagMode !== undefined) {
    if (tagMode !== 'any' && tagMode !== 'all') throw new Error('invalid tagMode');
    args.push('--tag-mode', tagMode);
  }
  const ex = list(excludeTag, TAG, 'excludeTag');
  if (ex.length) args.push('--exclude-tag', ex.join(','));
  if (grep !== undefined) {
    if (typeof grep !== 'string' || !PATTERN.test(grep)) throw new Error('invalid grep');
    args.push('--grep', grep);
  }
  if (shard !== undefined) {
    const m = /^(\d{1,4})\/(\d{1,4})$/.exec(shard);
    if (!m || +m[1] < 1 || +m[1] > +m[2]) throw new Error('invalid shard');
    args.push('--shard', shard);
  }
  const mf = int(maxFailures, 1, 1000, 'maxFailures');
  if (mf !== undefined) args.push('--max-failures', String(mf));
  if (flag(strictCache, 'strictCache')) args.push('--strict-cache');
  for (const [name, v] of [['trace', trace], ['video', video]]) {
    if (v === undefined) continue;
    if (!MODES.includes(v)) throw new Error(`invalid ${name}`);
    args.push(`--${name}=${v}`);
  }
  if (flag(lastFailed, 'lastFailed')) args.push('--last-failed');
  if (flag(updateSnapshots, 'updateSnapshots')) args.push('--update-snapshots');
  if (flag(aiTrace, 'aiTrace')) args.push('--ai-trace');
  if (flag(headed, 'headed')) args.push('--headed'); // mở trình duyệt có giao diện (cần màn hình)
  return args;
}

// The project's own e2e CLI (node_modules/e2e), run through node: never `npx`, which would fetch
// whatever package is called "e2e" from the registry when the project has none installed.
export function resolveE2eBin(projectRoot) {
  try {
    const dir = join(projectRoot, 'node_modules', 'e2e');
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.e2e;
    if (typeof rel !== 'string') return null;
    const bin = resolve(dir, rel);
    return dirname(bin).startsWith(dir) ? bin : null;
  } catch {
    return null;
  }
}


export function createRunner({ projectRoot, live, spawnImpl = nodeSpawn, onExit = () => {}, graceMs = 10_000, resolveBin = resolveE2eBin, killImpl = (target, sig) => process.kill(target, sig), beforeStart = () => null }) {
  let child = null;
  let timers = [];
  const now = () => new Date().toISOString();

  function pipe(stream, name) {
    stream.setEncoding?.('utf8'); // keep multi-byte characters split across reads intact
    let buf = '';
    const emit = (line) => live.apply({ type: 'output', at: now(), stream: name, text: `${line}\n` });
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      lines.forEach(emit);
    });
    stream.on('end', () => {
      if (buf) emit(buf);
      buf = '';
    });
  }

  const signal = (pid, sig) => {
    try {
      killImpl(pid, sig);
    } catch {
      // already gone
    }
  };

  return {
    start(opts = {}) {
      if (child || live.snapshot().status === 'running') return { ok: false, error: 'busy' }; // also a terminal run
      const args = buildRunArgs(opts); // throws "invalid …" for the caller to turn into 400
      const bin = resolveBin(projectRoot);
      if (!bin) return { ok: false, error: 'e2e-missing' };
      const before = beforeStart();
      const detached = process.platform !== 'win32'; // own process group, so Stop reaches e2e and its browsers
      // trình duyệt: config đọc E2E_BROWSER (web({ browser: process.env.E2E_BROWSER ?? 'chromium' }))
      const env = { ...process.env, FORCE_COLOR: '0', ...(validBrowser(opts.browser) ? { E2E_BROWSER: opts.browser } : {}) };
      const proc = spawnImpl(process.execPath, [bin, ...args.slice(1)], { cwd: projectRoot, detached, stdio: ['ignore', 'pipe', 'pipe'], env });
      child = proc;
      // Without the reporter this is all the Live page gets; with it, the reporter's own run-started replaces it.
      live.apply({ type: 'run-started', at: now(), runId: null });
      pipe(proc.stdout, 'stdout');
      pipe(proc.stderr, 'stderr');
      const done = (exitCode, error) => {
        if (child !== proc) return;
        child = null;
        timers.forEach(clearTimeout);
        timers = [];
        if (error) live.apply({ type: 'run-error', at: now(), error: { message: error.message } });
        // the reporter's own run-finished carries the real verdict (blocked, interrupted…): keep it
        if (live.snapshot().status === 'running') live.apply({ type: 'run-finished', at: now(), status: exitCode === 0 ? 'passed' : 'failed', exitCode });
        onExit({ exitCode, rerunOf: opts.rerunOf ?? null, before, browser: validBrowser(opts.browser) ? opts.browser : null });
      };
      proc.on('close', (code) => done(code));
      proc.on('error', (e) => done(null, e));
      return { ok: true, pid: proc.pid };
    },
    stop() {
      if (!child) {
        // an external run killed without run-finished would keep the dashboard busy forever
        if (live.snapshot().status !== 'running') return false;
        live.apply({ type: 'run-interrupted', at: now() });
        return true;
      }
      const proc = child;
      const target = process.platform === 'win32' ? proc.pid : -proc.pid; // the whole group: npx-free e2e + browsers
      signal(target, 'SIGINT'); // e2e finishes gracefully on the first interrupt
      const later = (ms, sig) => {
        const t = setTimeout(() => child === proc && signal(target, sig), ms);
        t.unref?.();
        timers.push(t);
      };
      later(graceMs, 'SIGTERM');
      later(graceMs * 2, 'SIGKILL');
      return true;
    },
    state: () => ({ running: Boolean(child), pid: child?.pid ?? null }),
  };
}
