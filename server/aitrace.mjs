// `e2e run --ai-trace` document ({ runs[], steps[] }, the AI SDK devtools shape) archived next to a run.
// The list view carries short previews; the full prompt and response of one call are fetched on demand.
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isLink } from '../reporter/e2e-dashboard.reporter.mjs';

const PREVIEW = 600;
const DETAIL_MAX = 200_000;
const clip = (s, n) => (typeof s === 'string' && s.length > n ? `${s.slice(0, n)}…` : s);
const num = (v) => (Number.isFinite(v) ? v : 0);
const json = (s) => {
  try {
    return typeof s === 'string' ? JSON.parse(s) : (s ?? null);
  } catch {
    return null;
  }
};

// One parsed document is kept: opening the calls of a test one after another must not parse a 30 MB file each time.
let last = { key: '', doc: null };

async function load(dir) {
  const file = join(dir, 'ai-trace.json');
  if (isLink(file)) return null;
  try {
    const st = await stat(file);
    if (st.size > 30 * 1024 * 1024) return null;
    const key = `${file}:${st.size}:${st.mtimeMs}`;
    if (last.key === key) return last.doc;
    const doc = JSON.parse(await readFile(file, 'utf8'));
    last = { key, doc: Array.isArray(doc?.runs) && Array.isArray(doc?.steps) ? doc : null };
    return last.doc;
  } catch {
    return null;
  }
}

// AI SDK usage: { inputTokens, outputTokens } or { inputTokens: { total } } depending on the version
export function usageOf(raw) {
  const u = json(raw) ?? {};
  const pick = (v) => num(typeof v === 'object' && v ? v.total : v);
  return { input: pick(u.inputTokens ?? u.promptTokens), output: pick(u.outputTokens ?? u.completionTokens), cached: pick(u.cachedInputTokens ?? u.inputTokens?.cacheRead) };
}

const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (typeof p === 'string' ? p : p?.type === 'text' ? p.text : p?.type ? `[${p.type}]` : '')).join(' ') : '');

function preview(step) {
  const inp = json(step.input) ?? {};
  const last = [...(inp.prompt ?? [])].reverse().find((m) => m?.role === 'user' || m?.role === 'tool');
  const out = json(step.output) ?? {};
  const outText = textOf(out.content) || textOf(out.response?.messages?.at(-1)?.content);
  return { prompt: clip(textOf(last?.content).replace(/\s+/g, ' ').trim(), PREVIEW), response: clip(outText.replace(/\s+/g, ' ').trim(), PREVIEW), finishReason: out.finishReason ?? null, messages: (inp.prompt ?? []).length, tools: (inp.tools ?? []).length };
}

// testId (optional): only the runs recorded for that test
export async function aiTraceView(dir, { testId = null } = {}) {
  const doc = await load(dir);
  if (!doc) return null;
  const byRun = new Map();
  for (const s of doc.steps) {
    if (!byRun.has(s.run_id)) byRun.set(s.run_id, []);
    byRun.get(s.run_id).push(s);
  }
  const totals = { calls: 0, input: 0, output: 0, cached: 0, durationMs: 0, errors: 0 };
  const runs = [];
  for (const r of doc.runs) {
    if (testId && r.e2e?.testId !== testId) continue;
    const calls = (byRun.get(r.id) ?? []).map((s) => {
      const u = usageOf(s.usage);
      const e = json(s.error);
      return { id: String(s.id), n: num(s.step_number), model: s.model_id ?? null, provider: s.provider ?? null, startedAt: s.started_at ?? null, durationMs: Number.isFinite(s.duration_ms) ? s.duration_ms : null, ...u, error: s.error ? clip(typeof e === 'string' ? e : (e?.message ?? String(s.error)), 400) : null, ...preview(s) };
    });
    for (const c of calls) {
      totals.calls++;
      totals.input += c.input;
      totals.output += c.output;
      totals.cached += c.cached;
      totals.durationMs += c.durationMs ?? 0;
      if (c.error) totals.errors++;
    }
    runs.push({ id: String(r.id), name: r.function_id ?? null, startedAt: r.started_at ?? null, scope: r.e2e ? { test: r.e2e.test, testId: r.e2e.testId, target: r.e2e.target, agent: r.e2e.agent, attempt: r.e2e.attempt, api: r.e2e.api ?? null, label: r.e2e.label ?? null } : null, calls });
  }
  return { runs, totals };
}

// One call in full: parsed prompt messages, tools and response, each capped
export async function aiTraceCall(dir, stepId) {
  const doc = await load(dir);
  const s = doc?.steps.find((x) => String(x.id) === stepId);
  if (!s) return null;
  const cap = (v) => {
    const t = JSON.stringify(v);
    return t && t.length > DETAIL_MAX ? { truncated: true, text: t.slice(0, DETAIL_MAX) } : v;
  };
  const inp = json(s.input) ?? {};
  return { id: String(s.id), model: s.model_id ?? null, provider: s.provider ?? null, input: cap(inp), output: cap(json(s.output)), usage: json(s.usage), error: s.error ?? null };
}
