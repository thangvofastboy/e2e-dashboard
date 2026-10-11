// More analyses over archived runs (after M3): search, anomalies, agent-instruction lint, models,
// bisect plans. Pure functions over `history` ([{meta, report}], newest first), like analytics.mjs.
import { resultAttempts } from '../reporter/e2e-dashboard.reporter.mjs';
import { testKey, resultError } from './analytics.mjs';

const FAIL = new Set(['failed', 'timed-out', 'interrupted']);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const title = (r) => (Array.isArray(r.titlePath) ? r.titlePath.join(' › ') : String(r.testId ?? r.id));
const results = (report) => (report?.run?.results ?? []).filter((r) => r && r.kind !== 'setup');
const steps = (report, r) => resultAttempts(report, r).flatMap((a) => a.steps ?? []);

// ---------------------------------------------------------------- search

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

// Everything a viewer may type: test titles, files, error codes and messages, URLs, branches, commits, run ids.
export function search(history, query, { limit = 40 } = {}) {
  const terms = fold(query).split(/\s+/).filter(Boolean).slice(0, 8);
  if (!terms.length) return [];
  const hits = [];
  const seen = new Set();
  const add = (kind, key, label, sub, href, haystack, at) => {
    if (seen.has(`${kind}|${key}`)) return;
    const h = fold(haystack);
    if (!terms.every((t) => h.includes(t))) return;
    seen.add(`${kind}|${key}`);
    const score = terms.reduce((s, t) => s + (fold(label).includes(t) ? 2 : 1), 0);
    hits.push({ kind, label: String(label).slice(0, 200), sub: String(sub ?? '').slice(0, 200), href, score, at });
  };
  for (const { meta, report } of history) {
    const runHref = `#/run/${encodeURIComponent(meta.runId)}`;
    const when = meta.startedAt;
    add('run', meta.runId, `Run ${meta.runId.slice(-8)} · ${meta.status}`, `${meta.git?.branch ?? ''}@${String(meta.git?.commit ?? '').slice(0, 7)} · ${when}`, runHref,
      `${meta.runId} ${meta.status} ${meta.git?.branch ?? ''} ${meta.git?.commit ?? ''} ${meta.source ?? ''}`, when);
    for (const r of results(report)) {
      const href = `${runHref}/test/${encodeURIComponent(r.id)}`;
      add('test', testKey(r), title(r), `${r.source?.file ?? r.file}:${r.source?.line ?? '?'} · ${r.targetId} · ${r.status}`, `#/test/${encodeURIComponent(testKey(r))}`, `${title(r)} ${r.source?.file ?? r.file} ${r.targetId} ${(r.tags ?? []).join(' ')}`, when);
      const e = resultError(report, r);
      if (e) add('error', `${e.code}|${r.id}`, `${e.code ?? 'ERROR'}: ${String(e.message ?? '').split('\n')[0]}`, `${title(r)} · ${when}`, href, `${e.code} ${e.message} ${e.details?.locator ?? ''}`, when);
      const url = resultAttempts(report, r).at(-1)?.failure?.url;
      if (url) add('url', `${url}|${r.id}`, url, `${title(r)} fail tại đây`, href, url, when);
    }
  }
  const order = { test: 0, error: 1, url: 2, run: 3 };
  return hits.sort((a, b) => b.score - a.score || order[a.kind] - order[b.kind] || String(b.at).localeCompare(String(a.at))).slice(0, limit);
}

// ---------------------------------------------------------------- anomalies

const stats = (xs) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
  return { mean: m, sd };
};

// A test of the newest run (or of `runId`) that took much longer, or cost many more tokens, than its
// own history: over mean + 2σ, and at least 25% over the mean so tiny jitters on steady tests stay quiet.
export function anomalies(history, { runId = null, minSamples = 4, sigma = 2 } = {}) {
  const idx = runId ? history.findIndex((h) => h.meta.runId === runId) : 0;
  if (idx < 0 || !history[idx]) return [];
  const { meta, report } = history[idx];
  const past = history.slice(idx + 1, idx + 31);
  const metric = (rep, r) => {
    let tokens = 0;
    let cacheMiss = 0;
    for (const s of steps(rep, r)) {
      for (const e of s.events ?? []) if (e.kind === 'model') tokens += num(e.inputTokens) + num(e.outputTokens);
      if (s.cache && s.cache.mode !== 'self-finalized') cacheMiss++;
    }
    return { durationMs: resultAttempts(rep, r).reduce((t, a) => t + num(a.durationMs), 0), tokens, cacheMiss };
  };
  const pastBy = new Map();
  for (const h of past) for (const r of results(h.report)) {
    if (r.status === 'skipped') continue;
    if (!pastBy.has(testKey(r))) pastBy.set(testKey(r), []);
    pastBy.get(testKey(r)).push(metric(h.report, r));
  }
  const out = [];
  for (const r of results(report)) {
    const prev = pastBy.get(testKey(r));
    if (r.status === 'skipped' || !prev || prev.length < minSamples) continue;
    const now = metric(report, r);
    for (const [k, label] of [['durationMs', 'thời gian'], ['tokens', 'token'], ['cacheMiss', 'step không replay']]) {
      const s = stats(prev.map((p) => p[k]));
      const limit = s.mean + sigma * s.sd;
      if (now[k] > limit && now[k] > s.mean * 1.25 && now[k] - s.mean >= (k === 'durationMs' ? 500 : k === 'tokens' ? 200 : 1)) {
        out.push({ runId: meta.runId, resultId: r.id, key: testKey(r), title: title(r), target: r.targetId, metric: k, label, value: now[k], mean: Math.round(s.mean), sd: Math.round(s.sd), ratio: s.mean ? now[k] / s.mean : null, samples: prev.length });
      }
    }
  }
  return out.sort((a, b) => (b.ratio ?? 99) - (a.ratio ?? 99));
}

// ---------------------------------------------------------------- agent instruction lint

const MULTI_GOAL = /\b(and then|then|after that|afterwards)\b|\s(and|rồi|sau đó|xong|và)\s.*\s(and|rồi|sau đó|xong|và)\s|[;]/i;
const VAGUE = /\b(something|somehow|properly|correctly|etc|whatever|stuff|thing|appropriate|cái gì đó|đúng cách|v\.v)\b/i;
const CHECKY = /\b(verify|check|ensure|make sure|confirm|assert|kiểm tra|đảm bảo|xác nhận)\b/i;

export const LINT_RULES = {
  'no-verification': 'Không có bước kiểm tra sau act: replay cache không bao giờ được ghi (write: unconfirmed), mỗi run đều gọi model. Thêm expect(locator) hoặc agent.assert ngay sau.',
  'multi-goal': 'Câu lệnh gộp nhiều mục tiêu: tách thành nhiều agent.act, mỗi bước một mục tiêu và một kiểm tra.',
  'too-long': 'Câu lệnh dài (> 160 ký tự): khó replay và khó đọc; giữ mỗi act một mục tiêu ngắn.',
  vague: 'Từ mơ hồ ("properly", "something"…): nói rõ kết quả mong muốn.',
  'check-in-act': 'act đang làm việc của assert ("verify/check…"): dùng agent.assert hoặc expect cho phần kiểm tra.',
  'cache-gap': 'Agent đọc giá trị từ màn hình (gap): phần đó luôn chạy live. Đưa giá trị ổn định vào params hoặc unique().',
  'budget-heavy': 'Step tốn nhiều model call: thường do câu lệnh mơ hồ hoặc màn hình thay đổi; xem lại hoặc chuyển thành locator.',
};

export function lintAgentSteps(history, { maxModelCalls = 6 } = {}) {
  const by = new Map();
  for (const { meta, report } of history) {
    for (const r of results(report)) {
      for (const s of steps(report, r)) {
        if (s.kind !== 'agent') continue;
        const k = `${testKey(r)}|${s.api}|${s.label ?? ''}`;
        if (!by.has(k)) by.set(k, { key: testKey(r), title: title(r), target: r.targetId, api: s.api, label: String(s.label ?? ''), source: s.source ?? r.source ?? null, rules: new Set(), runs: 0, latest: { runId: meta.runId, resultId: r.id } });
        const x = by.get(k);
        x.runs++;
        const label = x.label;
        if (s.api === 'agent.act') {
          if (s.cache?.write === 'unconfirmed') x.rules.add('no-verification');
          if (MULTI_GOAL.test(label)) x.rules.add('multi-goal');
          if (CHECKY.test(label)) x.rules.add('check-in-act');
          if (s.cache?.reason === 'gap' || s.cache?.derived) x.rules.add('cache-gap');
        }
        if (label.length > 160) x.rules.add('too-long');
        if (VAGUE.test(label)) x.rules.add('vague');
        if (num(s.metrics?.modelCalls) > maxModelCalls) x.rules.add('budget-heavy');
      }
    }
  }
  return [...by.values()]
    .filter((x) => x.rules.size)
    .map((x) => ({ ...x, rules: [...x.rules] }))
    .sort((a, b) => b.rules.length - a.rules.length || a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------- models & budget

export function modelStats(history, { budget = null } = {}) {
  const by = new Map();
  for (const { meta, report } of history) {
    for (const r of results(report)) {
      for (const s of steps(report, r)) {
        const m = s.model;
        if (!m?.model) continue;
        const id = `${m.provider ?? '?'}/${m.model}`;
        if (!by.has(id)) by.set(id, { id, provider: m.provider ?? null, model: m.model, steps: 0, passed: 0, calls: 0, input: 0, output: 0, cacheRead: 0, costUsd: null, durationMs: 0, apis: new Map(), runs: new Set() });
        const x = by.get(id);
        x.steps++;
        if (s.status === 'passed') x.passed++;
        x.calls += num(m.calls);
        x.input += num(m.inputTokens);
        x.output += num(m.outputTokens);
        x.cacheRead += num(m.cacheReadTokens);
        if (m.estimatedCostUsd != null) x.costUsd = (x.costUsd ?? 0) + num(m.estimatedCostUsd);
        x.durationMs += num(s.durationMs);
        x.apis.set(s.api, (x.apis.get(s.api) ?? 0) + 1);
        x.runs.add(meta.runId);
      }
    }
  }
  const models = [...by.values()].map(({ apis, runs, ...x }) => ({
    ...x,
    runs: runs.size,
    passRate: x.steps ? x.passed / x.steps : null,
    avgDurationMs: x.steps ? Math.round(x.durationMs / x.steps) : null,
    tokensPerStep: x.steps ? Math.round((x.input + x.output) / x.steps) : null,
    costPerStep: x.costUsd != null && x.steps ? x.costUsd / x.steps : null,
    cacheShare: x.input ? x.cacheRead / x.input : null,
    apis: [...apis].map(([api, n]) => ({ api, steps: n })).sort((a, b) => b.steps - a.steps),
  })).sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.input + b.output - (a.input + a.output));
  const perModel = budget?.perModel && typeof budget.perModel === 'object' ? budget.perModel : {};
  const over = models
    .map((m) => ({ id: m.id, limit: Number(perModel[m.id] ?? perModel[m.model]), cost: m.costUsd }))
    .filter((o) => o.limit > 0 && o.cost != null && o.cost > o.limit);
  // Judgments (assert/waitFor/extract) on the most expensive model: candidates for a cheaper judge.
  const top = models[0];
  const hints = [];
  if (models.length && top?.costPerStep != null) {
    const judgments = top.apis.filter((a) => /agent\.(assert|waitFor|extract)/.test(a.api)).reduce((s, a) => s + a.steps, 0);
    if (judgments && models.some((m) => m !== top && m.costPerStep != null && m.costPerStep < top.costPerStep * 0.5))
      hints.push(`${judgments} bước judgment (assert/waitFor/extract) chạy trên ${top.id}: thử một judge rẻ hơn (models.judge trong e2e.config).`);
  }
  return { models, over, hints };
}

// ---------------------------------------------------------------- bisect

// For a test that broke: the last run where it passed and the first where it failed, and the
// `git bisect` that searches the commits in between with this one test.
export function bisectPlan(history, runId, resultId) {
  const idx = history.findIndex((h) => h.meta.runId === runId);
  const r = idx >= 0 && results(history[idx].report).find((x) => x.id === resultId);
  if (!r) return null;
  const key = testKey(r);
  let bad = history[idx];
  let good = null;
  for (const h of history.slice(idx + 1)) {
    const x = results(h.report).find((y) => testKey(y) === key);
    if (!x || x.status === 'skipped') continue;
    if (FAIL.has(x.status)) bad = h;
    else {
      good = h;
      break;
    }
  }
  const spec = r.source?.line ? `${r.source.file ?? r.file}:${r.source.line}` : r.source?.file ?? r.file;
  const target = /^[\w.-]+$/.test(r.targetId ?? '') ? ` --target ${r.targetId}` : '';
  const goodCommit = good?.meta.git?.commit ?? null;
  const badCommit = bad.meta.git?.commit ?? null;
  const hex = /^[0-9a-f]{7,64}$/;
  const usable = hex.test(goodCommit ?? '') && hex.test(badCommit ?? '') && goodCommit !== badCommit && /^[\w./@+-]+(:\d+)?$/.test(spec ?? '');
  return {
    title: title(r),
    test: spec,
    good: good && { runId: good.meta.runId, commit: goodCommit, startedAt: good.meta.startedAt, branch: good.meta.git?.branch ?? null },
    bad: { runId: bad.meta.runId, commit: badCommit, startedAt: bad.meta.startedAt, branch: bad.meta.git?.branch ?? null },
    script: usable
      ? [`git bisect start ${badCommit} ${goodCommit}`, `git bisect run npx e2e run ${spec}${target} --no-cache --retries 0`, 'git bisect reset'].join('\n')
      : null,
    reason: usable ? null : !good ? 'Chưa có run nào mà test này pass trong lịch sử.' : goodCommit === badCommit ? 'Lần pass và lần fail cùng một commit: có thể là flaky hoặc do môi trường, không phải do code.' : 'Thiếu commit của một trong hai run.',
  };
}

// The flaky history of one test, as text for the AI "why flaky" prompt.
export function flakyEvidence(history, key, limit = 20) {
  const rows = [];
  for (const { meta, report } of history) {
    const r = results(report).find((x) => testKey(x) === key);
    if (!r) continue;
    const atts = resultAttempts(report, r);
    const e = resultError(report, r);
    rows.push({
      runId: meta.runId, startedAt: meta.startedAt, status: r.status, commit: String(meta.git?.commit ?? '').slice(0, 10), branch: meta.git?.branch ?? null,
      attempts: atts.length, durationMs: atts.reduce((t, a) => t + num(a.durationMs), 0),
      error: e ? `${e.code ?? 'ERROR'}: ${String(e.message ?? '').split('\n')[0].slice(0, 200)}` : null,
      cache: steps(report, r).map((s) => s.cache?.mode).filter(Boolean).join(',') || null,
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

// ---------------------------------------------------------------- one test across runs

export function testDetail(history, key, { limit = 50 } = {}) {
  const rows = [];
  let info = null;
  for (const { meta, report } of history) {
    const r = results(report).find((x) => testKey(x) === key);
    if (!r) continue;
    info ??= { key, testId: r.testId, title: title(r), file: r.source?.file ?? r.file, line: r.source?.line ?? null, target: r.targetId, agent: r.agent ?? 'default', tags: r.tags ?? [] };
    const atts = resultAttempts(report, r);
    const last = atts.at(-1);
    let tokens = 0;
    for (const s of steps(report, r)) for (const e of s.events ?? []) if (e.kind === 'model') tokens += num(e.inputTokens) + num(e.outputTokens);
    const e = resultError(report, r);
    rows.push({
      runId: meta.runId, resultId: r.id, startedAt: meta.startedAt, status: r.status, attempts: atts.length,
      durationMs: atts.reduce((t, a) => t + num(a.durationMs), 0), tokens,
      branch: meta.git?.branch ?? null, commit: meta.git?.commit ?? null,
      error: e ? { code: e.code ?? null, message: String(e.message ?? '').slice(0, 400) } : null,
      failUrl: last?.failure?.url ?? null,
      screenshot: (last?.artifacts ?? []).find((x) => x.kind === 'screenshot' && x.path && (x.id === last.failure?.screen || FAIL.has(r.status)))?.path ?? null,
      steps: r.status !== 'skipped' && rows.length === 0 ? (last?.steps ?? []).map((s) => ({ index: s.index, api: s.api, label: s.label ?? '', status: s.status, durationMs: s.durationMs ?? null, cache: s.cache?.mode ?? null })) : undefined,
    });
    if (rows.length >= limit) break;
  }
  return info && { ...info, runs: rows };
}

// ---------------------------------------------------------------- app errors (appLog)

// Console errors and failing requests the app produced while tests ran, grouped by shape.
export function normalizeLogText(text) {
  return String(text ?? '')
    .slice(0, 300)
    .replace(/https?:\/\/[^\s/]+/gi, '')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ':id')
    .replace(/\/\d+(?=[/\s?]|$)/g, '/:id')
    .replace(/\?[^\s]*/g, '')
    .replace(/\b[0-9a-f]{12,}\b/gi, ':hex')
    .replace(/(?<![\d/])\d+(\.\d+)?(ms|s|px)\b/g, 'N$2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function appErrors(history, { levels = ['error', 'warning'] } = {}) {
  const by = new Map();
  for (const { meta, report } of [...history].reverse()) {
    for (const r of results(report)) {
      for (const a of resultAttempts(report, r)) {
        for (const l of a.appLog ?? []) {
          if (!levels.includes(l.level)) continue;
          const sig = `${l.source}|${l.level}|${normalizeLogText(l.text)}`;
          if (!by.has(sig)) by.set(sig, { signature: normalizeLogText(l.text), source: l.source, level: l.level, sample: String(l.text ?? '').slice(0, 300), count: 0, tests: new Map(), runs: new Set(), firstSeen: meta.startedAt, firstCommit: meta.git?.commit ?? null, lastSeen: meta.startedAt, failing: 0 });
          const g = by.get(sig);
          g.count++;
          g.runs.add(meta.runId);
          g.lastSeen = meta.startedAt;
          if (FAIL.has(r.status)) g.failing++;
          g.tests.set(testKey(r), { title: title(r), runId: meta.runId, resultId: r.id });
        }
      }
    }
  }
  const http = (s) => /\b([45]\d\d)\b/.exec(s)?.[1] ?? null;
  return [...by.values()]
    .map((g) => ({ ...g, tests: [...g.tests.values()], runs: g.runs.size, httpStatus: g.source === 'network' ? http(g.sample) : null }))
    .sort((a, b) => (b.level === 'error') - (a.level === 'error') || b.runs - a.runs || b.count - a.count);
}

// ---------------------------------------------------------------- setup & hook timing

// Where a run's time goes: setup projects, beforeEach/afterEach steps, and the test bodies.
export function setupTiming(history) {
  const runs = [];
  const setups = new Map();
  for (const { meta, report } of history) {
    const t = { runId: meta.runId, startedAt: meta.startedAt, setup: 0, beforeEach: 0, afterEach: 0, body: 0 };
    for (const r of report?.run?.results ?? []) {
      if (!r) continue;
      if (r.kind === 'setup') {
        const d = resultAttempts(report, r).reduce((s, a) => s + num(a.durationMs), 0);
        t.setup += d;
        const k = title(r);
        if (!setups.has(k)) setups.set(k, []);
        setups.get(k).push(d);
        continue;
      }
      for (const a of resultAttempts(report, r)) {
        let hooks = 0;
        for (const s of a.steps ?? []) {
          if (s.phase === 'beforeEach' || s.phase === 'afterEach') {
            t[s.phase] += num(s.durationMs);
            hooks += num(s.durationMs);
          }
        }
        t.body += Math.max(0, num(a.durationMs) - hooks);
      }
    }
    runs.push(t);
  }
  const total = (k) => runs.reduce((s, r) => s + r[k], 0);
  const all = total('setup') + total('beforeEach') + total('afterEach') + total('body');
  return {
    runs,
    share: all ? { setup: total('setup') / all, beforeEach: total('beforeEach') / all, afterEach: total('afterEach') / all, body: total('body') / all } : null,
    setups: [...setups].map(([name, ds]) => ({ name, avgMs: Math.round(ds.reduce((a, b) => a + b, 0) / ds.length), runs: ds.length })).sort((a, b) => b.avgMs - a.avgMs),
  };
}

// ---------------------------------------------------------------- explore runs

export function exploreSummary(report) {
  const e = report?.run?.explore;
  if (!e) return null;
  return {
    goal: String(e.goal ?? ''), ended: e.ended ?? null, summary: e.summary ?? null,
    steps: (e.steps ?? []).map((s) => ({ index: s.index, title: s.title, instruction: s.instruction, status: s.status, summary: s.summary ?? null, durationMs: s.durationMs })),
    findings: [...(e.findings ?? [])].sort((a, b) => num(b.severity) - num(a.severity)),
  };
}

// ---------------------------------------------------------------- failures by environment

// Fail rate per value of each environment dimension; a value far above the overall rate is
// where the failures live ("only on webkit", "only in the evening run").
export function environmentBreakdown(history, { minResults = 3 } = {}) {
  const dims = { target: new Map(), os: new Map(), browser: new Map(), runner: new Map(), hour: new Map(), branch: new Map() };
  let total = 0;
  let fails = 0;
  const bump = (dim, value, failed) => {
    if (value == null || value === '') return;
    const m = dims[dim];
    const k = String(value).slice(0, 80);
    if (!m.has(k)) m.set(k, { value: k, results: 0, fails: 0 });
    const x = m.get(k);
    x.results++;
    if (failed) x.fails++;
  };
  for (const { meta, report } of history) {
    const env = report.run?.environment ?? {};
    const hour = new Date(meta.startedAt).getHours();
    for (const r of results(report)) {
      if (r.status === 'skipped') continue;
      const failed = FAIL.has(r.status);
      total++;
      if (failed) fails++;
      const a = resultAttempts(report, r).at(-1);
      bump('target', r.targetId, failed);
      bump('os', env.os ? `${env.os}${env.arch ? ` ${env.arch}` : ''}` : null, failed);
      bump('browser', a?.environment?.browser ? String(a.environment.browser).split(' ')[0] : null, failed);
      bump('runner', report.run?.runner?.version ? `e2e ${report.run.runner.version}` : null, failed);
      bump('hour', Number.isFinite(hour) ? `${String(hour).padStart(2, '0')}h` : null, failed);
      bump('branch', meta.git?.branch, failed);
    }
  }
  const overall = total ? fails / total : null;
  const out = {};
  for (const [dim, m] of Object.entries(dims)) {
    const rows = [...m.values()].filter((x) => x.results >= minResults).map((x) => ({ ...x, failRate: x.fails / x.results, lift: overall ? x.fails / x.results / overall : null }));
    if (rows.length > 1) out[dim] = rows.sort((a, b) => b.failRate - a.failRate);
  }
  const hotspots = Object.entries(out).flatMap(([dim, rows]) => rows.filter((x) => x.fails >= 2 && x.lift >= 1.5).map((x) => ({ dim, ...x }))).sort((a, b) => b.lift - a.lift).slice(0, 6);
  return { total, fails, overall, dims: out, hotspots };
}

// ---------------------------------------------------------------- SLO / error budget

// Target pass rate over a rolling window: the failures the target allows, how many are spent,
// and how fast (burn rate > 1 means the budget runs out before the window does).
export function sloStatus(history, { target = 0.95, days = 7, now = Date.now() } = {}) {
  const from = now - days * 86_400_000;
  let executed = 0;
  let failed = 0;
  const daily = new Map();
  for (const { meta, report } of history) {
    const t = Date.parse(meta.startedAt);
    if (!(t >= from && t <= now)) continue;
    const day = new Date(t).toISOString().slice(0, 10);
    if (!daily.has(day)) daily.set(day, { day, executed: 0, failed: 0 });
    const d = daily.get(day);
    for (const r of results(report)) {
      if (r.status === 'skipped') continue;
      executed++;
      d.executed++;
      if (FAIL.has(r.status)) {
        failed++;
        d.failed++;
      }
    }
  }
  const allowed = executed * (1 - target);
  const actual = executed ? 1 - failed / executed : null;
  const remaining = allowed ? Math.max(0, 1 - failed / allowed) : executed ? (failed ? 0 : 1) : null;
  const elapsed = Math.min(1, (now - from) / (days * 86_400_000));
  return {
    target, days, executed, failed, actual,
    allowedFailures: Math.floor(allowed), remaining,
    burnRate: allowed ? failed / allowed / elapsed : null,
    met: actual == null ? null : actual >= target,
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
  };
}

// ---------------------------------------------------------------- quality gate

// Pass/fail for CI or a pre-push hook: new failures vs the previous run (or the baseline),
// health score, SLO and token budget. Each check says why.
export function qualityGate({ history, health, slo, baseline = null, compare, rules = {} }) {
  const r = { maxNewFailures: 0, minHealth: null, requireSlo: false, maxTokens: null, ...rules };
  const latest = history[0];
  if (!latest) return { pass: false, checks: [{ name: 'run', pass: false, detail: 'Chưa có run nào.' }] };
  const base = baseline ?? history[1] ?? null;
  const checks = [];
  if (base) {
    const c = compare(base, latest);
    const n = c.counts.regressed;
    checks.push({ name: 'new-failures', pass: n <= r.maxNewFailures, detail: `${n} test mới fail so với ${baseline ? 'baseline' : 'run trước'} (cho phép ${r.maxNewFailures})`, tests: c.rows.filter((x) => x.change === 'regressed').map((x) => x.title).slice(0, 10) });
  } else checks.push({ name: 'new-failures', pass: latest.meta.status === 'passed', detail: 'Chưa có run để so: dùng kết quả run mới nhất.' });
  if (Number.isFinite(r.minHealth) && health) checks.push({ name: 'health', pass: health.score >= r.minHealth, detail: `Health score ${health.score} (tối thiểu ${r.minHealth})` });
  if (r.requireSlo && slo?.met != null) checks.push({ name: 'slo', pass: slo.met, detail: `Pass rate ${Math.round((slo.actual ?? 0) * 1000) / 10}% trong ${slo.days} ngày (mục tiêu ${Math.round(slo.target * 100)}%)` });
  if (Number.isFinite(r.maxTokens)) {
    const tok = num(latest.meta.tokens?.input) + num(latest.meta.tokens?.output);
    checks.push({ name: 'tokens', pass: tok <= r.maxTokens, detail: `${tok} token ở run mới nhất (tối đa ${r.maxTokens})` });
  }
  return { pass: checks.every((c) => c.pass), runId: latest.meta.runId, checks };
}
