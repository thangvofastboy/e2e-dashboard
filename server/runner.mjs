// Starts and stops `e2e run` for the dashboard (spec §4.5). One run per project at a time:
// e2e overwrites report.json, so two concurrent runs would clobber each other.
import { spawn as nodeSpawn } from 'node:child_process';

// file or file:line; no flags, no spaces, no `..` (stays inside the project)
const TEST = /^(?!-)(?!.*(^|\/)\.\.(\/|:|$))[\w./@+-]+(:\d+)?$/;
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

export function buildRunArgs({ tests, targets, agents, retries, repeatEach, noCache } = {}) {
  const args = ['e2e', 'run', ...list(tests, TEST, 'tests')];
  const t = list(targets, NAME, 'targets');
  const a = list(agents, NAME, 'agents');
  if (t.length) args.push('--target', t.join(','));
  if (a.length) args.push('--agent', a.join(','));
  const r = int(retries, 0, 10, 'retries');
  const n = int(repeatEach, 1, 50, 'repeatEach');
  if (r !== undefined) args.push('--retries', String(r));
  if (n !== undefined) args.push('--repeat-each', String(n));
  if (noCache !== undefined && typeof noCache !== 'boolean') throw new Error('invalid noCache');
  if (noCache) args.push('--no-cache');
  return args;
}

export function createRunner({ projectRoot, live, spawnImpl = nodeSpawn, onExit = () => {}, graceMs = 10_000 }) {
  let child = null;
  let killTimer = null;
  const now = () => new Date().toISOString();

  function pipe(stream, name) {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) live.apply({ type: 'output', at: now(), stream: name, text: `${line}\n` });
    });
  }

  return {
    start(opts = {}) {
      if (child) return { ok: false, error: 'busy' };
      const args = buildRunArgs(opts); // throws "invalid …" for the caller to turn into 400
      const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      const proc = spawnImpl(cmd, args, { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '0' } });
      child = proc;
      // Without the reporter this is all the Live page gets; with it, the reporter's own run-started replaces it.
      live.apply({ type: 'run-started', at: now(), runId: null });
      pipe(proc.stdout, 'stdout');
      pipe(proc.stderr, 'stderr');
      const done = (exitCode, error) => {
        if (child !== proc) return;
        child = null;
        clearTimeout(killTimer);
        if (error) live.apply({ type: 'run-error', at: now(), error: { message: error.message } });
        live.apply({ type: 'run-finished', at: now(), status: exitCode === 0 ? 'passed' : 'failed', exitCode });
        onExit({ exitCode, rerunOf: opts.rerunOf ?? null });
      };
      proc.on('close', (code) => done(code));
      proc.on('error', (e) => done(null, e)); // e.g. npx missing
      return { ok: true, pid: proc.pid };
    },
    stop() {
      if (!child) return false;
      const proc = child;
      proc.kill('SIGINT'); // e2e finishes gracefully on the first interrupt
      killTimer = setTimeout(() => child === proc && proc.kill('SIGTERM'), graceMs);
      killTimer.unref?.();
      return true;
    },
    state: () => ({ running: Boolean(child), pid: child?.pid ?? null }),
  };
}
