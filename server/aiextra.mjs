// Tính năng AI thêm: tóm tắt run tự động, giải thích nhóm lỗi, vì sao run chậm / tốn token, triage gợi ý.
// Ở đây chỉ soạn bằng chứng (mảng dòng) và đọc kết quả; prompt ở ai.mjs, mọi bằng chứng nằm trong khối dữ liệu không tin cậy.
import { buildPrompt, cacheKey } from './ai.mjs';
import { getAi, writeAi, loadHistory } from './store.mjs';
import { groupErrors, compareRuns } from './analytics.mjs';
import { resultAttempts } from '../reporter/e2e-dashboard.reporter.mjs';
import { TRIAGE_STATUSES } from './triage.mjs';

const NOT_PASS = (r) => r.status !== 'passed' && r.status !== 'skipped';
const tTitle = (r) => (Array.isArray(r.titlePath) ? r.titlePath.join(' › ') : String(r.testId ?? r.id));
const tKey = (r) => `${r.testId}|${r.targetId}|${r.agent ?? 'default'}`;
const firstLine = (e) => String(e?.message ?? '').split('\n')[0].slice(0, 300);
const results = (report) => (report?.run?.results ?? []).filter((r) => r && r.kind !== 'setup');
const durationOf = (report, r) => resultAttempts(report, r).reduce((s, a) => s + (a.durationMs ?? 0), 0);
const stepsOf = (report, r) => resultAttempts(report, r).flatMap((a) => a.steps ?? []);
const tokensOf = (report, r) => stepsOf(report, r).flatMap((s) => s.events ?? []).filter((e) => e.kind === 'model').reduce((a, e) => a + (Number(e.inputTokens) || 0) + (Number(e.outputTokens) || 0), 0);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const ms = (v) => (v == null ? '—' : v < 1000 ? `${Math.round(v)}ms` : `${(v / 1000).toFixed(1)}s`);

// ---------------------------------------------------------------- tóm tắt run
export function runSummaryEvidence(history, runId) {
  const i = history.findIndex((h) => h.meta.runId === runId);
  if (i < 0) return null;
  const { meta, report } = history[i];
  const lines = [`Run ${meta.runId} · ${meta.status} · ${JSON.stringify(meta.summary ?? {})} · ${ms(meta.durationMs)}`];
  const prev = history[i + 1];
  if (prev) {
    const newly = compareRuns(prev, history[i]).rows.filter((x) => x.change === 'regressed').slice(0, 15);
    if (newly.length) lines.push('Mới đỏ so với run trước:', ...newly.map((x) => `- ${x.title ?? x.key}`));
  }
  lines.push('Các test không pass:');
  for (const r of results(report).filter(NOT_PASS).slice(0, 30)) lines.push(`- [${r.status}] ${tTitle(r)} (${r.source?.file ?? r.file ?? '?'}): ${firstLine(resultAttempts(report, r).at(-1)?.error) || '—'}`);
  return lines;
}

const summaries = new Map(); // runId -> 'pending' | 'error'
export const summaryState = (runId) => summaries.get(runId) ?? null;

// chạy sau khi run được lưu (main.mjs) nếu có test không pass; kết quả lưu cùng run như các phân tích AI khác
export async function summarizeRun({ projectRoot, ai, runId, language }) {
  const key = cacheKey('run-summary', runId);
  if (summaries.get(runId) === 'pending' || (await getAi(projectRoot, runId, key))) return;
  const history = await loadHistory(projectRoot, 31);
  const h = history.find((x) => x.meta.runId === runId);
  if (!h || !results(h.report).some(NOT_PASS)) return;
  summaries.set(runId, 'pending');
  let final = null;
  await ai.run({ prompt: buildPrompt('run-summary', { evidence: runSummaryEvidence(history, runId), language }), onEvent: (e) => {
    if (e.type === 'done' && !e.isError) final = e.result;
  } });
  if (final) {
    await writeAi(projectRoot, runId, key, { action: 'run-summary', resultId: null, markdown: final, createdAt: new Date().toISOString() });
    summaries.delete(runId);
  } else summaries.set(runId, 'error');
}

// ---------------------------------------------------------------- nhóm lỗi
export function groupEvidence(history, groupId) {
  const g = groupErrors(history).find((x) => x.id === groupId);
  if (!g) return null;
  const lines = [`Nhóm lỗi ${g.code ?? ''} (${g.category ?? 'không rõ loại'}): ${g.message}`, `${g.count} lần fail · ${g.tests.length} test · ${g.runs} run · từ ${g.firstSeen} đến ${g.lastSeen}`, 'Các test trong nhóm:'];
  const byRun = new Map(history.map((h) => [h.meta.runId, h.report]));
  for (const t of g.tests.slice(0, 12)) {
    const report = byRun.get(t.runId);
    const r = results(report).find((x) => x.id === t.resultId);
    const err = r ? resultAttempts(report, r).at(-1)?.error : null;
    lines.push(`- ${t.title} [${t.target}] · ${r?.source?.file ?? r?.file ?? '?'}:${r?.source?.line ?? '?'}${err?.stack ? `\n  ${String(err.stack).split('\n').slice(0, 4).join('\n  ')}` : ''}`);
  }
  return { lines, runId: g.latest?.runId ?? null };
}

// ---------------------------------------------------------------- vì sao chậm / tốn token
export function whySlowEvidence(history, runId) {
  const i = history.findIndex((h) => h.meta.runId === runId);
  if (i < 0) return null;
  const { meta, report } = history[i];
  const past = history.slice(i + 1, i + 11);
  const tok = (m) => (m.tokens?.input ?? 0) + (m.tokens?.output ?? 0);
  const lines = [`Run ${meta.runId}: ${ms(meta.durationMs)} (TB ${past.length} run trước: ${ms(avg(past.map((h) => h.meta.durationMs ?? 0)))}) · token ${tok(meta)} (TB ${Math.round(avg(past.map((h) => tok(h.meta))) ?? 0)})`];
  const hist = new Map();
  for (const h of past) for (const r of results(h.report)) {
    const k = tKey(r);
    if (!hist.has(k)) hist.set(k, { d: [], t: [] });
    hist.get(k).d.push(durationOf(h.report, r));
    hist.get(k).t.push(tokensOf(h.report, r));
  }
  const rows = results(report).map((r) => {
    const p = hist.get(tKey(r));
    const d = durationOf(report, r);
    const t = tokensOf(report, r);
    const steps = stepsOf(report, r);
    // agent.act không chạy lại được từ cache (self-finalized = replay xong không gọi model)
    const misses = steps.filter((s) => s.api === 'agent.act' && s.cache?.mode !== 'self-finalized').length;
    return { r, d, t, dAvg: p ? avg(p.d) : null, tAvg: p ? avg(p.t) : null, misses, steps };
  });
  const delta = (x) => (x.d - (x.dAvg ?? x.d)) + (x.t - (x.tAvg ?? x.t)) * 5; // ponytail: 1 token ≈ 5ms để xếp hạng chung
  lines.push('Test lệch nhiều nhất so với chính nó (thời gian / token, TB lịch sử):');
  for (const x of [...rows].sort((a, b) => delta(b) - delta(a)).slice(0, 10)) {
    const slowStep = [...x.steps].sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))[0];
    lines.push(`- ${tTitle(x.r)} [${x.r.status}]: ${ms(x.d)} (TB ${ms(x.dAvg)}) · ${x.t} token (TB ${x.tAvg == null ? 'mới' : Math.round(x.tAvg)}) · ${x.misses} step không replay được${slowStep ? ` · step chậm nhất: ${slowStep.api} "${String(slowStep.label ?? '').slice(0, 120)}" ${ms(slowStep.durationMs)}${slowStep.cache ? ` cache=${slowStep.cache.mode ?? '?'}${slowStep.cache.reason ? ` (${slowStep.cache.reason})` : ''}` : ''}` : ''}`);
  }
  return lines;
}

// ---------------------------------------------------------------- triage gợi ý
export const triageEvidence = (rows) =>
  rows.slice(0, 30).map((r) => `fp=${r.fp} · ${r.title} [${r.target ?? '?'}] · file ${r.file ?? '?'} · trạng thái ${r.status}${r.reopened ? ` · mở lại ${r.reopened} lần` : ''} · owner: ${(r.owners ?? []).join(', ') || 'không có'} · lỗi: ${firstLine(r.error) || '—'}`);

const SEVERITY = ['high', 'medium', 'low'];
export function parseTriage(text, rows) {
  const byFp = new Map(rows.map((r) => [r.fp, r]));
  for (const l of String(text ?? '').trim().split('\n').reverse()) {
    const m = l.match(/\[.*\]/);
    if (!m) continue;
    try {
      const arr = JSON.parse(m[0]);
      if (!Array.isArray(arr)) continue;
      return arr
        .filter((x) => x && byFp.has(x.fp) && TRIAGE_STATUSES.includes(x.status))
        .map((x) => {
          const owners = byFp.get(x.fp).owners ?? [];
          return { fp: x.fp, status: x.status, severity: SEVERITY.includes(x.severity) ? x.severity : 'medium', assignee: typeof x.assignee === 'string' && (owners.includes(x.assignee) || /^@?[\w.-]{1,60}$/.test(x.assignee)) ? x.assignee : null, reason: String(x.reason ?? '').slice(0, 300) };
        });
    } catch {
      // dòng trước
    }
  }
  return [];
}

// ---------------------------------------------------------------- viết test từ ticket
// danh sách file test hiện có để AI tham khảo quy ước (đường dẫn thôi; AI tự Read)
export async function testFiles(root, limit = 60) {
  const { readdir } = await import('node:fs/promises');
  const { join: j, relative: rel } = await import('node:path');
  const out = [];
  const skip = new Set(['node_modules', '.git', '.e2e', '.e2e-dashboard', 'dist', 'build']);
  const walk = async (dir, depth) => {
    if (depth > 6 || out.length >= limit) return;
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (out.length >= limit) return;
      if (e.isDirectory() && !skip.has(e.name) && !e.name.startsWith('.')) await walk(j(dir, e.name), depth + 1);
      else if (e.isFile() && e.name.endsWith('.e2e.ts')) out.push(rel(root, j(dir, e.name)));
    }
  };
  await walk(root, 0);
  return out.sort();
}

export const ticketEvidence = (ticket, folder, files) => [
  'Ticket:', String(ticket).slice(0, 8000),
  folder ? `Thư mục đích người dùng chọn: ${folder}` : 'Thư mục đích: tự chọn theo bố cục hiện có',
  'File test hiện có (tham khảo quy ước):', ...files.map((f) => `- ${f}`),
];

// đường dẫn nháp hợp lệ: trong project, đuôi .e2e.ts, không .., không thư mục ẩn
export const DRAFT_PATH = /^(?!\/)(?!.*(?:^|\/)\.)(?!.*\.\.)[\w./ -]{1,200}\.e2e\.ts$/;

// ---------------------------------------------------------------- chọn test theo thay đổi
export function selectTestsEvidence(base, files, tests) {
  return [
    `So với nhánh ${base}, ${files.length} file đổi:`, ...files.slice(0, 200).map((f) => `- ${f}`),
    `Danh sách test (key · tiêu đề · file):`, ...tests.slice(0, 300).map((t) => `- ${t.key} · ${t.title} · ${t.file ?? '?'}`),
  ];
}

export function parseSelection(text, tests) {
  const keys = new Set(tests.map((t) => t.key));
  for (const l of String(text ?? '').trim().split('\n').reverse()) {
    const m = l.match(/\[.*\]/);
    if (!m) continue;
    try {
      const arr = JSON.parse(m[0]);
      if (Array.isArray(arr)) return arr.filter((x) => x && keys.has(x.key)).map((x) => ({ key: x.key, reason: String(x.reason ?? '').slice(0, 200) }));
    } catch {
      // dòng trước
    }
  }
  return [];
}

// ---------------------------------------------------------------- đổi agent.act sang locator hàng loạt
export const locatorBatchEvidence = (candidates) =>
  candidates.slice(0, 25).map((c) => `- ${c.title} [${c.target}] · ${c.source?.file ?? c.file ?? '?'}:${c.source?.line ?? '?'} · step "${String(c.label).slice(0, 160)}" · replay ${Math.round(c.stability * 100)}% của ${c.runs} run · ${c.tokensWhenLive ?? '?'} token khi gọi model${c.suggestion?.code ? `\n  gợi ý từ cache: ${String(c.suggestion.code).slice(0, 400).replace(/\n/g, '\n  ')}` : ''}`);

// ---------------------------------------------------------------- test trùng / thừa
export function duplicateEvidence(history) {
  const h = history[0];
  if (!h) return null;
  const lines = [`Run ${h.meta.runId}:`];
  for (const r of results(h.report).slice(0, 80)) {
    const steps = stepsOf(h.report, r).slice(0, 14).map((s) => `${s.api} ${String(s.label ?? '').slice(0, 80)}`).join(' → ');
    lines.push(`- ${tTitle(r)} [${r.targetId}] · ${r.source?.file ?? r.file ?? '?'} · ${ms(durationOf(h.report, r))} · ${tokensOf(h.report, r)} token\n  ${steps || '(không có step)'}`);
  }
  return lines;
}

// ---------------------------------------------------------------- ghi chú QA phát hành
export function releaseEvidence(rep) {
  if (!rep || rep.error) return null;
  const lines = [
    `Bản ${rep.to?.name ?? '?'}${rep.from ? ` (so với ${rep.from.name})` : ''} · ${rep.runs} run · ${rep.commits} commit · pass rate ${rep.passRate == null ? '—' : `${Math.round(rep.passRate * 100)}%`}`,
    `Đánh giá tự động: ${rep.verdict}${rep.reasons?.length ? ` (${rep.reasons.join('; ')})` : ''}`,
  ];
  const rows = rep.compare?.rows ?? [];
  if (rows.length) lines.push('Thay đổi kết quả so với bản trước:', ...rows.slice(0, 40).map((r) => `- [${r.change}] ${r.title ?? r.key}${r.b?.error ? `: ${String(r.b.error.message).split('\n')[0].slice(0, 160)}` : ''}`));
  if (rep.failing?.length) lines.push('Đang fail:', ...rep.failing.slice(0, 30).map((f) => `- ${f.title ?? f.key ?? f}`));
  if (rep.flaky?.length) lines.push('Flaky:', ...rep.flaky.map((f) => `- ${f.title} (điểm ${f.score})`));
  return lines;
}

// ---------------------------------------------------------------- so sánh ảnh
// bộ ảnh expected / actual / diff của một kết quả; trả đường dẫn tương đối project (AI đọc bằng Read)
export function visualEvidence(report, resultId, runDirRel, name = null) {
  const r = results(report).find((x) => x.id === resultId);
  if (!r) return null;
  const arts = resultAttempts(report, r).flatMap((a) => [...(a.artifacts ?? []), ...(a.steps ?? []).flatMap((s) => s.artifacts ?? [])]);
  const sets = new Map();
  for (const a of arts) {
    const m = /^(.*)-(expected|actual|diff)\.(png|jpe?g|webp)$/i.exec(a.path ?? '');
    if (!m || a.path.includes('..')) continue;
    if (!sets.has(m[1])) sets.set(m[1], {});
    sets.get(m[1])[m[2].toLowerCase()] = `${runDirRel}/artifacts/${a.path}`;
  }
  const pick = [...sets].find(([k, v]) => v.expected && v.actual && (!name || k.split('/').pop() === name));
  if (!pick) return null;
  const [k, v] = pick;
  return [`Test: ${tTitle(r)} [${r.targetId}] · ảnh ${k.split('/').pop()}`, `Ảnh mẫu (expected): ${v.expected}`, `Ảnh thực tế (actual): ${v.actual}`, v.diff ? `Ảnh diff: ${v.diff}` : 'Không có ảnh diff', `Lỗi: ${firstLine(resultAttempts(report, r).at(-1)?.error) || '—'}`];
}
