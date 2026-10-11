// Long-term tracking (M7): run folders are pruned by retention, so every archived run is also folded into
// compact rollups that are kept for good:
//   longterm/index.json      per test: first/last seen, current failing streak, past incidents (fail → pass),
//                            renames; per branch: red streaks; the run ids already counted
//   longterm/days-YYYY.json  per local day: suite totals and, per test, [runs, fails, flaky]
// Incidents give MTTR and "time red"; days give trends over months and the calendar.
import { listRuns, getRun } from './store.mjs';
import { readState, writeState, serial } from './jsonstate.mjs';
import { testKey, dayKey } from './analytics.mjs';

export { dayKey };

const FAIL = new Set(['failed', 'timed-out', 'interrupted']);
const RED = new Set(['failed', 'timed-out', 'interrupted', 'error']);
const MAX_INCIDENTS = 30;
const MAX_BRANCHES = 60;
const DAY = 86_400_000;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const title = (r) => (Array.isArray(r.titlePath) ? r.titlePath.join(' › ') : String(r.testId ?? r.id));

export const emptyIndex = () => ({ v: 1, seen: {}, tests: {}, branches: {} });

const resultDuration = (r) => (r.attempts ?? []).reduce((s, a) => s + num(a.durationMs), 0);

// Folds one run into the index and its day; `days` maps YYYY-MM-DD → day totals. Runs should arrive
// oldest first; a run older than what a test already saw only counts towards the totals.
export function applyRun(index, days, { meta, report }) {
  if (!meta?.runId || index.seen[meta.runId] || meta.kind === 'explore') return false;
  const at = meta.startedAt ?? report?.run?.startedAt;
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return false;
  index.seen[meta.runId] = at;
  const dk = dayKey(t);
  const day = (days[dk] ??= { runs: 0, passedRuns: 0, results: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, durationMs: 0, tokens: 0, tests: {} });
  day.runs++;
  if (meta.status === 'passed') day.passedRuns++;
  day.durationMs += num(meta.durationMs);
  day.tokens += num(meta.tokens?.input) + num(meta.tokens?.output);
  const results = (report?.run?.results ?? []).filter((r) => r && r.kind !== 'setup' && r.selected !== false);
  const present = new Set();
  const fresh = [];
  for (const r of results) {
    const k = testKey(r);
    if (r.status === 'skipped') {
      day.skipped++;
      continue;
    }
    present.add(k);
    const fail = FAIL.has(r.status);
    day.results++;
    if (fail) day.failed++;
    else if (r.status === 'flaky') day.flaky++;
    else day.passed++;
    const cell = (day.tests[k] ??= [0, 0, 0]);
    cell[0]++;
    if (fail) cell[1]++;
    if (r.status === 'flaky') cell[2]++;
    let x = index.tests[k];
    if (!x) {
      x = index.tests[k] = { title: title(r), file: r.source?.file ?? r.file ?? null, line: r.source?.line ?? null, target: r.targetId ?? null, agent: r.agent ?? 'default', tags: (r.tags ?? []).slice(0, 20), firstSeen: at, lastSeen: at, runs: 0, fails: 0, flaky: 0, lastStatus: null, lastRunId: null, lastPassAt: null, failingSince: null, failingRuns: 0, failingRunId: null, incidents: [], durMs: 0 };
      fresh.push(k);
    }
    x.runs++;
    if (fail) x.fails++;
    if (r.status === 'flaky') x.flaky++;
    x.durMs += resultDuration(r);
    if (Date.parse(x.lastSeen) > t) {
      if (Date.parse(x.firstSeen) > t) x.firstSeen = at; // an older import: totals only
      continue;
    }
    x.title = title(r);
    x.file = r.source?.file ?? r.file ?? x.file;
    x.line = r.source?.line ?? x.line;
    x.tags = (r.tags ?? []).slice(0, 20);
    x.lastSeen = at;
    x.lastStatus = r.status;
    x.lastRunId = meta.runId;
    if (fail) {
      if (!x.failingSince) {
        x.failingSince = at;
        x.failingRuns = 0;
        x.failingRunId = meta.runId;
      }
      x.failingRuns++;
    } else {
      x.lastPassAt = at;
      if (x.failingSince) {
        x.incidents.push({ start: x.failingSince, end: at, runs: x.failingRuns, startRun: x.failingRunId, endRun: meta.runId });
        if (x.incidents.length > MAX_INCIDENTS) x.incidents.splice(0, x.incidents.length - MAX_INCIDENTS);
        x.failingSince = null;
        x.failingRuns = 0;
        x.failingRunId = null;
      }
    }
  }
  // a test first seen in this run at the file:line of a test this run no longer has → renamed
  // one pass over the index, not one per fresh test: a first sync of a big suite has every test fresh
  const slot = (o) => `${o.file}|${o.line}|${o.target}|${o.agent}`;
  const absent = new Map();
  if (fresh.length)
    for (const [ok, o] of Object.entries(index.tests)) {
      if (present.has(ok) || !o.file || o.line == null) continue;
      if (!absent.has(slot(o))) absent.set(slot(o), []);
      absent.get(slot(o)).push([ok, o]);
    }
  for (const k of fresh) {
    const x = index.tests[k];
    if (!x.file || x.line == null) continue;
    const old = (absent.get(slot(x)) ?? []).find(([, o]) => !o.renamedTo && Date.parse(o.lastSeen) < t);
    if (old) {
      x.renamedFrom = old[0];
      x.renamedFromTitle = old[1].title;
      old[1].renamedTo = k;
    }
  }
  const b = meta.git?.branch;
  if (typeof b === 'string' && b && b !== 'HEAD') {
    const br = (index.branches[b] ??= { redSince: null, redRuns: 0, incidents: [], lastStatus: null, lastSeen: at });
    if (Date.parse(br.lastSeen) <= t) {
      br.lastSeen = at;
      br.lastStatus = meta.status;
      if (RED.has(meta.status)) {
        if (!br.redSince) {
          br.redSince = at;
          br.redRuns = 0;
        }
        br.redRuns++;
      } else if (br.redSince) {
        br.incidents.push({ start: br.redSince, end: at, runs: br.redRuns });
        if (br.incidents.length > MAX_INCIDENTS * 2) br.incidents.splice(0, br.incidents.length - MAX_INCIDENTS * 2);
        br.redSince = null;
        br.redRuns = 0;
      }
    }
    const names = Object.keys(index.branches);
    if (names.length > MAX_BRANCHES) {
      names.sort((x, y) => String(index.branches[x].lastSeen).localeCompare(String(index.branches[y].lastSeen)));
      for (const n of names.slice(0, names.length - MAX_BRANCHES)) if (n !== 'main' && n !== 'master') delete index.branches[n];
    }
  }
  return true;
}

const yearOf = (dk) => dk.slice(0, 4);

async function readYear(root, year) {
  const d = await readState(root, `longterm/days-${year}.json`, {});
  return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
}

export async function readIndex(root) {
  const i = await readState(root, 'longterm/index.json', null);
  return i && i.v === 1 && i.seen && i.tests && i.branches ? i : emptyIndex();
}

// Folds every archived run not counted yet (oldest first). Cheap when nothing is new.
export function syncLongterm(root) {
  return serial(`${root}:longterm`, async () => {
    const index = await readIndex(root);
    const metas = (await listRuns(root)).filter((m) => m.runId && !index.seen[m.runId] && m.kind !== 'explore');
    if (!metas.length) return { index, added: 0 };
    metas.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
    const years = new Map();
    let added = 0;
    for (const m of metas) {
      const run = await getRun(root, m.runId).catch(() => null);
      if (!run) continue;
      const y = yearOf(dayKey(Date.parse(m.startedAt)));
      if (!years.has(y)) years.set(y, await readYear(root, y));
      if (applyRun(index, years.get(y), run)) added++;
    }
    for (const [y, d] of years) await writeState(root, `longterm/days-${y}.json`, d);
    await writeState(root, 'longterm/index.json', index);
    return { index, added };
  });
}

// Day totals between two times (inclusive days), oldest first; days without runs are null.
export async function readDays(root, { from, to = Date.now() }) {
  const out = [];
  const years = new Map();
  const start = new Date(from);
  start.setHours(12, 0, 0, 0);
  for (let t = start.getTime(); t <= to + DAY / 2; t += DAY) {
    const dk = dayKey(t);
    const y = yearOf(dk);
    if (!years.has(y)) years.set(y, await readYear(root, y));
    out.push({ date: dk, ...(years.get(y)[dk] ?? { runs: 0 }) });
  }
  return out.filter((d, i, a) => i === 0 || d.date !== a[i - 1].date);
}

// What the trend charts plot, per day.
export function daySeries(days) {
  return days.map((d) => {
    const executed = num(d.results);
    return {
      date: d.date,
      runs: num(d.runs),
      executed,
      passRate: executed ? (num(d.passed) + num(d.flaky)) / executed : null,
      runPassRate: d.runs ? num(d.passedRuns) / d.runs : null,
      failed: num(d.failed),
      flaky: num(d.flaky),
      tests: d.tests ? Object.keys(d.tests).length : 0,
      avgDurationMs: d.runs ? Math.round(num(d.durationMs) / d.runs) : null,
      tokens: num(d.tokens),
    };
  });
}

export function totals(series) {
  const t = series.reduce((a, d) => ({ runs: a.runs + d.runs, failed: a.failed + d.failed, flaky: a.flaky + d.flaky, tokens: a.tokens + d.tokens }), { runs: 0, failed: 0, flaky: 0, tokens: 0 });
  const rated = series.filter((d) => d.passRate != null);
  // weighted by executed results: one 100-test run outweighs nine 1-test reruns (old series: by runs)
  const weight = (d) => d.executed ?? d.runs;
  const w = rated.reduce((a, d) => a + weight(d), 0);
  return { ...t, passRate: w ? rated.reduce((a, d) => a + d.passRate * weight(d), 0) / w : null, activeDays: rated.length };
}

export function mainBranch(index, cfg = {}) {
  if (typeof cfg.mainBranch === 'string' && index.branches[cfg.mainBranch]) return cfg.mainBranch;
  return ['main', 'master', 'develop'].find((b) => index.branches[b]) ?? Object.keys(index.branches).sort((a, b) => String(index.branches[b].lastSeen).localeCompare(String(index.branches[a].lastSeen)))[0] ?? null;
}

const overlap = (s, e, from, to) => Math.max(0, Math.min(e, to) - Math.max(s, from));
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

// MTTR, open failures and time red, over the last `days` days.
export function reliability(index, { days = 30, now = Date.now(), branch = null } = {}) {
  const from = now - days * DAY;
  const fixed = [];
  const open = [];
  const latest = Math.max(0, ...Object.values(index.seen).map((s) => Date.parse(s)).filter(Number.isFinite));
  for (const [key, x] of Object.entries(index.tests)) {
    for (const i of x.incidents ?? []) {
      const e = Date.parse(i.end);
      if (e >= from && e <= now) fixed.push({ key, title: x.title, file: x.file, target: x.target, start: i.start, end: i.end, runs: i.runs, ms: e - Date.parse(i.start) });
    }
    if (x.failingSince && !x.renamedTo && latest - Date.parse(x.lastSeen) <= 14 * DAY) open.push({ key, title: x.title, file: x.file, target: x.target, since: x.failingSince, runs: x.failingRuns, runId: x.failingRunId, ms: now - Date.parse(x.failingSince) });
  }
  const ms = fixed.map((f) => f.ms);
  const b = branch ?? mainBranch(index);
  const br = b ? index.branches[b] : null;
  let redMs = 0;
  let redIncidents = 0;
  const weekly = [];
  const weeks = Math.max(1, Math.ceil(days / 7));
  for (let w = weeks - 1; w >= 0; w--) weekly.push({ from: now - (w + 1) * 7 * DAY, to: now - w * 7 * DAY, redMs: 0, fixed: 0, mttrMs: null, opened: 0 });
  if (br) {
    const spans = [...(br.incidents ?? []).map((i) => [Date.parse(i.start), Date.parse(i.end)]), ...(br.redSince ? [[Date.parse(br.redSince), now]] : [])];
    for (const [s, e] of spans) {
      const o = overlap(s, e, from, now);
      if (o > 0) {
        redMs += o;
        redIncidents++;
      }
      for (const wk of weekly) wk.redMs += overlap(s, e, wk.from, wk.to);
    }
  }
  for (const wk of weekly) {
    const f = fixed.filter((x) => Date.parse(x.end) >= wk.from && Date.parse(x.end) < wk.to);
    wk.fixed = f.length;
    wk.mttrMs = f.length ? Math.round(f.reduce((a, x) => a + x.ms, 0) / f.length) : null;
    wk.opened = [...fixed.map((x) => x.start), ...open.map((x) => x.since)].filter((s) => Date.parse(s) >= wk.from && Date.parse(s) < wk.to).length;
  }
  return {
    days,
    mttr: { avgMs: ms.length ? Math.round(ms.reduce((a, v) => a + v, 0) / ms.length) : null, medianMs: median(ms), count: ms.length },
    open: open.sort((a, b2) => b2.ms - a.ms),
    fixed: fixed.sort((a, b2) => b2.ms - a.ms),
    branch: b,
    red: br ? { ms: redMs, share: redMs / (days * DAY), incidents: redIncidents, now: Boolean(br.redSince), since: br.redSince, lastStatus: br.lastStatus } : null,
    weekly,
  };
}

// Tests added, removed (not seen for `staleDays` while the suite kept running), renamed.
export function lifecycle(index, { days = 30, now = Date.now(), staleDays = 14 } = {}) {
  const from = now - days * DAY;
  const latest = Math.max(0, ...Object.values(index.seen).map((s) => Date.parse(s)).filter(Number.isFinite));
  const entries = Object.entries(index.tests).map(([key, x]) => ({ key, ...x }));
  const gone = (x) => x.renamedTo || latest - Date.parse(x.lastSeen) > staleDays * DAY;
  const active = entries.filter((x) => !gone(x));
  const row = (x) => ({ key: x.key, title: x.title, file: x.file, line: x.line, target: x.target, firstSeen: x.firstSeen, lastSeen: x.lastSeen, runs: x.runs, fails: x.fails, flaky: x.flaky, lastStatus: x.lastStatus, ageDays: Math.floor((now - Date.parse(x.firstSeen)) / DAY), avgDurationMs: x.runs ? Math.round(x.durMs / x.runs) : null });
  return {
    days,
    staleDays,
    active: active.length,
    total: entries.length,
    added: active.filter((x) => Date.parse(x.firstSeen) >= from && !x.renamedFrom).map(row).sort((a, b) => b.firstSeen.localeCompare(a.firstSeen)),
    renamed: entries.filter((x) => x.renamedFrom && Date.parse(x.firstSeen) >= from).map((x) => ({ ...row(x), from: x.renamedFromTitle })),
    removed: entries.filter((x) => !x.renamedTo && gone(x) && Date.parse(x.lastSeen) >= from - staleDays * DAY).map(row).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)),
    oldest: active.map(row).sort((a, b) => b.ageDays - a.ageDays).slice(0, 10),
    neverFailed: active.filter((x) => x.runs >= 20 && !x.fails && !x.flaky).length,
    alwaysFailing: active.filter((x) => x.runs >= 3 && x.fails === x.runs).map(row),
    tests: active.map(row),
  };
}
