// Glue for the M7 background work the server does after each archived run: fold it into the long-term
// rollups, check the alert rules and deliver the alerts that just started.
import { basename } from 'node:path';
import { readConfig } from '../reporter/e2e-dashboard.reporter.mjs';
import { loadHistory } from './store.mjs';
import { syncLongterm } from './longterm.mjs';
import { alertRules, evaluateAlerts, recordAlerts } from './alerts.mjs';
import { moduleResolver } from './groups.mjs';
import { readCodeowners, ownersOf } from './owners.mjs';
import { webhookConfig, sendWebhooks, mentionMap, mentionsFor } from './webhook.mjs';

export async function checkAlerts(root, { env = process.env, notifier = null, fetchImpl } = {}) {
  const cfg = readConfig(root);
  const { index } = await syncLongterm(root);
  const rules = alertRules(cfg);
  if (!rules.length) return { fresh: [], cleared: [] };
  const history = await loadHistory(root, 60);
  const { rules: co } = readCodeowners(root);
  const owners = co.length ? (f) => ownersOf(co, f) : null;
  const files = [...new Set(history.flatMap((h) => (h.report?.run?.results ?? []).map((r) => r.source?.file ?? r.file).filter(Boolean)))];
  const found = evaluateAlerts(rules, { history, index, ownersOf: owners, moduleOf: moduleResolver(files, cfg.modules), cfg });
  const r = await recordAlerts(root, found);
  if (r.fresh.length) {
    const project = basename(root);
    notifier?.message?.(`e2e 🚨 ${r.fresh.length} cảnh báo`, r.fresh.map((a) => a.title).join(' · '));
    const hooks = await webhookConfig(env).catch(() => []);
    if (hooks.length) {
      const map = await mentionMap(env).catch(() => ({}));
      const text = [`🚨 e2e (${project}): ${r.fresh.length} cảnh báo`, ...r.fresh.map((a) => `• ${a.title}`)].join('\n');
      const mentions = mentionsFor(r.fresh.flatMap((a) => a.owners), map);
      await sendWebhooks(hooks, 'alert', text, { mentions, ...(fetchImpl ? { fetchImpl } : {}) }).catch(() => {});
    }
  }
  return r;
}
