// In-memory state of the current run, built from e2e reporter events.
const MAX_OUTPUT = 500;

const empty = () => ({
  runId: null, status: 'idle', runStatus: null, startedAt: null, finishedAt: null, artifactsRoot: null,
  total: 0, done: 0, lanes: 0, tests: [], output: [], error: null,
});

export function createLive({ throttleMs = 250 } = {}) {
  let state = empty();
  let byKey = new Map();
  let busy = []; // lane index -> true while a test runs there
  const subs = new Set();
  let timer = null;

  const keyOf = (testId, target, agent, repeat) => `${testId}|${target}|${agent ?? 'default'}|${repeat ?? 0}`;
  const takeLane = () => {
    let i = busy.indexOf(false);
    if (i === -1) i = busy.push(false) - 1;
    busy[i] = true;
    state.lanes = Math.max(state.lanes, busy.length);
    return i;
  };

  const notify = () => {
    clearTimeout(timer);
    timer = null;
    const snap = structuredClone(state);
    for (const fn of subs) fn(snap);
  };
  const schedule = () => {
    if (!timer) timer = setTimeout(notify, throttleMs);
  };

  function apply(e) {
    if (!e || typeof e !== 'object') return;
    switch (e.type) {
      case 'run-started':
        state = { ...empty(), runId: e.runId ?? null, status: 'running', startedAt: e.at, artifactsRoot: e.artifactsRoot ?? null };
        byKey = new Map();
        busy = [];
        break;
      case 'plan':
        state.total = e.total ?? 0;
        break;
      case 'test-started': {
        const key = keyOf(e.testId, e.target, e.agent, e.repeat);
        const t = {
          key, testId: e.testId, title: e.title, file: e.file, target: e.target, agent: e.agent ?? 'default', repeat: e.repeat ?? 0,
          lane: takeLane(), status: 'running', startedAt: e.at, finishedAt: null, durationMs: null, activity: null, steps: [],
        };
        if (byKey.has(key)) state.tests = state.tests.filter((x) => x.key !== key); // serial member re-run
        byKey.set(key, t);
        state.tests.push(t);
        break;
      }
      case 'step': {
        const t = byKey.get(keyOf(e.testId, e.target, e.agent, e.repeat));
        const p = e.progress;
        if (!t || !p) return;
        const stepId = p.identity?.stepId ?? `${p.api}:${t.steps.length}`;
        let s = t.steps.find((x) => x.stepId === stepId);
        if (p.phase === 'start') {
          t.steps.push({ stepId, kind: p.kind, api: p.api, label: p.label, status: 'running', durationMs: null, error: null });
        } else if (p.phase === 'end' && s) {
          Object.assign(s, { status: p.status, durationMs: p.durationMs ?? null, error: p.error ?? null });
          t.activity = null;
        } else if (p.phase === 'activity') {
          t.activity = p.activity;
        }
        break;
      }
      case 'test-finished': {
        const r = e.result ?? {};
        const t = byKey.get(keyOf(r.testId, r.targetId, r.agent, r.repeat));
        state.done += 1;
        if (!t) break;
        Object.assign(t, {
          status: r.status, finishedAt: e.at, activity: null,
          // serial members finish with no attempts of their own: fall back to wall-clock time
          durationMs: (r.attempts ?? []).reduce((sum, a) => sum + (a.durationMs ?? 0), 0) || Math.max(0, Date.parse(e.at) - Date.parse(t.startedAt)) || 0,
        });
        busy[t.lane] = false;
        break;
      }
      case 'output':
        state.output.push({ pair: e.pair ?? null, stream: e.stream, text: e.text });
        if (state.output.length > MAX_OUTPUT) state.output.splice(0, state.output.length - MAX_OUTPUT);
        break;
      case 'run-error':
        state.error = e.error ?? null;
        break;
      case 'run-interrupted':
        state.status = 'interrupted';
        break;
      case 'run-finished':
        state.status = state.status === 'interrupted' ? 'interrupted' : 'finished';
        state.runStatus = e.status ?? null; // report-level verdict: passed | failed | blocked | error | interrupted
        state.finishedAt = e.at;
        break;
      default:
        return; // new event types are added over time; ignore them
    }
    if (e.type === 'run-finished') notify();
    else schedule();
  }

  return {
    apply,
    snapshot: () => structuredClone(state),
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    flush: notify,
  };
}

export function estimateEta(snapshot, avgByKey) {
  if (snapshot.status !== 'running' || !avgByKey.size) return null;
  const remaining = Math.max(0, snapshot.total - snapshot.done);
  const values = [...avgByKey.values()];
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.round((remaining * avg) / Math.max(1, snapshot.lanes));
}
