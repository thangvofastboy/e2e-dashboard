// Inputs for the quality gate and the SLO, shared by `/e2e-dashboard gate`, the API and the MCP server.
import { readConfig } from '../reporter/e2e-dashboard.reporter.mjs';
import { loadHistory, listRuns, getRun } from './store.mjs';
import { compareRuns } from './analytics.mjs';
import { qualityGate, sloStatus } from './insights.mjs';
import { flakyShare } from './digest.mjs';
import { healthScore } from '../ui/health.js';

export function sloConfig(cfg) {
  const t = Number(cfg?.slo?.passRate);
  const d = Number.parseInt(cfg?.slo?.days, 10);
  return { target: t > 0 && t < 1 ? t : 0.95, days: d > 0 && d <= 90 ? d : 7 };
}

export async function runGate(root, overrides = {}) {
  const cfg = readConfig(root);
  const history = (await loadHistory(root, 120)).filter((h) => h.meta.kind !== 'explore');
  const recent = history.slice(0, 20);
  const health = healthScore(recent.map((h) => h.meta), { flakyShare: flakyShare(recent) });
  const slo = sloStatus(history, sloConfig(cfg));
  const baseMeta = (await listRuns(root)).find((m) => m.baseline && m.runId !== history[0]?.meta.runId);
  const baseline = baseMeta ? await getRun(root, baseMeta.runId) : null;
  const rules = { ...(cfg.gate && typeof cfg.gate === 'object' ? cfg.gate : {}), ...overrides };
  const clean = Object.fromEntries(Object.entries(rules).filter(([k, v]) => (k === 'requireSlo' ? typeof v === 'boolean' : Number.isFinite(v))));
  return { ...qualityGate({ history, health, slo, baseline, compare: compareRuns, rules: clean }), health: health?.score ?? null, slo };
}
