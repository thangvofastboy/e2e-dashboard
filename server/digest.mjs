// The weekly digest with everything it draws on, shared by the page and `/e2e-dashboard digest`.
import { basename } from 'node:path';
import { loadHistory } from './store.mjs';
import { digest, flakyTests, testKey } from './analytics.mjs';
import { anomalies } from './insights.mjs';
import { readQuarantine, quarantineFlags } from './quarantine.mjs';
import { readCodeowners, ownersOf } from './owners.mjs';
import { healthScore } from '../ui/health.js';

export function flakyShare(history, flaky = flakyTests(history)) {
  const keys = new Set(history.flatMap((h) => (h.report.run.results ?? []).filter((r) => r.kind !== 'setup' && r.status !== 'skipped').map(testKey)));
  return keys.size ? flaky.filter((f) => f.score >= 0.1).length / keys.size : null;
}

export async function buildDigest(root, { days = 7, now = Date.now() } = {}) {
  const history = (await loadHistory(root, 200)).filter((h) => h.meta.kind !== 'explore'); // explore runs have no tests
  const recent = history.slice(0, 20);
  const health = healthScore(recent.map((h) => h.meta), { flakyShare: flakyShare(recent) });
  const { rules } = readCodeowners(root);
  return digest(history, {
    days, now, project: basename(root), health,
    anomalies: anomalies(history),
    quarantine: quarantineFlags(await readQuarantine(root), now),
    ownersOf: rules.length ? (file) => ownersOf(rules, file) : null,
  });
}
