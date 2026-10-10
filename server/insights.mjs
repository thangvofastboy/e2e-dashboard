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
      add('test', testKey(r), title(r), `${r.source?.file ?? r.file}:${r.source?.line ?? '?'} · ${r.targetId} · ${r.status}`, href, `${title(r)} ${r.source?.file ?? r.file} ${r.targetId} ${(r.tags ?? []).join(' ')}`, when);
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
