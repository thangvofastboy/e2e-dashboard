// Triage (M7): every failing test gets a state — new → investigating → known (Linear link) → fixed /
// ignored — with an assignee and a note. Entries are keyed by the Linear fingerprint (test + error
// signature), so the same failure in the next run carries its state; a "fixed" one failing again is
// reopened, and an open one whose test passes again is marked fixed.
import { readState, writeState, serial, clip } from './jsonstate.mjs';
import { resultError, testKey } from './analytics.mjs';
import { fingerprint } from './linear.mjs';

export const TRIAGE_STATUSES = ['new', 'investigating', 'known', 'fixed', 'ignored'];
const OPEN = new Set(['new', 'investigating', 'known']);
const FAIL = new Set(['failed', 'timed-out', 'interrupted']);
const FP = /^e2ed-[0-9a-f]{12}$/;
const FILE = 'triage.json';
const title = (r) => (Array.isArray(r.titlePath) ? r.titlePath.join(' › ') : String(r.testId ?? r.id));

export async function readTriage(root) {
  const m = await readState(root, FILE, {});
  return m && typeof m === 'object' && !Array.isArray(m) ? Object.fromEntries(Object.entries(m).filter(([k, v]) => FP.test(k) && v && TRIAGE_STATUSES.includes(v.status))) : {};
}

// Tests whose latest result (newest first history) fails, with their failing streak.
export function currentFailures(history) {
  const latest = new Map();
  const streak = new Map();
  for (const { meta, report } of history) {
    if (meta.kind === 'explore') continue;
    for (const r of report?.run?.results ?? []) {
      if (!r || r.kind === 'setup' || r.status === 'skipped' || r.selected === false) continue;
      const k = testKey(r);
      if (!latest.has(k)) {
        latest.set(k, { meta, report, r });
        streak.set(k, { runs: FAIL.has(r.status) ? 1 : 0, since: meta.startedAt, open: FAIL.has(r.status) });
      } else {
        const s = streak.get(k);
        if (s.open && FAIL.has(r.status)) {
          s.runs++;
          s.since = meta.startedAt;
        } else s.open = false;
      }
    }
  }
  const out = [];
  for (const [k, { meta, report, r }] of latest) {
    if (!FAIL.has(r.status)) continue;
    const err = resultError(report, r);
    out.push({
      fp: fingerprint(r, err), key: k, title: title(r), file: r.source?.file ?? r.file ?? null, line: r.source?.line ?? null, target: r.targetId, agent: r.agent ?? 'default',
      runId: meta.runId, resultId: r.id, at: meta.startedAt, since: streak.get(k).since, streak: streak.get(k).runs,
      error: err ? { code: err.code ?? 'ERROR', message: String(err.message ?? '').split('\n')[0].slice(0, 300) } : null,
    });
  }
  return out;
}

// The latest status per test key, to see whether a triaged failure is gone.
function latestByKey(history) {
  const m = new Map();
  for (const { meta, report } of history) for (const r of report?.run?.results ?? []) {
    if (!r || r.kind === 'setup' || r.status === 'skipped' || r.selected === false) continue;
    if (!m.has(testKey(r))) m.set(testKey(r), { status: r.status, at: meta.startedAt });
  }
  return m;
}

// Applies the automatic transitions; returns the entries that changed.
export function autoTransitions(entries, failing, history, now = new Date().toISOString()) {
  const changed = {};
  const byFp = new Map(failing.map((f) => [f.fp, f]));
  for (const f of failing) {
    const e = entries[f.fp];
    if (e?.status === 'fixed' && Date.parse(f.at) > Date.parse(e.updatedAt)) {
      changed[f.fp] = { ...e, status: 'new', reopened: (e.reopened ?? 0) + 1, updatedAt: now, history: [...(e.history ?? []), { at: now, status: 'new', auto: 'reopened' }].slice(-20) };
    }
  }
  const latest = latestByKey(history);
  for (const [fp, e] of Object.entries(entries)) {
    if (!OPEN.has(e.status) || byFp.has(fp)) continue;
    const l = latest.get(e.key);
    if (l && !FAIL.has(l.status) && Date.parse(l.at) > Date.parse(e.updatedAt)) {
      changed[fp] = { ...e, status: 'fixed', updatedAt: now, history: [...(e.history ?? []), { at: now, status: 'fixed', auto: 'passed' }].slice(-20) };
    } else if (!l && history.filter((h) => Date.parse(h.meta.startedAt) > Date.parse(e.updatedAt)).length >= 10) {
      // test deleted or renamed: absent from 10+ runs since, it would otherwise stay open forever
      changed[fp] = { ...e, status: 'fixed', updatedAt: now, history: [...(e.history ?? []), { at: now, status: 'fixed', auto: 'gone' }].slice(-20) };
    }
  }
  return changed;
}

export function syncTriage(root, history) {
  return serial(`${root}:triage`, async () => {
    const entries = await readTriage(root);
    const failing = currentFailures(history);
    const changed = autoTransitions(entries, failing, history);
    if (Object.keys(changed).length) await writeState(root, FILE, { ...entries, ...changed });
    return { entries: { ...entries, ...changed }, failing };
  });
}

// What the Triage page lists: current failures with their state, plus open entries not failing now.
export function triageBoard({ entries, failing, links = {}, ownersOf = null }) {
  const rows = failing.map((f) => {
    const e = entries[f.fp];
    return { ...f, status: e?.status ?? 'new', triaged: Boolean(e), assignee: e?.assignee ?? null, note: e?.note ?? '', updatedAt: e?.updatedAt ?? null, reopened: e?.reopened ?? 0, issue: links[f.fp] ?? null, owners: ownersOf ? ownersOf(f.file) : [], failingNow: true };
  });
  const seen = new Set(failing.map((f) => f.fp));
  for (const [fp, e] of Object.entries(entries)) {
    if (seen.has(fp) || !OPEN.has(e.status)) continue;
    rows.push({ fp, key: e.key, title: e.title, file: e.file ?? null, target: e.target ?? null, status: e.status, triaged: true, assignee: e.assignee ?? null, note: e.note ?? '', updatedAt: e.updatedAt, reopened: e.reopened ?? 0, issue: links[fp] ?? null, owners: ownersOf ? ownersOf(e.file) : [], failingNow: false, error: e.error ?? null, runId: e.runId ?? null, resultId: e.resultId ?? null });
  }
  const order = { new: 0, investigating: 1, known: 2, fixed: 3, ignored: 4 };
  rows.sort((a, b) => order[a.status] - order[b.status] || Number(b.failingNow) - Number(a.failingNow) || String(a.since ?? '').localeCompare(String(b.since ?? '')));
  const counts = Object.fromEntries(TRIAGE_STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]));
  return { rows, counts, untriaged: rows.filter((r) => !r.triaged).length };
}

export async function updateTriage(root, fp, patch, row = {}) {
  if (!FP.test(String(fp))) throw new Error('fingerprint không hợp lệ');
  if (patch.status !== undefined && !TRIAGE_STATUSES.includes(patch.status)) throw new Error('trạng thái không hợp lệ');
  return serial(`${root}:triage`, async () => {
    const entries = await readTriage(root);
    const now = new Date().toISOString();
    const prev = entries[fp] ?? { fp, key: clip(row.key, 700), title: clip(row.title, 300), file: clip(row.file, 300) || null, target: clip(row.target, 80) || null, status: 'new', createdAt: now, history: [] };
    const next = { ...prev, updatedAt: now };
    if (patch.status !== undefined) next.status = patch.status;
    if (patch.assignee !== undefined) next.assignee = clip(patch.assignee, 80).trim() || null;
    if (patch.note !== undefined) next.note = clip(patch.note, 2000);
    // what the row looked like, so an open entry still shows once the test stops failing
    if (row.error) next.error = { code: clip(row.error.code, 80), message: clip(row.error.message, 300) };
    if (row.runId) next.runId = clip(row.runId, 80);
    if (row.resultId) next.resultId = clip(row.resultId, 80);
    next.history = [...(prev.history ?? []), { at: now, status: next.status, assignee: next.assignee ?? null }].slice(-20);
    entries[fp] = next;
    await writeState(root, FILE, entries);
    return next;
  });
}
