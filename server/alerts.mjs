// Alert rules (M7), checked after every archived run. "alerts" in the project config:
//   { "type": "consecutive-failures", "count": 3 }               a test failed N runs in a row
//   { "type": "pass-rate-below", "value": 0.9, "runs": 10, "scope": "module:checkout" | "tag:@smoke" | "owner:@team" }
//   { "type": "flaky-increase", "factor": 2, "days": 7, "min": 2 } flaky results this week vs the week before
//   { "type": "red-for", "hours": 24, "branch": "main" }           the branch has been red that long
// Without "alerts", the first and the last (24 h on the main branch) apply; "alerts": [] turns them off.
// An alert fires once when its condition starts and again only after it cleared.
import { readState, writeState, serial } from './jsonstate.mjs';
import { testKey } from './analytics.mjs';
import { mainBranch } from './longterm.mjs';

const FAIL = new Set(['failed', 'timed-out', 'interrupted']);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FILE = 'alerts.json';
const title = (r) => (Array.isArray(r.titlePath) ? r.titlePath.join(' › ') : String(r.testId ?? r.id));
const fileOf = (r) => String(r.source?.file ?? r.file ?? '');

export const DEFAULT_ALERTS = [{ type: 'consecutive-failures', count: 3 }, { type: 'red-for', hours: 24 }];

export function alertRules(cfg) {
  const list = Array.isArray(cfg?.alerts) ? cfg.alerts : cfg?.alerts === undefined ? DEFAULT_ALERTS : [];
  const n = (v, d, lo, hi) => (Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : d);
  return list.slice(0, 50).map((r) => {
    if (!r || typeof r !== 'object') return null;
    if (r.type === 'consecutive-failures') return { type: r.type, count: Math.round(n(r.count, 3, 2, 50)) };
    if (r.type === 'pass-rate-below') return { type: r.type, value: n(r.value, 0.9, 0, 1), runs: Math.round(n(r.runs, 10, 1, 200)), scope: typeof r.scope === 'string' && /^(module|tag|owner):.{1,120}$/.test(r.scope) ? r.scope : null };
    if (r.type === 'flaky-increase') return { type: r.type, factor: n(r.factor, 2, 1.1, 100), days: Math.round(n(r.days, 7, 1, 90)), min: Math.round(n(r.min, 2, 1, 1000)) };
    if (r.type === 'red-for') return { type: r.type, hours: n(r.hours, 24, 0.5, 24 * 90), branch: typeof r.branch === 'string' && /^[\w./-]{1,200}$/.test(r.branch) ? r.branch : null };
    return null;
  }).filter(Boolean);
}

export function describeRule(r) {
  if (r.type === 'consecutive-failures') return `Test fail ${r.count} run liên tiếp`;
  if (r.type === 'pass-rate-below') return `Pass rate${r.scope ? ` của ${r.scope}` : ''} dưới ${Math.round(r.value * 100)}% (${r.runs} run gần nhất)`;
  if (r.type === 'flaky-increase') return `Số kết quả flaky ${r.days} ngày qua gấp ≥ ${r.factor} lần ${r.days} ngày trước đó`;
  return `Branch ${r.branch ?? 'chính'} đỏ quá ${r.hours} giờ`;
}

// history: newest first; index: long-term index (red-for); helpers: ownersOf(file), moduleOf(file).
export function evaluateAlerts(rules, { history, index = null, now = Date.now(), ownersOf = null, moduleOf = null, cfg = {} }) {
  const runs = history.filter((h) => h.meta.kind !== 'explore');
  const out = [];
  for (const rule of rules) {
    if (rule.type === 'consecutive-failures') {
      const streak = new Map();
      const done = new Set();
      for (const { meta, report } of runs) for (const r of report?.run?.results ?? []) {
        if (!r || r.kind === 'setup' || r.status === 'skipped' || r.selected === false) continue;
        const k = testKey(r);
        if (done.has(k)) continue;
        if (FAIL.has(r.status)) {
          const s = streak.get(k) ?? { n: 0, title: title(r), file: fileOf(r), target: r.targetId, runId: meta.runId, resultId: r.id };
          s.n++;
          streak.set(k, s);
        } else done.add(k);
      }
      for (const [k, s] of streak) if (s.n >= rule.count) out.push({ id: `cf:${rule.count}:${k}`, rule, title: `${s.title} [${s.target}] fail ${s.n} run liên tiếp`, tests: [k], files: [s.file], runId: s.runId, resultId: s.resultId });
    } else if (rule.type === 'pass-rate-below') {
      const [kind, value] = rule.scope ? [rule.scope.slice(0, rule.scope.indexOf(':')), rule.scope.slice(rule.scope.indexOf(':') + 1)] : [null, null];
      const inScope = (r) => !kind || (kind === 'tag' ? (r.tags ?? []).map(String).includes(value) : kind === 'owner' ? (ownersOf?.(fileOf(r)) ?? []).includes(value) : moduleOf?.(fileOf(r)) === value);
      let n = 0;
      let ok = 0;
      const files = new Set();
      for (const { report } of runs.slice(0, rule.runs)) for (const r of report?.run?.results ?? []) {
        if (!r || r.kind === 'setup' || r.status === 'skipped' || r.selected === false || !inScope(r)) continue;
        n++;
        if (!FAIL.has(r.status)) ok++;
        else files.add(fileOf(r));
      }
      if (n && ok / n < rule.value) out.push({ id: `pr:${rule.scope ?? 'suite'}:${rule.value}`, rule, title: `Pass rate${rule.scope ? ` ${rule.scope}` : ''} ${Math.round((ok / n) * 100)}% < ${Math.round(rule.value * 100)}% (${Math.min(rule.runs, runs.length)} run)`, tests: [], files: [...files] });
    } else if (rule.type === 'flaky-increase') {
      const count = (from, to) => runs.filter((h) => Date.parse(h.meta.startedAt) >= from && Date.parse(h.meta.startedAt) < to).reduce((a, h) => a + (Number(h.meta.summary?.flaky) || 0), 0);
      const cur = count(now - rule.days * DAY, now + 1);
      const prev = count(now - 2 * rule.days * DAY, now - rule.days * DAY);
      if (cur >= rule.min && cur >= rule.factor * Math.max(1, prev)) out.push({ id: `fi:${rule.days}`, rule, title: `Flaky tăng: ${cur} kết quả flaky trong ${rule.days} ngày (trước đó ${prev})`, tests: [], files: [] });
    } else if (rule.type === 'red-for' && index) {
      const b = rule.branch ?? mainBranch(index, cfg);
      const br = b && index.branches[b];
      if (br?.redSince && now - Date.parse(br.redSince) >= rule.hours * HOUR) out.push({ id: `rf:${b}:${br.redSince}`, rule, title: `Branch ${b} đỏ ${Math.round((now - Date.parse(br.redSince)) / HOUR)} giờ (từ ${br.redSince.slice(0, 16).replace('T', ' ')})`, tests: [], files: [] });
    }
  }
  return out.map((a) => ({ ...a, owners: ownersOf ? [...new Set(a.files.flatMap((f) => ownersOf(f)))] : [], description: describeRule(a.rule) }));
}

export async function readAlerts(root) {
  const s = await readState(root, FILE, null);
  return s && typeof s.active === 'object' && Array.isArray(s.log) ? s : { active: {}, log: [] };
}

// Records the current alerts; returns the ones that just started.
export function recordAlerts(root, found, now = new Date().toISOString()) {
  return serial(`${root}:alerts`, async () => {
    const state = await readAlerts(root);
    const fresh = found.filter((a) => !state.active[a.id]);
    const active = Object.fromEntries(found.map((a) => [a.id, state.active[a.id] ?? { at: now, title: a.title }]));
    const cleared = Object.keys(state.active).filter((id) => !active[id]);
    const log = [...state.log, ...fresh.map((a) => ({ id: a.id, at: now, title: a.title, kind: 'fired', owners: a.owners })), ...cleared.map((id) => ({ id, at: now, title: state.active[id].title, kind: 'cleared' }))].slice(-200);
    if (fresh.length || cleared.length) await writeState(root, FILE, { active, log });
    return { fresh, cleared, active };
  });
}
