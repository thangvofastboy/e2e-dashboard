// Tự log bug: sau một run có test fail, với mỗi test fail do chính test (không phải hạ tầng) gây ra, AI soạn nội dung
// theo mẫu "bug-linear" rồi tạo issue Linear. Chống trùng theo fingerprint: đã có issue đang mở thì bỏ qua.
// Tắt mặc định: "ai": { "autoBugLog": true } trong ~/.e2e-dashboard/config.json (hoặc công tắc ở Cài đặt hệ thống).
import { basename } from 'node:path';
import { getRun } from './store.mjs';
import { issueDraft, createLinear, linearConfig, saveIssueLink, placeImages, acceptTitle, metaLine } from './linear.mjs';
import { readTemplates, findTemplate, resultVars, aiParts, keepFingerprint } from './qc-templates.mjs';
import { buildPrompt } from './ai.mjs';
import { SECRET } from './feedback.mjs';
import { readNotes, errorOf, markKnown } from './qc.mjs';
import { testKey } from './analytics.mjs';
import { commentIfNewBug, signatureOf } from './knownbug.mjs';

export const AUTO_BUG_LIMIT = 5;
// A run can be archived twice (reporter and watcher): the second pass must not look at Linear again.
const handled = new Set();
const HANDLED_MAX = 100;
const FAILED = new Set(['failed', 'timed-out']);

// Only failures the app or its test is responsible for: infrastructure / configuration errors are not bugs to file.
export function bugCandidates(report) {
  return (report.run.results ?? []).filter((r) => FAILED.has(r.status) && (errorOf(r)?.category ?? 'test') === 'test');
}

// Prompt text of one bug, through the template; the AI reply must keep the draft's fingerprint line.
async function describe({ ai, template, vars, fingerprintLine, fallback }) {
  if (!ai || !template) return { description: fallback, aiUsed: false };
  // nội dung này được đăng lên Linear mà không ai duyệt: dữ liệu từ app đi qua khối không tin cậy, AI không có công cụ nào
  const { instructions, evidence } = aiParts(template, vars);
  let final = null;
  try {
    await ai.run({ prompt: buildPrompt('qc-template', { instructions, evidence }), onEvent: (e) => { if (e.type === 'done' && !e.isError) final = e.result; } });
  } catch {
    return { description: fallback, aiUsed: false };
  }
  if (!final || SECRET.test(final)) return { description: fallback, aiUsed: false }; // rỗng, hoặc có dạng token / khoá: dùng bản nháp tất định
  const text = keepFingerprint(final.trim().replace(/^```(?:markdown|md)?\n([\s\S]*)\n```$/, '$1'), fingerprintLine);
  return { description: text, aiUsed: true };
}

// Creates Linear issues for the failing tests of one run. Returns one row per candidate (created, duplicate, error).
export async function autoLogBugs({ projectRoot, runId, ai = null, env = process.env, cfg = {}, makeLinear = createLinear, linear = null, resolve = null, limit = AUTO_BUG_LIMIT }) {
  const handledKey = `${projectRoot}:${runId}`;
  if (handled.has(handledKey)) return { status: 'already-handled', rows: [] };
  // đánh dấu ngay, trước mọi await: reporter và watcher archive gần như cùng lúc, cả hai không được cùng qua đây
  // (cả hai cùng find() chưa thấy issue rồi cùng tạo = issue trùng). Không xử lý được thì bỏ dấu để lần sau thử lại.
  handled.add(handledKey);
  if (handled.size > HANDLED_MAX) handled.delete(handled.values().next().value);
  const give = (status) => (handled.delete(handledKey), { status, rows: [] });
  let run, candidates, client;
  try {
    run = await getRun(projectRoot, runId);
    if (!run) return give('no-run');
    candidates = bugCandidates(run.report);
    if (!candidates.length) return give('no-candidates');
    // resolve(): API key nếu có, không thì MCP Linear (server/linear-mcp.mjs); không truyền thì chỉ dùng API key
    const backend = linear || !resolve ? null : await resolve();
    const { apiKey, team } = backend ? { apiKey: null, team: backend.team } : await linearConfig(cfg, env);
    client = linear ?? backend?.client ?? (apiKey ? makeLinear({ apiKey, team }) : null);
    if (!client) return give('no-key');
  } catch (e) {
    give();
    throw e;
  }
  const templates = await readTemplates(projectRoot);
  const template = findTemplate(templates, 'bug-linear');
  const notes = await readNotes(projectRoot);
  const rows = [];
  for (const r of candidates.slice(0, limit)) {
    const draft = issueDraft({ meta: run.meta, report: run.report, resultId: r.id, commits: [], analysis: null, project: basename(projectRoot), owners: [] });
    try {
      // test đã là known bug: lỗi khác lỗi đã biết thì comment vào issue đó, không mở issue thứ hai
      if (notes[testKey(r)]?.known) {
        const c = await commentIfNewBug({ projectRoot, run, result: r, linear: client, notes });
        if (c.status === 'commented' || c.status === 'same-bug') {
          rows.push({ resultId: r.id, status: c.status === 'commented' ? 'commented' : 'known', issue: c.issue });
          continue;
        }
        // issue đã xoá hoặc đã đóng: xử lý như lỗi mới bên dưới
      }
      const found = await client.find(draft.fingerprint);
      if (found.open) {
        await markKnown(projectRoot, r, found.open, signatureOf(run.report, r));
        rows.push({ resultId: r.id, status: 'duplicate', issue: found.open.identifier ?? found.open.id });
        continue;
      }
      const n = notes[testKey(r)] ?? {};
      const vars = resultVars(run, r.id, n.note || null, n.known || null);
      const fpLine = draft.description.split('\n').filter((l) => l.includes('fingerprint:')).pop() ?? '';
      const { description: written, aiUsed } = await describe({ ai, template, vars, fingerprintLine: fpLine, fallback: draft.description });
      const old = found.closed[0];
      const described = placeImages(written, [], draft.images); // ảnh không tải tự động: thay bằng ghi chú
      const typed = `${metaLine({ type: 'bug', relatedId: null })}\n\n${described}`; // loại ghi trong mô tả, cả khi team không có label Bug
      const issue = await client.create({ ...draft, type: 'bug', title: acceptTitle(draft, draft.title), description: old ? `Tái phát của ${old.identifier} (đã đóng).\n\n${typed}` : typed });
      await saveIssueLink(projectRoot, draft.fingerprint, issue);
      await markKnown(projectRoot, r, issue, signatureOf(run.report, r));
      rows.push({ resultId: r.id, status: 'created', issue: issue.identifier ?? issue.id, aiUsed, reopenedFrom: old?.identifier ?? null });
    } catch (e) {
      rows.push({ resultId: r.id, status: 'error', error: String(e.message ?? e).slice(0, 300) });
    }
  }
  return { status: 'done', rows };
}
