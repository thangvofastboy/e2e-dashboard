// Chất lượng test: chấm điểm từng test theo dữ liệu có sẵn trong report (cấu trúc, ổn định, chi phí, thời gian).
// Heuristic để QC biết test nào nên xem lại; không thay được việc đọc test. Điểm 100 = không có vấn đề nào được phát hiện.
import { testKey, flakyTests } from './analytics.mjs';
import { findDuplicates, splitCandidates, latestWithResults } from './dupes.mjs';

const ASSERT = /^(expect|agent\.assert|agent\.waitFor|assert)/;
const LONG_MS = 60_000;
const LONG_STEPS = 15;
const titleOf = (r) => (Array.isArray(r.titlePath) ? r.titlePath.join(' › ') : String(r.testId ?? r.id));
const stepsOf = (r) => (r.attempts ?? [])[0]?.steps ?? [];

// Each check gives { id, penalty, text }; the score is 100 minus the penalties, floored at 0.
export function checksFor(r, { flaky = null, dupes = new Set(), split = new Set() } = {}) {
  const steps = stepsOf(r);
  const out = [];
  if (r.status !== 'skipped' && !steps.some((s) => ASSERT.test(s.api ?? ''))) out.push({ id: 'no-assert', penalty: 30, text: 'Không có bước kiểm tra nào: test có thể pass mà không chứng minh gì' });
  if (steps.some((s) => !String(s.label ?? '').trim())) out.push({ id: 'unlabeled-step', penalty: 5, text: 'Có bước không có mô tả, khó đọc khi fail' });
  const acts = steps.filter((s) => s.api === 'agent.act').length;
  if (acts && acts === steps.length) out.push({ id: 'agent-only', penalty: 5, text: 'Mọi bước đều do agent điều khiển: chậm và tốn model hơn locator cố định' });
  const modelCalls = steps.reduce((n, s) => n + (s.metrics?.modelCalls ?? 0), 0);
  if (modelCalls >= 10) out.push({ id: 'model-heavy', penalty: 10, text: `${modelCalls} lần gọi model trong một lần chạy` });
  const dur = (r.attempts ?? []).at(-1)?.durationMs ?? 0;
  if (dur > LONG_MS) out.push({ id: 'slow', penalty: 5, text: `Chạy ${Math.round(dur / 1000)} giây` });
  if (steps.length > LONG_STEPS) out.push({ id: 'long', penalty: 5, text: `${steps.length} bước: cân nhắc tách` });
  if (flaky != null && flaky >= 0.1) out.push({ id: 'flaky', penalty: Math.round(Math.min(40, flaky * 100)), text: `Không ổn định: ${Math.round(flaky * 100)}% điểm flaky trong lịch sử` });
  if (dupes.has(r.testId)) out.push({ id: 'duplicate', penalty: 10, text: 'Trùng với test khác (xem mục Test trùng)' });
  if (split.has(r.testId)) out.push({ id: 'split', penalty: 5, text: 'Đề nghị tách thành nhiều test' });
  return out;
}

// history: newest first. Rows for the newest run, worst first.
export function analyzeQuality(history) {
  const latest = latestWithResults(history);
  if (!latest) return { runId: null, rows: [] };
  const flaky = new Map(flakyTests(history).map((f) => [f.key, f.score]));
  const dupes = new Set(findDuplicates(latest.report).flatMap((g) => g.members.map((m) => m.testId)));
  const split = new Set(splitCandidates(latest.report).map((g) => g.members[0].testId));
  const rows = (latest.report.run.results ?? []).filter((r) => r.selected !== false).map((r) => {
    const checks = checksFor(r, { flaky: flaky.get(testKey(r)) ?? null, dupes, split });
    const score = Math.max(0, 100 - checks.reduce((s, c) => s + c.penalty, 0));
    return { key: testKey(r), testId: r.testId, title: titleOf(r), file: r.file ?? '', target: r.targetId, status: r.status, score, grade: score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D', checks };
  });
  rows.sort((a, b) => a.score - b.score || a.title.localeCompare(b.title));
  return { runId: latest.meta.runId, rows };
}
