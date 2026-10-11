// Scorecards by module (folder or configured globs), tag or owner (CODEOWNERS) (M7).
import { testKey, flakyTests } from './analytics.mjs';
import { patternToRegex } from './owners.mjs';

const FAIL = new Set(['failed', 'timed-out', 'interrupted']);
const title = (r) => (Array.isArray(r.titlePath) ? r.titlePath.join(' › ') : String(r.testId ?? r.id));
const fileOf = (r) => String(r.source?.file ?? r.file ?? '').replace(/^\.\//, '');

// "modules": { "Checkout": ["tests/checkout/**"] } in the config, else the test file's folder below the
// folder all tests share (tests/checkout/cart.e2e.ts → checkout).
export function moduleResolver(files, modules = null) {
  const rules = modules && typeof modules === 'object' && !Array.isArray(modules)
    ? Object.entries(modules).flatMap(([name, globs]) => (Array.isArray(globs) ? globs : [globs]).filter((g) => typeof g === 'string' && g.length <= 200).map((g) => ({ name: String(name).slice(0, 80), rx: patternToRegex(g) })))
    : [];
  const dirs = files.map((f) => f.split('/').slice(0, -1));
  let common = dirs[0] ?? [];
  for (const d of dirs) {
    let i = 0;
    while (i < common.length && common[i] === d[i]) i++;
    common = common.slice(0, i);
  }
  return (file) => {
    const f = String(file ?? '');
    for (const r of rules) if (r.rx.test(f)) return r.name;
    const parts = f.split('/');
    const rest = parts.slice(common.length);
    if (rest.length > 1) return rest[0];
    return (rest[0] ?? f).replace(/\.(e2e|spec|test)\.[cm]?[jt]sx?$/, '') || '(khác)';
  };
}

export function grade(passRate, flakyShare) {
  if (passRate == null) return '—';
  const s = passRate - (flakyShare ?? 0) * 0.5;
  return s >= 0.98 ? 'A' : s >= 0.95 ? 'B' : s >= 0.9 ? 'C' : s >= 0.8 ? 'D' : 'F';
}

// history: newest first. by: 'module' | 'tag' | 'owner'.
export function groupReport(history, { by = 'module', modules = null, ownersOf = null, runs = 10 } = {}) {
  const recent = history.filter((h) => h.meta.kind !== 'explore');
  const files = [...new Set(recent.flatMap((h) => (h.report?.run?.results ?? []).map(fileOf)).filter(Boolean))];
  const mod = moduleResolver(files, modules);
  const groupsOf = (r) => {
    if (by === 'tag') return (r.tags ?? []).length ? r.tags.map(String) : ['(không tag)'];
    if (by === 'owner') {
      const o = ownersOf ? ownersOf(fileOf(r)) : [];
      return o.length ? o : ['(chưa có owner)'];
    }
    return [mod(fileOf(r))];
  };
  const flaky = new Map(flakyTests(recent).filter((f) => f.score >= 0.1).map((f) => [f.key, f]));
  const groups = new Map();
  const latest = new Map();
  recent.forEach(({ meta, report }, i) => {
    for (const r of report?.run?.results ?? []) {
      if (!r || r.kind === 'setup' || r.status === 'skipped' || r.selected === false) continue;
      const k = testKey(r);
      const first = !latest.has(k);
      if (first) latest.set(k, r);
      for (const g of groupsOf(r)) {
        if (!groups.has(g)) groups.set(g, { group: g, tests: new Set(), results: 0, ok: 0, durMs: 0, failing: new Map(), byRun: new Map(), owners: new Set() });
        const x = groups.get(g);
        x.tests.add(k);
        x.results++;
        if (!FAIL.has(r.status)) x.ok++;
        x.durMs += (r.attempts ?? []).reduce((s, a) => s + (Number(a.durationMs) || 0), 0);
        if (first && FAIL.has(r.status)) x.failing.set(k, { key: k, title: title(r), target: r.targetId, runId: meta.runId, resultId: r.id });
        if (i < runs) {
          const b = x.byRun.get(meta.runId) ?? { at: meta.startedAt, n: 0, ok: 0 };
          b.n++;
          if (!FAIL.has(r.status)) b.ok++;
          x.byRun.set(meta.runId, b);
        }
        if (ownersOf) for (const o of ownersOf(fileOf(r))) x.owners.add(o);
      }
    }
  });
  const rows = [...groups.values()].map((x) => {
    const fl = [...x.tests].filter((k) => flaky.has(k));
    const passRate = x.results ? x.ok / x.results : null;
    const flakyShare = x.tests.size ? fl.length / x.tests.size : 0;
    return {
      group: x.group, tests: x.tests.size, results: x.results, passRate, flaky: fl.length, flakyShare,
      failingNow: [...x.failing.values()], avgDurationMs: x.results ? Math.round(x.durMs / x.results) : null,
      trend: [...x.byRun.values()].sort((a, b) => String(a.at).localeCompare(String(b.at))).map((b) => b.ok / b.n),
      owners: [...x.owners].slice(0, 6), grade: grade(passRate, flakyShare),
    };
  });
  rows.sort((a, b) => b.failingNow.length - a.failingNow.length || (a.passRate ?? 1) - (b.passRate ?? 1) || a.group.localeCompare(b.group));
  return { by, runs: recent.length, rows };
}
