// M2 analyses over archived runs. Pure functions: input is `history`, an array of {meta, report},
// newest first (store.loadHistory). Nothing here touches the file system or the network.
import { createHash } from 'node:crypto';
import { resultAttempts } from '../reporter/e2e-dashboard.reporter.mjs';
import { passRate } from '../ui/health.js';

const FAIL = new Set(['failed', 'timed-out', 'interrupted']);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0); // counts come from report.json
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const title = (r) => (Array.isArray(r.titlePath) ? r.titlePath.join(' › ') : String(r.testId ?? r.id));
const results = (report) => (report?.run?.results ?? []).filter((r) => r && r.kind !== 'setup');

export const testKey = (r) => `${r.testId}|${r.targetId}|${r.agent ?? 'default'}`;
const resultKey = (r) => `${testKey(r)}|${r.repeat ?? 0}`;
const duration = (report, r) => resultAttempts(report, r).reduce((s, a) => s + num(a.durationMs), 0);

function steps(report, r) {
  return resultAttempts(report, r).flatMap((a) => a.steps ?? []);
}

function resultTokens(report, r) {
  const t = { input: 0, output: 0, modelCalls: 0 };
  for (const s of steps(report, r)) {
    t.modelCalls += num(s.metrics?.modelCalls);
    for (const e of s.events ?? []) if (e.kind === 'model') {
      t.input += num(e.inputTokens);
      t.output += num(e.outputTokens);
    }
  }
  return t;
}

const row = (r) => ({ key: testKey(r), testId: r.testId, title: title(r), file: r.source?.file ?? r.file, line: r.source?.line ?? null, target: r.targetId, agent: r.agent ?? 'default' });

// ---------------------------------------------------------------- flaky

// A test is flaky when it passes only on retry (status "flaky") or flips between pass and fail across
// runs with no change to it. Score: share of its runs that were flaky, plus share of run-to-run flips.
export function flakyTests(history, { minRuns = 2 } = {}) {
  const byKey = new Map();
  for (const { meta, report } of [...history].reverse()) {
    for (const r of results(report)) {
      if (r.status === 'skipped' || r.selected === false) continue;
      const k = testKey(r);
      if (!byKey.has(k)) byKey.set(k, { ...row(r), history: [] });
      byKey.get(k).history.push({ runId: meta.runId, status: r.status, resultId: r.id, startedAt: meta.startedAt, commit: meta.git?.commit ?? null });
    }
  }
  const out = [];
  for (const t of byKey.values()) {
    const h = t.history;
    if (h.length < minRuns) continue;
    const flaky = h.filter((x) => x.status === 'flaky').length;
    const fails = h.filter((x) => FAIL.has(x.status)).length;
    let flips = 0;
    let sameCommitFlips = 0;
    for (let i = 1; i < h.length; i++) {
      if (FAIL.has(h[i].status) === FAIL.has(h[i - 1].status)) continue;
      flips++;
      if (h[i].commit && h[i].commit === h[i - 1].commit) sameCommitFlips++; // same code, other verdict
    }
    const score = Math.min(1, flaky / h.length + flips / Math.max(1, h.length - 1) / 2 + sameCommitFlips / Math.max(1, h.length - 1) / 2);
    // one pass→fail (or back) after a code change is a regression or a fix, not flakiness
    if (!flaky && !sameCommitFlips && flips < 2) continue;
    const lastFlaky = [...h].reverse().find((x) => x.status === 'flaky' || FAIL.has(x.status));
    out.push({ ...t, runs: h.length, flaky, fails, flips, sameCommitFlips, failRate: fails / h.length, score: Math.round(score * 1000) / 1000, last: lastFlaky ?? null, history: h.slice().reverse() });
  }
  return out.sort((a, b) => b.score - a.score || b.flaky - a.flaky);
}

// ---------------------------------------------------------------- compare two runs

export function compareRuns(base, head) {
  const before = new Map(results(base.report).map((r) => [resultKey(r), r]));
  const after = new Map(results(head.report).map((r) => [resultKey(r), r]));
  const rows = [];
  for (const k of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(k);
    const b = after.get(k);
    const r = b ?? a;
    const sa = a?.status ?? null;
    const sb = b?.status ?? null;
    let change;
    if (!a) change = 'added';
    else if (!b) change = 'removed';
    else if (sa === 'skipped' || sb === 'skipped') change = sa === sb ? 'unchanged' : 'skipped';
    else if (!FAIL.has(sa) && FAIL.has(sb)) change = 'regressed';
    else if (FAIL.has(sa) && !FAIL.has(sb)) change = 'fixed';
    else if (FAIL.has(sa) && FAIL.has(sb)) change = 'still-failing';
    else if (sb === 'flaky' && sa !== 'flaky') change = 'became-flaky';
    else change = 'unchanged';
    const da = a ? duration(base.report, a) : null;
    const db = b ? duration(head.report, b) : null;
    const ta = a ? resultTokens(base.report, a) : null;
    const tb = b ? resultTokens(head.report, b) : null;
    const err = (rep, x) => {
      const e = x && resultAttempts(rep, x).at(-1)?.error;
      return e ? { code: e.code ?? null, message: String(e.message ?? '').slice(0, 300) } : null;
    };
    rows.push({
      ...row(r), repeat: r.repeat ?? 0, change,
      a: a ? { resultId: a.id, status: sa, durationMs: da, tokens: ta.input + ta.output, error: err(base.report, a) } : null,
      b: b ? { resultId: b.id, status: sb, durationMs: db, tokens: tb.input + tb.output, error: err(head.report, b) } : null,
      durationDelta: da != null && db != null ? db - da : null,
    });
  }
  const order = ['regressed', 'still-failing', 'became-flaky', 'fixed', 'added', 'removed', 'skipped', 'unchanged'];
  rows.sort((x, y) => order.indexOf(x.change) - order.indexOf(y.change) || Math.abs(y.durationDelta ?? 0) - Math.abs(x.durationDelta ?? 0));
  const counts = Object.fromEntries(order.map((c) => [c, rows.filter((x) => x.change === c).length]));
  const tok = (m) => num(m.tokens?.input) + num(m.tokens?.output);
  return {
    base: base.meta,
    head: head.meta,
    counts,
    deltas: {
      passRate: passRate(head.meta) != null && passRate(base.meta) != null ? passRate(head.meta) - passRate(base.meta) : null,
      durationMs: head.meta.durationMs != null && base.meta.durationMs != null ? head.meta.durationMs - base.meta.durationMs : null,
      tokens: tok(head.meta) - tok(base.meta),
      costUsd: head.meta.costUsd != null && base.meta.costUsd != null ? head.meta.costUsd - base.meta.costUsd : null,
    },
    rows,
  };
}

// ---------------------------------------------------------------- error groups

// Same failure, different run: numbers, quoted text, ids and URLs vary; the shape of the message does not.
export function normalizeMessage(s) {
  return String(s ?? '')
    .slice(0, 500)
    .replace(/https?:\/\/[^\s"')]+/gi, '<url>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b[0-9a-f]{12,}\b/gi, '<hex>')
    .replace(/"[^"]*"|'[^']*'|“[^”]*”/g, '"…"')
    .replace(/\d+(\.\d+)?/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();
}

export function errorSignature(err) {
  if (!err) return null;
  const parts = [err.code ?? 'ERROR', normalizeMessage(err.message), normalizeMessage(err.details?.locator ?? '')];
  return { id: createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 12), code: err.code ?? 'ERROR', pattern: parts[1], locator: err.details?.locator ?? null };
}

// The error that decided a result: the last attempt's, else its first failing step's.
export function resultError(report, r) {
  const a = resultAttempts(report, r).at(-1);
  return a?.error ?? (a?.steps ?? []).find((s) => s.error)?.error ?? null;
}

export function groupErrors(history) {
  const groups = new Map();
  for (const { meta, report } of history) {
    for (const r of results(report)) {
      if (!FAIL.has(r.status) && r.status !== 'flaky') continue;
      const err = resultError(report, r);
      const sig = errorSignature(err);
      if (!sig) continue;
      if (!groups.has(sig.id)) groups.set(sig.id, { ...sig, message: String(err.message ?? '').slice(0, 500), category: err.category ?? null, count: 0, tests: new Map(), runs: new Set(), firstSeen: meta.startedAt, lastSeen: meta.startedAt, latest: null });
      const g = groups.get(sig.id);
      g.count++;
      g.runs.add(meta.runId);
      if (!g.tests.has(testKey(r))) g.tests.set(testKey(r), { key: testKey(r), title: title(r), target: r.targetId, runId: meta.runId, resultId: r.id });
      if (meta.startedAt < g.firstSeen) g.firstSeen = meta.startedAt;
      if (meta.startedAt >= g.lastSeen || !g.latest) {
        g.lastSeen = meta.startedAt;
        g.latest = { runId: meta.runId, resultId: r.id };
      }
    }
  }
  return [...groups.values()]
    .map((g) => ({ ...g, tests: [...g.tests.values()], runs: g.runs.size }))
    .sort((a, b) => b.tests.length - a.tests.length || b.count - a.count || String(b.lastSeen).localeCompare(String(a.lastSeen)));
}

// ---------------------------------------------------------------- cost & cache

const CACHE_MODES = { 'self-finalized': 'replayed', 'agent-concluded': 'handedOff', missed: 'missed' };

export function estimateCost(tokens, pricing) {
  const inP = Number(pricing?.inputPerMTok);
  const outP = Number(pricing?.outputPerMTok);
  if (!(inP >= 0) || !(outP >= 0) || !pricing) return null;
  return (num(tokens.input) * inP + num(tokens.output) * outP) / 1e6;
}

export function costStats(history, { pricing = null, budget = null } = {}) {
  const runs = [];
  const tests = new Map();
  const reasons = new Map();
  const roles = new Map();
  const cache = { replayed: 0, handedOff: 0, missed: 0, off: 0 };
  for (const { meta, report } of history) {
    const tokens = { input: num(meta.tokens?.input), output: num(meta.tokens?.output) };
    const costUsd = meta.costUsd != null && Number.isFinite(Number(meta.costUsd)) ? Number(meta.costUsd) : estimateCost(tokens, pricing);
    runs.push({ runId: meta.runId, startedAt: meta.startedAt, branch: meta.git?.branch ?? null, tokens, total: tokens.input + tokens.output, modelCalls: num(meta.modelCalls), costUsd, estimated: meta.costUsd == null && costUsd != null, replay: meta.replay?.total ? num(meta.replay.replayed) / num(meta.replay.total) : null });
    for (const r of results(report)) {
      const t = resultTokens(report, r);
      if (!tests.has(testKey(r))) tests.set(testKey(r), { ...row(r), tokens: 0, modelCalls: 0, runs: 0 });
      const x = tests.get(testKey(r));
      x.tokens += t.input + t.output;
      x.modelCalls += t.modelCalls;
      x.runs++;
      for (const s of steps(report, r)) {
        for (const e of s.events ?? []) if (e.kind === 'model') roles.set(e.name ?? 'model', (roles.get(e.name ?? 'model') ?? 0) + num(e.inputTokens) + num(e.outputTokens));
        if (s.kind !== 'agent' || s.api !== 'agent.act') continue;
        if (!s.cache) {
          cache.off++;
          continue;
        }
        const m = CACHE_MODES[s.cache.mode];
        if (m) cache[m]++;
        if (s.cache.reason) reasons.set(s.cache.reason, (reasons.get(s.cache.reason) ?? 0) + 1);
      }
    }
  }
  const totals = runs.reduce((a, r) => ({ tokens: a.tokens + r.total, costUsd: r.costUsd == null ? a.costUsd : (a.costUsd ?? 0) + r.costUsd, modelCalls: a.modelCalls + r.modelCalls }), { tokens: 0, costUsd: null, modelCalls: 0 });
  const latest = runs[0];
  const over = [];
  if (latest && Number(budget?.tokensPerRun) > 0 && latest.total > Number(budget.tokensPerRun)) over.push({ key: 'tokensPerRun', limit: Number(budget.tokensPerRun), value: latest.total });
  if (latest && Number(budget?.costPerRun) > 0 && latest.costUsd != null && latest.costUsd > Number(budget.costPerRun)) over.push({ key: 'costPerRun', limit: Number(budget.costPerRun), value: latest.costUsd });
  return {
    runs,
    totals: { ...totals, avgTokens: runs.length ? Math.round(totals.tokens / runs.length) : 0, avgCostUsd: totals.costUsd != null && runs.length ? totals.costUsd / runs.length : null },
    tests: [...tests.values()].map((t) => ({ ...t, avgTokens: Math.round(t.tokens / Math.max(1, t.runs)) })).sort((a, b) => b.avgTokens - a.avgTokens),
    cache,
    missReasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    roles: [...roles].map(([role, tokens]) => ({ role, tokens })).sort((a, b) => b.tokens - a.tokens),
    budget: budget && (Number(budget.tokensPerRun) > 0 || Number(budget.costPerRun) > 0) ? { tokensPerRun: Number(budget.tokensPerRun) || null, costPerRun: Number(budget.costPerRun) || null, over } : null,
  };
}

// Slowest steps on average: where the time goes inside the tests.
export function slowSteps(history, limit = 15) {
  const by = new Map();
  for (const { report } of history) {
    for (const r of results(report)) {
      for (const s of steps(report, r)) {
        const k = `${testKey(r)}|${s.index ?? ''}|${s.api}|${s.label ?? ''}`;
        if (!by.has(k)) by.set(k, { title: title(r), target: r.targetId, api: s.api, label: s.label ?? '', durations: [] });
        by.get(k).durations.push(num(s.durationMs));
      }
    }
  }
  return [...by.values()]
    .map(({ durations, ...x }) => ({ ...x, avgMs: Math.round(mean(durations)), maxMs: Math.max(...durations), samples: durations.length }))
    .sort((a, b) => b.avgMs - a.avgMs)
    .slice(0, limit);
}

// ---------------------------------------------------------------- route map

// Path only, with ids folded: /orders/42 and /orders/7 are one route (as the e2e cache reads them).
export function normalizeRoute(url) {
  let p = String(url ?? '').trim();
  if (!p) return null;
  const m = /^(?:navigated to\s+)?(\S+)/i.exec(p);
  p = m ? m[1] : p;
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) p = new URL(p).pathname;
  } catch {
    return null;
  }
  p = p.split(/[?#]/)[0] || '/';
  if (!p.startsWith('/')) return null;
  return p
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f-]{16,}$/i.test(seg) || /^[A-Za-z0-9_-]{20,}$/.test(seg) ? ':id' : seg))
    .join('/')
    .replace(/\/+$/, '') || '/';
}

export function routeMap(history) {
  const nodes = new Map();
  const edges = new Map();
  const node = (p) => {
    if (!nodes.has(p)) nodes.set(p, { route: p, visits: 0, tests: new Set(), failures: 0, entries: 0 });
    return nodes.get(p);
  };
  for (const { report } of history) {
    for (const r of results(report)) {
      const attempts = resultAttempts(report, r);
      let prev = null;
      for (const a of attempts) {
        prev = null;
        for (const s of a.steps ?? []) {
          const seen = [
            ...(s.events ?? []).filter((e) => e.kind === 'navigation').map((e) => e.detail),
            s.screen?.location,
          ];
          for (const raw of seen) {
            const p = normalizeRoute(raw);
            if (!p || p === prev) continue;
            const n = node(p);
            n.visits++;
            n.tests.add(testKey(r));
            if (prev) {
              const k = `${prev}\0${p}`;
              edges.set(k, { from: prev, to: p, count: (edges.get(k)?.count ?? 0) + 1 });
            } else n.entries++;
            prev = p;
          }
        }
      }
      const failUrl = normalizeRoute(attempts.at(-1)?.failure?.url);
      if (FAIL.has(r.status) && failUrl) {
        const n = node(failUrl);
        n.failures++;
        n.tests.add(testKey(r));
        if (!n.visits) n.visits = 1;
      }
    }
  }
  return {
    nodes: [...nodes.values()].map((n) => ({ ...n, tests: n.tests.size })).sort((a, b) => b.visits - a.visits),
    edges: [...edges.values()].sort((a, b) => b.count - a.count),
  };
}

// ---------------------------------------------------------------- branches

export function branchStats(metas) {
  const by = new Map();
  for (const m of metas) {
    const b = m.git?.branch ?? '(không rõ)';
    if (!by.has(b)) by.set(b, []);
    by.get(b).push(m);
  }
  return [...by].map(([branch, ms]) => {
    const rates = ms.slice(0, 10).map(passRate).filter((v) => v != null);
    const durs = ms.slice(0, 10).map((m) => m.durationMs).filter((v) => v != null);
    return {
      branch,
      runs: ms.length,
      latest: ms[0],
      passRate: mean(rates),
      avgDurationMs: durs.length ? Math.round(mean(durs)) : null,
      avgTokens: Math.round(mean(ms.slice(0, 10).map((m) => num(m.tokens?.input) + num(m.tokens?.output))) ?? 0),
      flaky: ms.slice(0, 10).reduce((s, m) => s + num(m.summary?.flaky), 0),
      failedRuns: ms.slice(0, 10).filter((m) => m.status !== 'passed').length,
    };
  }).sort((a, b) => String(b.latest.startedAt).localeCompare(String(a.latest.startedAt)));
}

// Per-test pass rate on branch A vs branch B over their recent runs: what one branch breaks.
export function compareBranches(history, a, b, n = 10) {
  const on = (br) => history.filter((h) => (h.meta.git?.branch ?? '(không rõ)') === br).slice(0, n);
  const rate = (hs) => {
    const m = new Map();
    for (const { report } of hs) for (const r of results(report)) {
      if (r.status === 'skipped') continue;
      if (!m.has(testKey(r))) m.set(testKey(r), { ...row(r), ok: 0, runs: 0 });
      const x = m.get(testKey(r));
      x.runs++;
      if (!FAIL.has(r.status)) x.ok++;
    }
    return m;
  };
  const A = on(a);
  const B = on(b);
  const ra = rate(A);
  const rb = rate(B);
  const rows = [];
  for (const k of new Set([...ra.keys(), ...rb.keys()])) {
    const x = ra.get(k);
    const y = rb.get(k);
    const pa = x ? x.ok / x.runs : null;
    const pb = y ? y.ok / y.runs : null;
    rows.push({ ...(y ?? x), a: x ? { passRate: pa, runs: x.runs } : null, b: y ? { passRate: pb, runs: y.runs } : null, delta: pa != null && pb != null ? pb - pa : null });
  }
  rows.sort((p, q) => (p.delta ?? 0) - (q.delta ?? 0) || String(p.title).localeCompare(String(q.title)));
  const latest = A[0] && B[0] ? compareRuns(A[0], B[0]) : null;
  return { a: { branch: a, runs: A.length }, b: { branch: b, runs: B.length }, rows, latest: latest && { counts: latest.counts, deltas: latest.deltas, base: latest.base.runId, head: latest.head.runId } };
}

// ---------------------------------------------------------------- agent step → locator

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

// Locator code for a recorded target (e2e trace-1 descriptor), or null when none would be reliable.
export function locatorFor(t) {
  if (!t || typeof t !== 'object') return null;
  let loc;
  if (t.testId) loc = `screen.getByTestId(${q(t.testId)})`;
  else if (t.role && (t.name || t.text)) loc = `screen.getByRole(${q(t.role)}, ${q(t.name ?? t.text)})`;
  else if (t.placeholder) loc = `screen.getByPlaceholder(${q(t.placeholder)})`;
  else if (t.inputPurpose && t.role) loc = `screen.getByLabel(${q(t.inputPurpose)})`;
  else if (t.text) loc = `screen.getByText(${q(t.text)})`;
  else return null;
  if (t.position && Number(t.position.of) > 1) loc += `.nth(${Number(t.position.index) || 0})`;
  return loc;
}

// One recorded action (trace-1) → one line of e2e test code; `todo` when it has no safe equivalent.
export function actionToCode(a) {
  const loc = locatorFor(a?.target);
  const need = (code) => (loc ? { code: `await ${loc}.${code};` } : { todo: `không có locator ổn định cho "${a?.summary ?? a?.name}"` });
  switch (a?.name) {
    case 'tap': return need('tap()');
    case 'doubleTap': return need('doubleTap()');
    case 'secondaryTap': return need('secondaryTap()');
    case 'longPress': return need('longPress()');
    case 'hover': return need('hover()');
    case 'scrollTo': return need('scrollIntoView()');
    case 'type': return need(`fill(${q(a.value ?? '')})`);
    case 'typeSecret': return loc ? { code: `await ${loc}.fill(secrets[${q(a.secret)}]); // Secret đã khai báo` } : { todo: 'secret fill không có locator' };
    case 'press': return need(`press(${q(a.key)})`);
    case 'select': return need(`selectOption(${q(a.value ?? '')})`);
    case 'check': return need(a.checked === false ? 'uncheck()' : 'check()');
    case 'upload': return need(`setInputFiles(${JSON.stringify(a.paths ?? [])})`);
    case 'drag': {
      const to = locatorFor(a.destination);
      return loc && to ? { code: `await ${loc}.dragTo(${to});` } : { todo: 'kéo thả không có locator ổn định' };
    }
    case 'navigate': return { code: `await app.open(${q(a.url)});` };
    case 'back': return { code: 'await app.back();' };
    case 'scroll': return a.target && loc ? { code: `await ${loc}.swipe({ direction: ${q(a.direction ?? 'down')} });` } : { code: `await screen.swipe({ direction: ${q(a.direction ?? 'down')} });` };
    case 'scrollUntil': return { code: `await screen.scrollUntilVisible(screen.getByText(${q(a.text)}));` };
    default: return { todo: `hành động "${a?.name}" cần agent (${a?.summary ?? ''})` };
  }
}

export function traceToCode(entry) {
  const actions = entry?.schemaVersion === 'trace-1' ? entry.payload?.actions : null;
  if (!Array.isArray(actions) || !actions.length) return null;
  const lines = [];
  let todos = 0;
  for (const a of actions.slice(0, 50)) {
    const c = actionToCode(a);
    if (c.code) lines.push(c.code);
    else {
      todos++;
      lines.push(`// TODO: ${c.todo}`);
    }
  }
  const anchors = (entry.payload.endAnchors ?? []).map(locatorFor).filter(Boolean).slice(0, 2);
  for (const l of anchors) lines.push(`await expect(${l}).toBeVisible();`);
  return { code: lines.join('\n'), todos, actions: actions.length, summary: String(entry.payload.summary ?? '').slice(0, 300) };
}

// Agent steps that replay from cache run after run: stable enough to become plain locator code,
// which runs with no model at all (the replay still pays for a hand-off whenever the screen moves).
export function locatorCandidates(history, { minReplays = 3 } = {}) {
  const by = new Map();
  for (const { meta, report } of history) {
    for (const r of results(report)) {
      for (const s of steps(report, r)) {
        if (s.kind !== 'agent' || s.api !== 'agent.act' || !s.cache) continue;
        const k = `${testKey(r)}|${s.index ?? ''}|${s.label ?? ''}`;
        if (!by.has(k)) by.set(k, { ...row(r), stepIndex: s.index ?? null, label: s.label ?? '', source: s.source ?? null, runs: 0, replayed: 0, handedOff: 0, missed: 0, liveTokens: [], entry: null, latest: null });
        const x = by.get(k);
        x.runs++;
        const mode = CACHE_MODES[s.cache.mode];
        if (mode) x[mode]++;
        if (mode !== 'replayed') x.liveTokens.push((s.events ?? []).filter((e) => e.kind === 'model').reduce((t, e) => t + num(e.inputTokens) + num(e.outputTokens), 0));
        if (!x.entry && /^[0-9a-f]{64}$/.test(s.cache.entry ?? '')) x.entry = s.cache.entry;
        x.latest ??= { runId: meta.runId, resultId: r.id };
      }
    }
  }
  return [...by.values()]
    .filter((x) => x.replayed >= minReplays || (x.runs >= minReplays && x.replayed / x.runs >= 0.6))
    .map(({ liveTokens, ...x }) => ({ ...x, stability: x.replayed / x.runs, tokensWhenLive: liveTokens.length ? Math.round(mean(liveTokens)) : null }))
    .sort((a, b) => b.stability - a.stability || b.runs - a.runs);
}

// ---------------------------------------------------------------- weekly digest

const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const fmtMs = (ms) => (ms == null ? '—' : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`);
const fmtTok = (n) => (n < 1000 ? String(n) : n < 1e6 ? `${Math.round(n / 1000)}k` : `${(n / 1e6).toFixed(1)}M`);
const code = (s) => `\`${String(s ?? '').replace(/[`\n\r]/g, ' ').slice(0, 80)}\``; // no escapes inside a code span
const esc = (s) => String(s ?? '').replace(/[\\`*_[\]<>|]/g, '\\$&').replace(/\s+/g, ' ').slice(0, 200);

export function digest(history, { days = 7, now = Date.now(), project = '', health = null } = {}) {
  const from = now - days * 86_400_000;
  const prevFrom = from - days * 86_400_000;
  const inRange = (h, a, b) => {
    const t = Date.parse(h.meta.startedAt);
    return t >= a && t < b;
  };
  const cur = history.filter((h) => inRange(h, from, now + 1));
  const prev = history.filter((h) => inRange(h, prevFrom, from));
  const rate = (hs) => mean(hs.map((h) => passRate(h.meta)).filter((v) => v != null));
  const tokens = (hs) => hs.reduce((s, h) => s + num(h.meta.tokens?.input) + num(h.meta.tokens?.output), 0);
  const flaky = flakyTests(cur).slice(0, 5);
  const groups = groupErrors(cur).slice(0, 5);
  const newFailures = [];
  if (cur.length && prev.length) {
    const cmp = compareRuns(prev[0], cur[0]);
    newFailures.push(...cmp.rows.filter((r) => r.change === 'regressed').slice(0, 8));
  }
  const slow = slowSteps(cur, 3);
  const cost = costStats(cur);
  const r1 = rate(cur);
  const r0 = rate(prev);
  const date = (t) => new Date(t).toISOString().slice(0, 10);
  const lines = [
    `# Digest e2e${project ? ` · ${esc(project)}` : ''}: ${date(from)} → ${date(now)}`,
    '',
    `- **Run:** ${cur.length} (tuần trước ${prev.length}) · fail ${cur.filter((h) => h.meta.status !== 'passed').length}`,
    `- **Pass rate TB:** ${pct(r1)}${r1 != null && r0 != null ? ` (${r1 >= r0 ? '+' : ''}${Math.round((r1 - r0) * 100)} điểm so với tuần trước)` : ''}`,
    `- **Token:** ${fmtTok(tokens(cur))}${prev.length ? ` (tuần trước ${fmtTok(tokens(prev))})` : ''}${cost.totals.costUsd != null ? ` · ~$${cost.totals.costUsd.toFixed(2)}` : ''}`,
    `- **Replay cache:** ${cost.cache.replayed + cost.cache.handedOff + cost.cache.missed ? pct(cost.cache.replayed / (cost.cache.replayed + cost.cache.handedOff + cost.cache.missed)) : '—'} step agent chạy từ cache`,
  ];
  if (health) lines.push(`- **Health score:** ${health.score}/100`);
  lines.push('', '## Test mới fail');
  lines.push(...(newFailures.length ? newFailures.map((r) => `- ${esc(r.title)} [${esc(r.target)}]${r.b?.error ? `: ${code(r.b.error.code)} ${esc(r.b.error.message)}` : ''}`) : ['- Không có.']));
  lines.push('', '## Flaky nhiều nhất');
  lines.push(...(flaky.length ? flaky.map((t) => `- ${esc(t.title)} [${esc(t.target)}]: ${t.flaky} lần flaky, ${t.flips} lần đổi kết quả / ${t.runs} run`) : ['- Không có.']));
  lines.push('', '## Nhóm lỗi');
  lines.push(...(groups.length ? groups.map((g) => `- ${code(g.code)} ${esc(g.message)}: ${g.tests.length} test, ${g.count} lần`) : ['- Không có.']));
  if (slow.length) {
    lines.push('', '## Step chậm nhất');
    lines.push(...slow.map((s) => `- ${esc(s.title)} › ${code(s.api)} ${esc(s.label)}: TB ${fmtMs(s.avgMs)}`));
  }
  return { markdown: `${lines.join('\n')}\n`, from: new Date(from).toISOString(), to: new Date(now).toISOString(), runs: cur.length, previousRuns: prev.length, passRate: r1, previousPassRate: r0 };
}
