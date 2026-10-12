// Inputs for the quality gate and the SLO, shared by `/e2e-dashboard gate`, the API and the MCP server.
import { readConfig } from '../reporter/e2e-dashboard.reporter.mjs';
import { loadHistory, listRuns, getRun, cachedCounts } from './store.mjs';
import { indexedCounts } from './runindex.mjs';
import { compareRuns } from './analytics.mjs';
import { qualityGate, sloStatus } from './insights.mjs';
import { flakyShare } from './digest.mjs';
import { healthScore } from '../ui/health.js';

export function sloConfig(cfg) {
  const t = Number(cfg?.slo?.passRate);
  const d = Number.parseInt(cfg?.slo?.days, 10);
  return { target: t > 0 && t < 1 ? t : 0.95, days: d > 0 && d <= 90 ? d : 7 };
}

// Every run inside the SLO window (a fixed count would cut "30 days" short on a busy repo), as { meta, counts }:
// sloStatus only needs executed / failed per run, so no full report is kept (store.mjs cachedCounts).
export async function sloHistory(root, days, { now = Date.now() } = {}) {
  const from = now - days * 86_400_000;
  const indexed = await indexedCounts(root).catch(() => null); // chỉ mục SQLite: không đọc report nào
  const out = [];
  for (const meta of await listRuns(root)) {
    if (Date.parse(meta.startedAt) < from || meta.kind === 'explore') continue;
    try {
      out.push({ meta, counts: indexed?.get(meta.runId) ?? (await cachedCounts(root, meta.dir)) }); // tuần tự: một report trong RAM mỗi lúc
    } catch {
      // removed by retention meanwhile
    }
  }
  return out;
}

export async function runGate(root, overrides = {}) {
  const cfg = readConfig(root);
  const history = (await loadHistory(root, 20)).filter((h) => h.meta.kind !== 'explore'); // gate: run mới nhất + trước đó; health: 20 run
  const health = healthScore(history.map((h) => h.meta), { flakyShare: flakyShare(history) });
  const slo = sloStatus(await sloHistory(root, sloConfig(cfg).days), sloConfig(cfg));
  const baseMeta = (await listRuns(root)).find((m) => m.baseline && m.runId !== history[0]?.meta.runId);
  const baseline = baseMeta ? await getRun(root, baseMeta.runId) : null;
  const rules = { ...(cfg.gate && typeof cfg.gate === 'object' ? cfg.gate : {}), ...overrides };
  const clean = Object.fromEntries(Object.entries(rules).filter(([k, v]) => (k === 'requireSlo' ? typeof v === 'boolean' : Number.isFinite(v))));
  return { ...qualityGate({ history, health, slo, baseline, compare: compareRuns, rules: clean }), health: health?.score ?? null, slo };
}
