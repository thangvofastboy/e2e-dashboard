// Health of the headline metrics: good / warn / bad (muted when there is nothing to judge).
export const DEFAULT_THRESHOLDS = {
  passRate: { good: 0.95, warn: 0.8 }, // ratio, higher is better
  replay: { good: 0.8, warn: 0.5 }, // ratio, higher is better
  duration: { good: 0.1, warn: 0.3 }, // change vs recent average, lower is better
  tokens: { good: 0.1, warn: 0.3 },
};

export function mergeThresholds(cfg) {
  const out = {};
  for (const [k, def] of Object.entries(DEFAULT_THRESHOLDS)) {
    out[k] = {};
    for (const f of ['good', 'warn']) out[k][f] = Number.isFinite(cfg?.[k]?.[f]) ? cfg[k][f] : def[f];
  }
  return out;
}

export function passRate(meta) {
  const s = meta.summary ?? {};
  const n = (v) => Number(v) || 0; // counts come from report.json
  const ok = n(s.passed) + n(s.flaky);
  const done = ok + n(s.failed) + n(s.interrupted) - nonTestFailures(meta);
  return done > 0 ? ok / done : null;
}

// Failures that are not about the app under test (configuration / infrastructure): left out of the pass rate.
// Runs archived before 0.9 have no errorClasses, so they count as before.
export function nonTestFailures(meta) {
  const c = meta.errorClasses ?? {};
  const failed = Number(meta.summary?.failed) || 0;
  return Math.min(failed, (Number(c.configuration) || 0) + (Number(c.infrastructure) || 0));
}

export function rateHealth(v, t) {
  if (v == null || Number.isNaN(v)) return 'muted';
  return v >= t.good ? 'good' : v >= t.warn ? 'warn' : 'bad';
}

export function deltaHealth(d, t) {
  if (d == null || Number.isNaN(d)) return 'muted';
  return d <= t.good ? 'good' : d <= t.warn ? 'warn' : 'bad';
}

export function runHealth(status, summary = {}) {
  if (status === 'passed') return summary.flaky ? 'warn' : 'good';
  if (['failed', 'error', 'interrupted', 'timed-out'].includes(status)) return 'bad';
  return status === 'blocked' ? 'warn' : 'muted';
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const tokensOf = (m) => (m.tokens?.input ?? 0) + (m.tokens?.output ?? 0);

// Change of the latest value against the average of the previous (up to 10) runs.
function versusRecent(metas, pick) {
  const now = pick(metas[0]);
  const avg = mean(metas.slice(1, 11).map(pick).filter((v) => v != null));
  return now == null || !avg ? null : now / avg - 1;
}

export function kpis(metas, t) {
  const latest = metas[0];
  const chron = metas.slice(0, 20).reverse();
  const rate = passRate(latest);
  const prevRate = metas[1] ? passRate(metas[1]) : null;
  const replay = latest.replay?.total ? latest.replay.replayed / latest.replay.total : null;
  const dDur = versusRecent(metas, (m) => m.durationMs);
  const dTok = versusRecent(metas, tokensOf);
  return [
    { key: 'passRate', value: rate, delta: rate != null && prevRate != null ? rate - prevRate : null, health: rateHealth(rate, t.passRate), series: chron.map(passRate) },
    { key: 'lastRun', value: latest.status, summary: latest.summary ?? {}, delta: null, health: runHealth(latest.status, latest.summary), series: [] },
    { key: 'duration', value: latest.durationMs, delta: dDur, health: deltaHealth(dDur, t.duration), series: chron.map((m) => m.durationMs) },
    { key: 'tokens', value: tokensOf(latest), delta: dTok, health: deltaHealth(dTok, t.tokens), series: chron.map(tokensOf) },
    { key: 'replay', value: replay, delta: null, health: rateHealth(replay, t.replay), series: chron.map((m) => (m.replay?.total ? m.replay.replayed / m.replay.total : null)) },
  ];
}

// Health score 0–100: one number for "how is this suite doing", from the last 10 runs.
// `flakyShare` (flaky tests / tests, from the flaky analysis) is optional: without it the share of
// flaky results in the run summaries stands in.
const HEALTH_WEIGHTS = { passRate: 40, stability: 25, speed: 15, cost: 10, cache: 10 };
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function healthScore(metas, { flakyShare = null } = {}) {
  const recent = (metas ?? []).slice(0, 10);
  if (!recent.length) return null;
  const n = (v) => Number(v) || 0;
  const rates = recent.map(passRate).filter((v) => v != null);
  let share = flakyShare;
  if (share == null) {
    const executed = recent.reduce((s, m) => s + n(m.summary?.passed) + n(m.summary?.flaky) + n(m.summary?.failed) + n(m.summary?.interrupted), 0);
    share = executed ? recent.reduce((s, m) => s + n(m.summary?.flaky), 0) / executed : null;
  }
  const dDur = versusRecent(metas, (m) => m.durationMs);
  const dTok = versusRecent(metas, tokensOf);
  const latest = recent[0];
  const parts = [
    { key: 'passRate', label: 'Pass rate (TB 10 run)', value: mean(rates), score: mean(rates) },
    { key: 'stability', label: 'Độ ổn định (ít flaky)', value: share, score: share == null ? null : clamp01(1 - share * 4) },
    { key: 'speed', label: 'Thời gian so với TB', value: dDur, score: dDur == null ? null : clamp01(1 - Math.max(0, dDur) / 0.5) },
    { key: 'cost', label: 'Token so với TB', value: dTok, score: dTok == null ? null : clamp01(1 - Math.max(0, dTok) / 0.5) },
    { key: 'cache', label: 'Replay cache', value: latest.replay?.total ? latest.replay.replayed / latest.replay.total : null, score: latest.replay?.total ? clamp01(latest.replay.replayed / latest.replay.total) : null },
  ].map((p) => ({ ...p, weight: HEALTH_WEIGHTS[p.key] }));
  const used = parts.filter((p) => p.score != null);
  if (!used.some((p) => p.key === 'passRate')) return null;
  const total = used.reduce((s, p) => s + p.weight, 0);
  const score = Math.round((used.reduce((s, p) => s + p.score * p.weight, 0) / total) * 100);
  return { score, health: score >= 85 ? 'good' : score >= 65 ? 'warn' : 'bad', parts };
}
