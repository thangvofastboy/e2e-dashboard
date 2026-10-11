#!/usr/bin/env node
// MCP server (stdio, JSON-RPC, no dependencies): lets Claude Code ask about the e2e history of the
// project it is working in, without opening the dashboard. Read-only.
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { findProjectRoot } from './project.mjs';
import { loadHistory, listRuns, getRun } from '../server/store.mjs';
import { flakyTests, groupErrors, compareRuns, testKey, routeMap } from '../server/analytics.mjs';
import { runGate } from '../server/gate.mjs';
import { appRoutes, coverageGaps } from '../server/coverage.mjs';
import { search, testDetail, appErrors } from '../server/insights.mjs';
import { buildDigest, flakyShare } from '../server/digest.mjs';
import { healthScore, passRate } from '../ui/health.js';
import { resultAttempts, readConfig } from '../reporter/e2e-dashboard.reporter.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version;
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const secs = (ms) => (ms == null ? '—' : `${Math.round(ms / 1000)}s`);
const line = (m) => `${m.runId} · ${m.startedAt} · ${m.git?.branch ?? '?'}@${String(m.git?.commit ?? '').slice(0, 7)} · ${m.status} · pass ${m.summary?.passed ?? 0}, flaky ${m.summary?.flaky ?? 0}, fail ${m.summary?.failed ?? 0} · ${secs(m.durationMs)}`;
const int = (v, d, max) => (Number.isInteger(v) && v > 0 ? Math.min(v, max) : d);

export const TOOLS = [
  { name: 'e2e_runs', description: 'Danh sách các run e2e gần nhất của project (status, branch, commit, số pass/fail).', inputSchema: { type: 'object', properties: { limit: { type: 'integer', description: 'Số run (mặc định 10, tối đa 50)' } } } },
  { name: 'e2e_run', description: 'Chi tiết một run (mặc định run mới nhất): các test fail kèm lỗi, file:line, URL lúc fail, so với run trước.', inputSchema: { type: 'object', properties: { runId: { type: 'string' } } } },
  { name: 'e2e_test', description: 'Lịch sử một test qua các run: tìm theo tên hoặc file. Trả pass rate, các lần fail và lỗi.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Tên test, một phần tên, hoặc file' } }, required: ['query'] } },
  { name: 'e2e_flaky', description: 'Các test flaky (pass nhờ retry hoặc đổi kết quả giữa các run), xếp theo điểm.', inputSchema: { type: 'object', properties: { runs: { type: 'integer', description: 'Số run để phân tích (mặc định 30)' } } } },
  { name: 'e2e_errors', description: 'Nhóm lỗi: các test fail cùng một dạng lỗi, và lỗi phía app (console/network).', inputSchema: { type: 'object', properties: { runs: { type: 'integer' } } } },
  { name: 'e2e_search', description: 'Tìm trong lịch sử: tên test, mã lỗi, thông báo lỗi, URL, branch, commit, run id.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'e2e_health', description: 'Health score 0–100 của bộ test và các thành phần (pass rate, flaky, thời gian, token, cache).', inputSchema: { type: 'object', properties: {} } },
  { name: 'e2e_gate', description: 'Cổng chất lượng: có test mới fail không, health score, SLO, ngân sách token. Dùng trước khi merge/push.', inputSchema: { type: 'object', properties: { minHealth: { type: 'integer' }, maxNewFailures: { type: 'integer' } } } },
  { name: 'e2e_coverage', description: 'Các trang (route) của app chưa có test e2e nào đi qua.', inputSchema: { type: 'object', properties: {} } },
  { name: 'e2e_digest', description: 'Tóm tắt Markdown của N ngày gần nhất (mặc định 7): run, pass rate, test mới fail, flaky, nhóm lỗi.', inputSchema: { type: 'object', properties: { days: { type: 'integer' } } } },
];

async function runTool(root, name, args = {}) {
  if (!root) return 'Không thấy project e2e (e2e.config.*) từ thư mục hiện tại.';
  if (name === 'e2e_runs') {
    const metas = (await listRuns(root)).slice(0, int(args.limit, 10, 50));
    return metas.length ? metas.map(line).join('\n') : 'Chưa có run nào trong lịch sử (.e2e-dashboard/runs).';
  }
  if (name === 'e2e_run') {
    const metas = await listRuns(root);
    const id = typeof args.runId === 'string' && args.runId ? args.runId : metas[0]?.runId;
    const run = id && (await getRun(root, id));
    if (!run) return `Không thấy run ${id ?? ''}.`;
    const out = [line(run.meta)];
    const fails = (run.report.run.results ?? []).filter((r) => ['failed', 'timed-out', 'interrupted', 'flaky'].includes(r.status));
    out.push('', fails.length ? `Test không pass (${fails.length}):` : 'Mọi test đều pass.');
    for (const r of fails.slice(0, 40)) {
      const a = resultAttempts(run.report, r).at(-1);
      const e = a?.error;
      out.push(`- [${r.status}] ${(r.titlePath ?? []).join(' › ')} (${r.source?.file ?? r.file}:${r.source?.line ?? '?'}, ${r.targetId}) resultId=${r.id}`);
      if (e) out.push(`  ${e.code ?? 'ERROR'}: ${String(e.message ?? '').split('\n')[0].slice(0, 300)}${e.details?.locator ? ` · locator ${e.details.locator}` : ''}`);
      if (a?.failure?.url) out.push(`  URL lúc fail: ${a.failure.url}`);
    }
    const prev = metas[metas.findIndex((m) => m.runId === id) + 1];
    if (prev) {
      const c = compareRuns(await getRun(root, prev.runId), run);
      out.push('', `So với run trước (${prev.runId}): mới fail ${c.counts.regressed}, đã sửa ${c.counts.fixed}, vẫn fail ${c.counts['still-failing']}.`);
    }
    return out.join('\n');
  }
  if (name === 'e2e_test') {
    const history = await loadHistory(root, 60);
    const q = String(args.query ?? '').toLowerCase();
    const keys = [...new Set(history.flatMap((h) => (h.report.run.results ?? []).filter((r) => `${(r.titlePath ?? []).join(' › ')} ${r.source?.file ?? r.file}`.toLowerCase().includes(q)).map(testKey)))];
    if (!keys.length) return `Không có test nào khớp "${args.query}".`;
    const out = [];
    for (const k of keys.slice(0, 5)) {
      const d = testDetail(history, k);
      const done = d.runs.filter((r) => r.status !== 'skipped');
      const ok = done.filter((r) => !['failed', 'timed-out', 'interrupted'].includes(r.status)).length;
      out.push(`## ${d.title} (${d.file}:${d.line ?? '?'}, ${d.target})`, `Pass rate ${pct(done.length ? ok / done.length : null)} trên ${done.length} run · lịch sử (mới → cũ): ${d.runs.slice(0, 15).map((r) => r.status).join(', ')}`);
      for (const r of d.runs.filter((x) => x.error).slice(0, 5)) out.push(`- ${r.startedAt} ${r.branch ?? '?'}@${String(r.commit ?? '').slice(0, 7)}: ${r.error.code} ${r.error.message.split('\n')[0].slice(0, 200)}`);
      out.push('');
    }
    if (keys.length > 5) out.push(`…và ${keys.length - 5} test khác khớp.`);
    return out.join('\n');
  }
  if (name === 'e2e_flaky') {
    const f = flakyTests(await loadHistory(root, int(args.runs, 30, 200)));
    return f.length ? f.slice(0, 20).map((t) => `- ${t.title} [${t.target}] điểm ${Math.round(t.score * 100)} · flaky ${t.flaky} · đổi kết quả ${t.flips} (${t.sameCommitFlips} cùng commit) / ${t.runs} run · ${t.file}:${t.line ?? '?'}`).join('\n') : 'Không có test flaky.';
  }
  if (name === 'e2e_errors') {
    const history = await loadHistory(root, int(args.runs, 30, 200));
    const g = groupErrors(history).slice(0, 15).map((x) => `- ${x.code}: ${x.message.split('\n')[0].slice(0, 200)} · ${x.tests.length} test, ${x.count} lần · ví dụ: ${x.tests.slice(0, 3).map((t) => t.title).join('; ')}`);
    const a = appErrors(history).slice(0, 10).map((x) => `- [${x.source}/${x.level}] ${x.signature} · ${x.runs} run${x.failing ? `, ${x.failing} lần trong test fail` : ''}`);
    return [`Nhóm lỗi test:`, ...(g.length ? g : ['- (không có)']), '', 'Lỗi phía app:', ...(a.length ? a : ['- (không có)'])].join('\n');
  }
  if (name === 'e2e_search') {
    const hits = search(await loadHistory(root, 50), String(args.query ?? ''));
    return hits.length ? hits.slice(0, 25).map((h) => `- [${h.kind}] ${h.label} · ${h.sub}`).join('\n') : 'Không có kết quả.';
  }
  if (name === 'e2e_health') {
    const history = (await loadHistory(root, 30)).filter((h) => h.meta.kind !== 'explore').slice(0, 20);
    const h = healthScore(history.map((x) => x.meta), { flakyShare: flakyShare(history) });
    if (!h) return 'Chưa đủ dữ liệu để tính health score.';
    return [`Health score: ${h.score}/100 (${h.health})`, ...h.parts.map((p) => `- ${p.label}: ${p.score == null ? 'chưa có dữ liệu' : `${Math.round(p.score * 100)}/100`} (trọng số ${p.weight})`), `Pass rate run mới nhất: ${pct(passRate(history[0].meta))}`].join('\n');
  }
  if (name === 'e2e_gate') {
    const g = await runGate(root, Object.fromEntries(Object.entries({ minHealth: args.minHealth, maxNewFailures: args.maxNewFailures }).filter(([, v]) => Number.isFinite(v))));
    return [`${g.pass ? 'PASS' : 'FAIL'}${g.runId ? ` · run ${g.runId}` : ''}`, ...g.checks.map((c) => `- ${c.pass ? '✓' : '✗'} ${c.detail}${c.tests?.length ? `: ${c.tests.join('; ')}` : ''}`)].join('\n');
  }
  if (name === 'e2e_coverage') {
    const cfg = readConfig(root);
    const c = coverageGaps(await appRoutes(root, Array.isArray(cfg.coverage?.routes) ? cfg.coverage.routes : []), routeMap(await loadHistory(root, 30)), { ignore: Array.isArray(cfg.coverage?.ignore) ? cfg.coverage.ignore : [] });
    if (!c.total) return 'Không tìm thấy route nào của app (app/, pages/, src/routes, sitemap.xml hoặc path trong router). Thêm "coverage": { "routes": [...] } vào .e2e-dashboard/config.json.';
    return [`${c.covered}/${c.total} route có test đi qua (${pct(c.share)}).`, 'Chưa có test:', ...c.untested.map((r) => `- ${r.route} (${r.source})`)].join('\n');
  }
  if (name === 'e2e_digest') return (await buildDigest(root, { days: int(args.days, 7, 90) })).markdown;
  throw Object.assign(new Error(`unknown tool ${name}`), { code: -32602 });
}

// One JSON-RPC message in, at most one out (null for notifications).
export async function handleMessage(msg, root) {
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  if (msg.id === undefined) return null; // notifications/initialized and friends
  try {
    if (msg.method === 'initialize') return reply({ protocolVersion: msg.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'e2e-dashboard', version: VERSION } });
    if (msg.method === 'ping') return reply({});
    if (msg.method === 'tools/list') return reply({ tools: TOOLS });
    if (msg.method === 'tools/call') {
      const { name, arguments: args } = msg.params ?? {};
      if (!TOOLS.some((t) => t.name === name)) return { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `unknown tool ${name}` } };
      try {
        return reply({ content: [{ type: 'text', text: await runTool(root, name, args) }] });
      } catch (e) {
        return reply({ content: [{ type: 'text', text: `Lỗi: ${e.message}` }], isError: true });
      }
    }
    return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } };
  } catch (e) {
    return { jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = findProjectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const rl = createInterface({ input: process.stdin });
  rl.on('line', async (l) => {
    if (!l.trim()) return;
    let msg;
    try {
      msg = JSON.parse(l);
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })}\n`);
      return;
    }
    const out = await handleMessage(msg, root);
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
  });
}
