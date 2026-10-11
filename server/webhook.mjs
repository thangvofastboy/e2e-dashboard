// Slack / Discord / any JSON webhook for finished runs and the digest. URLs come only from the user's
// own ~/.e2e-dashboard/config.json or E2E_DASHBOARD_WEBHOOK: a cloned repo must not be able to send its
// test data to an address it chose.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homeDir } from './projects.mjs';

const OK_URL = /^https:\/\/[^\s/@]+\/[^\s]*$/;

export async function webhookConfig(env = process.env) {
  let list = [];
  try {
    const cfg = JSON.parse(await readFile(join(homeDir(env), 'config.json'), 'utf8'));
    list = Array.isArray(cfg.webhooks) ? cfg.webhooks : [];
  } catch {
    // none
  }
  if (env.E2E_DASHBOARD_WEBHOOK) list = [...list, { url: env.E2E_DASHBOARD_WEBHOOK }];
  return list
    .filter((w) => w && typeof w.url === 'string' && OK_URL.test(w.url))
    .map((w) => ({ url: w.url, events: Array.isArray(w.events) ? w.events.filter((e) => typeof e === 'string') : ['run-failed', 'digest'] }));
}

// Slack reads `text`, Discord `content`: send both.
export async function sendWebhooks(hooks, event, text, { fetchImpl = globalThis.fetch } = {}) {
  const body = JSON.stringify({ text: String(text).slice(0, 3900), content: String(text).slice(0, 1900), event });
  const sent = [];
  for (const h of hooks.filter((x) => x.events.includes(event) || x.events.includes('*'))) {
    try {
      const res = await fetchImpl(h.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(10_000) });
      sent.push({ host: new URL(h.url).host, ok: res.ok, status: res.status });
    } catch (e) {
      sent.push({ host: new URL(h.url).host, ok: false, error: e.message });
    }
  }
  return sent;
}
