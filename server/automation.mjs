// Runs the dashboard starts by itself: on a daily schedule ("schedule" in the config) and, in watch
// mode, when a test file is saved. Both only while the dashboard server runs, one run at a time.
import { watch as fsWatch } from 'node:fs';
import { relative, sep } from 'node:path';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function scheduleTimes(cfg) {
  const d = cfg?.schedule?.daily;
  return (Array.isArray(d) ? d : typeof d === 'string' ? [d] : []).filter((t) => HHMM.test(t)).slice(0, 24);
}

// The next local time from `times` after `now`.
export function nextRunAt(times, now = Date.now()) {
  let best = null;
  for (const t of times) {
    const [h, m] = t.split(':').map(Number);
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    if (!best || d < best) best = d;
  }
  return best;
}

export function createScheduler({ times, start, now = () => Date.now(), intervalMs = 30_000, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval }) {
  let next = times.length ? nextRunAt(times, now()) : null;
  let last = null;
  const tick = () => {
    if (!next || now() < next.getTime()) return;
    last = { at: new Date(now()).toISOString(), result: start() };
    next = nextRunAt(times, now());
  };
  const timer = times.length ? setIntervalImpl(tick, intervalMs) : null;
  timer?.unref?.();
  return { tick, state: () => ({ times, next: next?.toISOString() ?? null, last }), close: () => timer && clearIntervalImpl(timer) };
}

const TEST_FILE = /\.e2e\.(ts|mts|cts|js|mjs|cjs|tsx|jsx)$/;
const IGNORED = /(^|[\\/])(node_modules|\.git|\.e2e[^\\/]*|dist|build)([\\/]|$)/;

// Saved test files, debounced, as project-relative paths with forward slashes.
export function createTestWatcher({ projectRoot, onChange, debounceMs = 800, watchImpl = fsWatch }) {
  let w = null;
  let timer = null;
  const pending = new Set();
  const enable = () => {
    if (w) return true;
    try {
      w = watchImpl(projectRoot, { recursive: true }, (_e, file) => {
        if (!file) return;
        const f = String(file).split(sep).join('/');
        if (!TEST_FILE.test(f) || IGNORED.test(f)) return;
        pending.add(relative(projectRoot, `${projectRoot}/${f}`).split(sep).join('/'));
        clearTimeout(timer);
        timer = setTimeout(() => {
          const files = [...pending];
          pending.clear();
          onChange(files);
        }, debounceMs);
      });
      w.on?.('error', () => disable());
      return true;
    } catch {
      w = null;
      return false; // recursive watch unsupported here
    }
  };
  const disable = () => {
    clearTimeout(timer);
    w?.close();
    w = null;
  };
  return { enable, disable, enabled: () => Boolean(w) };
}
