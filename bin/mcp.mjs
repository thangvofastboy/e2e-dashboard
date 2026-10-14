#!/usr/bin/env node
// MCP server (stdio, JSON-RPC, no dependencies): lets Claude Code ask about the e2e history of the
// project it is working in, without opening the dashboard. Đọc lịch sử là chính; hai tool chạy / dừng
// test đi qua server dashboard đang chạy (cùng API với nút Chạy trên giao diện), không tự spawn e2e.
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { readServerInfo } from '../reporter/e2e-dashboard.reporter.mjs';
import { findProjectRoot } from './project.mjs';
import { loadHistory, listRuns, getRun } from '../server/store.mjs';
import { flakyTests, groupErrors, compareRuns, testKey, routeMap } from '../server/analytics.mjs';
import { runGate } from '../server/gate.mjs';
import { appRoutes, coverageGaps } from '../server/coverage.mjs';
import { search, testDetail, appErrors } from '../server/insights.mjs';
import { buildDigest, flakyShare } from '../server/digest.mjs';
import { healthScore, passRate } from '../ui/health.js';
import { resultAttempts, readConfig } from '../reporter/e2e-dashboard.reporter.mjs';
import { syncLongterm, readDays, daySeries, totals, reliability } from '../server/longterm.mjs';
import { syncTriage, triageBoard } from '../server/triage.mjs';
import { groupReport } from '../server/groups.mjs';
import { buildReport } from '../server/reports.mjs';
import { reportMarkdown } from '../server/report-html.mjs';
import { readCodeowners, ownersOf } from '../server/owners.mjs';

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
  { name: 'e2e_trends', description: 'Xu hướng dài hạn (giữ cả khi run cũ đã bị xoá): pass rate theo tuần, MTTR, thời gian branch chính đỏ, test đang fail lâu nhất.', inputSchema: { type: 'object', properties: { days: { type: 'integer', description: 'Số ngày (mặc định 90, tối đa 730)' } } } },
  { name: 'e2e_triage', description: 'Danh sách lỗi đang cần xử lý: trạng thái (mới / đang xem / đã biết / đã sửa / bỏ qua), người phụ trách, ghi chú, issue Linear.', inputSchema: { type: 'object', properties: {} } },
  { name: 'e2e_groups', description: 'Bảng điểm theo module, tag hoặc owner (CODEOWNERS): pass rate, test đang fail, flaky.', inputSchema: { type: 'object', properties: { by: { type: 'string', enum: ['module', 'tag', 'owner'] } } } },
  { name: 'e2e_run_start', description: 'Chạy test e2e qua dashboard (cần dashboard đang chạy: /e2e-dashboard). Không truyền tests = chạy toàn bộ suite. Tiến độ hiện ở trang Live; kết quả vào Runs khi xong.', inputSchema: { type: 'object', properties: {
    tests: { type: 'array', items: { type: 'string' }, description: 'File hoặc file:line, vd ["tests/checkout.e2e.ts"] (để trống = cả suite)' },
    targets: { type: 'array', items: { type: 'string' } },
    browser: { type: 'string', enum: ['chromium', 'firefox', 'webkit'] },
    workers: { type: 'integer', description: 'Số worker song song (không truyền = mặc định ở Settings)' },
    headed: { type: 'boolean', description: 'Mở cửa sổ trình duyệt (không truyền = mặc định ở Settings)' },
    grep: { type: 'string' },
    tag: { type: 'array', items: { type: 'string' } },
  } } },
  { name: 'e2e_run_stop', description: 'Dừng run đang chạy trên dashboard (run chạy từ terminal chỉ được đánh dấu dừng).', inputSchema: { type: 'object', properties: {} } },
  { name: 'e2e_report', description: 'Báo cáo tuần hoặc tháng (Markdown) từ số liệu dài hạn, giống bản gửi tự động.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['week', 'month'] } } } },
];

// Gọi API của dashboard đang chạy cho project này (port + token trong .e2e-dashboard/server.json)
export async function dashboardCall(root, method, p, body) {
  const info = readServerInfo(root);
  if (!info) throw new Error('Dashboard chưa chạy cho project này: mở /e2e-dashboard trước.');
  const res = await fetch(`http://127.0.0.1:${info.port}${p}`, {
    method,
    headers: { 'x-e2e-dashboard-token': info.token, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const RUN_START_KEYS = ['tests', 'targets', 'browser', 'workers', 'headed', 'grep', 'tag'];

async function runTool(root, name, args = {}) {
  if (!root) return 'Không thấy project e2e (e2e.config.*) từ thư mục hiện tại.';
  if (name === 'e2e_run_start') {
    const body = Object.fromEntries(RUN_START_KEYS.filter((k) => args[k] !== undefined).map((k) => [k, args[k]]));
    body.tests ??= [];
    const { status, data } = await dashboardCall(root, 'POST', '/api/run', body);
    if (status === 202) return `Đã bắt đầu run${data.pid ? ` (pid ${data.pid})` : ''}. Xem tiến độ ở trang Live.`;
    return `Không chạy được (HTTP ${status}): ${data.error ?? 'lỗi không rõ'}`;
  }
  if (name === 'e2e_run_stop') {
    const { status, data } = await dashboardCall(root, 'POST', '/api/run/stop', {});
    if (status !== 200) return `Không dừng được (HTTP ${status}): ${data.error ?? 'lỗi không rõ'}`;
    return data.stopped ? 'Đã dừng run.' : 'Không có run nào đang chạy.';
  }
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
  if (name === 'e2e_trends') {
    const days = int(args.days, 90, 730);
    const { index } = await syncLongterm(root);
    const series = daySeries(await readDays(root, { from: Date.now() - (days - 1) * 86_400_000 }));
    const t = totals(series);
    const r = reliability(index, { days });
    const weeks = [];
    for (let i = 0; i < series.length; i += 7) {
      const w = totals(series.slice(i, i + 7));
      if (w.runs) weeks.push(`- tuần từ ${series[i].date}: ${pct(w.passRate)} · ${w.runs} run · ${w.failed} fail · ${w.flaky} flaky`);
    }
    return [`${days} ngày: pass rate ${pct(t.passRate)} · ${t.runs} run · ${t.flaky} kết quả flaky`, `MTTR: ${r.mttr.avgMs == null ? '—' : `${Math.round(r.mttr.avgMs / 3_600_000)} giờ`} (${r.mttr.count} lỗi đã sửa)${r.red ? ` · ${r.branch} đỏ ${Math.round(r.red.ms / 3_600_000)} giờ (${pct(r.red.share)})${r.red.now ? ', đang đỏ' : ''}` : ''}`, '', 'Đang fail:', ...(r.open.length ? r.open.slice(0, 10).map((o) => `- ${o.title} [${o.target}] từ ${o.since} (${o.runs} run)`) : ['- không có']), '', 'Theo tuần:', ...weeks].join('\n');
  }
  if (name === 'e2e_triage') {
    const { entries, failing } = await syncTriage(root, await loadHistory(root, 60));
    const b = triageBoard({ entries, failing });
    if (!b.rows.length) return 'Không có lỗi nào cần xử lý.';
    return b.rows.map((r) => `- [${r.status}] ${r.title} [${r.target ?? '?'}]${r.assignee ? ` · ${r.assignee}` : ''}${r.failingNow ? ` · fail ${r.streak} run từ ${r.since}` : ' · không còn fail'}${r.error ? ` · ${r.error.code}: ${r.error.message}` : ''}${r.note ? ` · ghi chú: ${r.note}` : ''}`).join('\n');
  }
  if (name === 'e2e_groups') {
    const { rules } = readCodeowners(root);
    const by = ['module', 'tag', 'owner'].includes(args.by) ? args.by : 'module';
    const g = groupReport(await loadHistory(root, 30), { by, modules: readConfig(root).modules, ownersOf: rules.length ? (f) => ownersOf(rules, f) : null });
    return g.rows.length ? g.rows.map((x) => `- ${x.grade} ${x.group}: ${x.tests} test · ${pct(x.passRate)} · ${x.failingNow.length} đang fail · ${x.flaky} flaky`).join('\n') : 'Chưa có dữ liệu.';
  }
  if (name === 'e2e_report') return reportMarkdown(await buildReport(root, { kind: args.kind === 'month' ? 'month' : 'week', calendar: false }));
  throw Object.assign(new Error(`unknown tool ${name}`), { code: -32602 });
}

// One JSON-RPC message in, at most one out (null for notifications).
export async function handleMessage(msg, root) {
  // `null`, `5`, `[]` là JSON hợp lệ: msg.id ném lỗi ngoài try → promise bị reject không ai bắt → tiến trình MCP chết
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } };
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
