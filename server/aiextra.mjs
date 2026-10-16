// Tính năng AI thêm: tóm tắt run tự động, giải thích nhóm lỗi, vì sao run chậm / tốn token, triage gợi ý.
// Ở đây chỉ soạn bằng chứng (mảng dòng) và đọc kết quả; prompt ở ai.mjs, mọi bằng chứng nằm trong khối dữ liệu không tin cậy.
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { buildPrompt, cacheKey } from './ai.mjs';
import { getAi, writeAi, loadHistory } from './store.mjs';
import { groupErrors, compareRuns } from './analytics.mjs';
import { resultAttempts, isLink } from '../reporter/e2e-dashboard.reporter.mjs';
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

// Các test fail của một run, mỗi test một dòng (tên, file, mã lỗi, dòng đầu thông báo): bằng chứng để gom bug trùng.
export function failuresEvidence(report, limit = 40) {
  return results(report).filter(NOT_PASS).slice(0, limit).map((r) => {
    const e = resultAttempts(report, r).at(-1)?.error;
    return `- ${tTitle(r)} (${String(r.source?.file ?? r.file ?? '').slice(0, 200)}:${r.source?.line ?? '?'}) [${r.status}] ${e?.code ?? 'ERROR'}: ${firstLine(e) || '—'}`;
  });
}

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

// ---------------------------------------------------------------- file test .ts chưa chạy được bằng e2e
// File .ts / .mts có khai báo test nhưng không phải *.e2e.ts (vd. Playwright *.spec.ts): runner e2e không nhận.
// AI viết lại từng file thành <tên>.e2e.ts bên cạnh; file gốc giữ nguyên.
const TEST_DECL = /^[ \t]*test(?:\.(?:describe|only|skip|fixme))*(?:\.(?:serial|parallel|only|skip))?\s*\(/m;
const TEST_CASE = /^[ \t]*test(?:\.(?:only|skip|fixme))?\s*\(/gm;
export const e2eTarget = (rel) => rel.replace(/(?:\.(?:spec|test))?\.m?ts$/, '.e2e.ts');
const CONVERT_SKIP = new Set(['node_modules', '.git', '.e2e', '.e2e-dashboard', 'dist', 'build']);
const CONVERT_NAME = (name) => /\.m?ts$/.test(name) && !/\.(?:e2e|d)\.m?ts$/.test(name) && !/^(?:playwright|e2e)\.config\./.test(name);
// một file (đường dẫn tương đối, '/'): mục của danh sách, hoặc null khi không phải file test Playwright / e2e đặt sai tên
async function convertibleFile(root, path) {
  const { readFile, stat } = await import('node:fs/promises');
  const full = join(root, path);
  if ((await stat(full).catch(() => null))?.size > 300_000) return null;
  const src = await readFile(full, 'utf8').catch(() => '');
  // chỉ test Playwright / e2e đặt sai tên: unit test vitest / jest (*.test.ts) không phải việc của runner e2e
  const runner = /from\s+['"]@playwright\/test['"]/.test(src) ? 'playwright' : /from\s+['"](?:e2e|@e2e-dev\/\w+)['"]/.test(src) ? 'e2e' : null;
  if (!runner || !TEST_DECL.test(src)) return null;
  const target = e2eTarget(path);
  return { path, target, converted: existsSync(join(root, target)), runner, tests: (src.match(TEST_CASE) ?? []).length };
}
export async function convertibleTests(root, limit = 500) {
  const { readdir } = await import('node:fs/promises');
  const { relative: rel } = await import('node:path');
  const out = [];
  const walk = async (dir, depth) => {
    if (depth > 8 || out.length >= limit) return;
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (out.length >= limit) return;
      const full = join(dir, e.name);
      if (e.isDirectory() && !CONVERT_SKIP.has(e.name) && !e.name.startsWith('.')) await walk(full, depth + 1);
      else if (e.isFile() && CONVERT_NAME(e.name)) {
        const f = await convertibleFile(root, rel(root, full).split('\\').join('/'));
        if (f) out.push(f);
      }
    }
  };
  await walk(root, 0);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
// kiểm tra một đường dẫn người dùng gửi (nút AI chuyển) theo đúng luật quét, không quét lại cả project
export async function convertibleTest(root, path) {
  if (typeof path !== 'string' || path.length > 500 || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return null;
  const segs = path.split('/');
  if (segs.length > 9 || segs.some((x) => !x || x === '..' || x.startsWith('.') || CONVERT_SKIP.has(x)) || !CONVERT_NAME(segs.at(-1))) return null;
  // không đi qua symlink (như readdir của convertibleTests): mọi thư mục là thư mục thật, file là file thật
  const { lstat } = await import('node:fs/promises');
  for (let i = 1; i <= segs.length; i++) {
    const st = await lstat(join(root, ...segs.slice(0, i))).catch(() => null);
    if (!st || (i < segs.length ? !st.isDirectory() : !st.isFile())) return null;
  }
  return convertibleFile(root, path);
}

export async function convertEvidence(root, file) {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(join(root, file.path), 'utf8');
  return [
    `File gốc: ${file.path} (runner: ${file.runner}, ${file.tests} test)`,
    `File đích: ${file.target}`,
    'File .e2e.ts hiện có (tham khảo quy ước):', ...(await testFiles(root, 20)).map((f) => `- ${f}`),
    `Nội dung file gốc${src.length > 60_000 ? ' (đã cắt, đọc đủ bằng Read)' : ''}:`, src.slice(0, 60_000),
  ];
}

// đường dẫn nháp hợp lệ: trong project, đuôi .e2e.ts, không .., không thư mục ẩn
export const DRAFT_PATH = /^(?!\/)(?!.*(?:^|\/)\.)(?!.*\.\.)[\w./ -]{1,200}\.e2e\.ts$/;

// Ghi file test mới trong project: đuôi .e2e.ts, không ghi đè, không đi qua symlink. Lỗi có status 400 / 409.
export async function writeNewTest(root, rel, content) {
  const fail = (status, error) => Object.assign(new Error(error), { status });
  if (!DRAFT_PATH.test(rel) || typeof content !== 'string' || !content.trim() || content.length > 200_000) throw fail(400, 'Đường dẫn phải là file .e2e.ts trong project (không có .., không thư mục ẩn)');
  const full = join(root, rel);
  if (existsSync(full)) throw fail(409, `${rel} đã tồn tại: đổi tên rồi lưu lại`);
  const parts = rel.split('/');
  for (let i = 1; i < parts.length; i++) if (isLink(join(root, ...parts.slice(0, i)))) throw fail(400, 'Thư mục đích là symlink');
  await mkdir(dirname(full), { recursive: true });
  // hai lần Gen đồng thời cùng qua existsSync: lần thua nhận EEXIST từ 'wx', báo 409 như trường hợp đã có file
  await writeFile(full, content.endsWith('\n') ? content : `${content}\n`, { flag: 'wx' }).catch((e) => {
    throw e.code === 'EEXIST' ? fail(409, `${rel} đã tồn tại: đổi tên rồi lưu lại`) : e;
  });
  return { saved: rel };
}

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

// ---------------------------------------------------------------- chia nhỏ test quá lớn
// "lớn" = nhiều step hoặc chạy lâu ở lần chạy gần nhất có nó (trong history). key: chỉ một test (trang chi tiết test).
// ponytail: ngưỡng cố định (≥ 15 step hoặc ≥ 60s), chỉnh ở đây nếu suite có nhịp khác
export const SPLIT_MIN_STEPS = 15;
export const SPLIT_MIN_MS = 60_000;
export function splitEvidence(history, key = null) {
  const seen = new Map(); // key → kết quả mới nhất (history mới → cũ)
  for (const h of history) {
    for (const r of results(h.report)) {
      if (r.status === 'skipped' || seen.has(tKey(r)) || (key && tKey(r) !== key)) continue;
      const steps = stepsOf(h.report, r);
      if (steps.length) seen.set(tKey(r), { h, r, steps, ms: durationOf(h.report, r) });
    }
  }
  const big = [...seen.values()]
    .filter((x) => key || x.steps.length >= SPLIT_MIN_STEPS || x.ms >= SPLIT_MIN_MS)
    .sort((a, b) => b.steps.length - a.steps.length || b.ms - a.ms)
    .slice(0, 10);
  if (!big.length) return null;
  const lines = [key ? 'Test cần chia nhỏ:' : `${big.length} test lớn nhất (≥ ${SPLIT_MIN_STEPS} step hoặc ≥ ${ms(SPLIT_MIN_MS)}):`];
  for (const { h, r, steps, ms: d } of big) {
    const file = r.source?.file ?? r.file ?? '?';
    lines.push(`- ${tTitle(r)} [${r.targetId}] · ${file}${r.source?.line ? `:${r.source.line}` : ''} · ${steps.length} step · ${ms(d)} · ${r.status} (run ${h.meta.runId})`);
    lines.push(...steps.slice(0, 60).map((s, i) => `  ${i + 1}. ${s.api} ${String(s.label ?? '').slice(0, 100)}${s.status && s.status !== 'passed' ? ` [${s.status}]` : ''}`));
    if (steps.length > 60) lines.push(`  … còn ${steps.length - 60} step`);
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

// ---------------------------------------------------------------- AI hỗ trợ QC: độ phủ yêu cầu, charter khám phá, dữ liệu test, bug trùng
export const reqCoverageEvidence = (ticket, tests) => [
  'Yêu cầu / acceptance criteria:', String(ticket).slice(0, 8000),
  'Test e2e hiện có (key · tiêu đề · file):', ...tests.slice(0, 400).map((t) => `- ${t.key} · ${t.title} · ${t.file ?? '?'}`),
];
export const charterEvidence = (base, files) => [`So với nhánh ${base}, ${files.length} file đổi:`, ...files.slice(0, 200).map((f) => `- ${f}`)];
export const testDataEvidence = (spec) => ['Mô tả form / field / API cần dữ liệu test:', String(spec).slice(0, 8000)];
export const bugDupeEvidence = (bug, groups) => [
  'Bug định log:', String(bug).slice(0, 8000),
  'Lỗi đã gặp trong lịch sử test (nhóm lỗi):', ...(groups.length ? groups.slice(0, 40).map((g) => `- ${g.code}: ${String(g.message).slice(0, 200)} (${g.tests.length} test, ${g.count} lần, gần nhất ${g.lastSeen})`) : ['(chưa có)']),
];
