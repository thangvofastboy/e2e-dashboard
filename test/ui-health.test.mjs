import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_THRESHOLDS, mergeThresholds, rateHealth, deltaHealth, runHealth, kpis } from '../ui/health.js';

test('rate thresholds: good ≥ good, warn ≥ warn, else bad', () => {
  const t = DEFAULT_THRESHOLDS.passRate;
  assert.equal(rateHealth(0.97, t), 'good');
  assert.equal(rateHealth(0.95, t), 'good');
  assert.equal(rateHealth(0.88, t), 'warn');
  assert.equal(rateHealth(0.5, t), 'bad');
  assert.equal(rateHealth(null, t), 'muted');
});

test('delta thresholds compare to the recent average (lower is better)', () => {
  const t = DEFAULT_THRESHOLDS.duration;
  assert.equal(deltaHealth(-0.04, t), 'good');
  assert.equal(deltaHealth(0.1, t), 'good');
  assert.equal(deltaHealth(0.18, t), 'warn');
  assert.equal(deltaHealth(0.31, t), 'bad');
  assert.equal(deltaHealth(null, t), 'muted');
});

test('run health follows the run verdict', () => {
  assert.equal(runHealth('passed'), 'good');
  assert.equal(runHealth('failed'), 'bad');
  assert.equal(runHealth('error'), 'bad');
  assert.equal(runHealth('interrupted'), 'bad');
  assert.equal(runHealth('passed', { flaky: 2 }), 'warn');
});

test('mergeThresholds keeps defaults for missing or invalid values', () => {
  const t = mergeThresholds({ passRate: { good: 0.99 }, duration: { warn: 'x' } });
  assert.equal(t.passRate.good, 0.99);
  assert.equal(t.passRate.warn, DEFAULT_THRESHOLDS.passRate.warn);
  assert.equal(t.duration.warn, DEFAULT_THRESHOLDS.duration.warn);
});

const meta = (i, over = {}) => ({
  runId: `r${i}`, status: 'passed', durationMs: 100_000, tokens: { input: 40_000, output: 5_000 },
  summary: { passed: 10, failed: 0, flaky: 0, interrupted: 0, skipped: 0 }, replay: { replayed: 9, total: 10 }, ...over,
});

test('kpis computes value, delta and health for each card', () => {
  const metas = [meta(0, { durationMs: 140_000, tokens: { input: 43_000, output: 3_000 }, summary: { passed: 8, failed: 2, flaky: 0, interrupted: 0, skipped: 0 }, status: 'failed', replay: { replayed: 4, total: 10 } }), ...Array.from({ length: 10 }, (_, i) => meta(i + 1))];
  const k = Object.fromEntries(kpis(metas, DEFAULT_THRESHOLDS).map((c) => [c.key, c]));
  assert.equal(k.passRate.value, 0.8);
  assert.equal(k.passRate.health, 'warn');
  assert.equal(Math.round(k.passRate.delta * 100), -20);
  assert.equal(k.lastRun.health, 'bad');
  assert.equal(k.duration.health, 'bad');
  assert.equal(Math.round(k.duration.delta * 100), 40);
  assert.equal(k.tokens.health, 'good');
  assert.equal(k.replay.value, 0.4);
  assert.equal(k.replay.health, 'bad');
  assert.equal(k.duration.series.length, 11);
});

test('kpis on a single run has no deltas and replay is muted without cache data', () => {
  const k = Object.fromEntries(kpis([meta(0, { replay: { replayed: 0, total: 0 } })], DEFAULT_THRESHOLDS).map((c) => [c.key, c]));
  assert.equal(k.duration.delta, null);
  assert.equal(k.duration.health, 'muted');
  assert.equal(k.replay.health, 'muted');
});
