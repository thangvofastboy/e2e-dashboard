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
    // file đến từ run (repo, artifact CI): phần tử không phải object bị bỏ, không làm hỏng cả trang
    const obj = (x) => x && typeof x === 'object';
    last = { key, doc: Array.isArray(doc?.runs) && Array.isArray(doc?.steps) ? { runs: doc.runs.filter(obj), steps: doc.steps.filter(obj) } : null };
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
  const prompt = Array.isArray(inp.prompt) ? inp.prompt : [];
  const last = [...prompt].reverse().find((m) => m?.role === 'user' || m?.role === 'tool');
  const out = json(step.output) ?? {};
  const msgs = out.response?.messages;
  const outText = textOf(out.content) || textOf(Array.isArray(msgs) ? msgs.at(-1)?.content : null);
  return { prompt: clip(textOf(last?.content).replace(/\s+/g, ' ').trim(), PREVIEW), response: clip(outText.replace(/\s+/g, ' ').trim(), PREVIEW), finishReason: out.finishReason ?? null, messages: prompt.length, tools: Array.isArray(inp.tools) ? inp.tools.length : 0 };
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
    // the file comes from a run (a repo, a CI artifact): every field is coerced, so the page never receives markup in a number
    const str = (v, n = 200) => (v == null ? null : clip(String(v), n));
    runs.push({ id: String(r.id), name: str(r.function_id), startedAt: str(r.started_at, 40), scope: r.e2e ? { test: str(r.e2e.test), testId: str(r.e2e.testId), target: str(r.e2e.target, 80), agent: str(r.e2e.agent, 80), attempt: Number.isInteger(r.e2e.attempt) && r.e2e.attempt >= 0 ? r.e2e.attempt : 0, api: str(r.e2e.api, 80), label: str(r.e2e.label) } : null, calls });
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
