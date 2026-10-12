// Test trùng và test nên tách / gộp, tìm từ report của run mới nhất. Chỉ phát hiện và soạn prompt cho Claude Code:
// dashboard không tự sửa hay xoá mã test (việc đó cần người đọc diff). Heuristic, không phải chứng minh.
const SPLIT_STEPS = 15; // test dài hơn ngưỡng này và có nhiều lần đổi trang: đề nghị tách
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const titleOf = (r) => (Array.isArray(r.titlePath) ? r.titlePath.join(' › ') : String(r.testId ?? r.id));
const stepsOf = (r) => (r.attempts ?? [])[0]?.steps ?? [];

// The newest run that has test results to analyse (an empty or explore run has none). history: newest first.
export function latestWithResults(history) {
  return history.find((h) => h.meta.kind !== 'explore' && (h.report?.run?.results ?? []).length) ?? null;
}

// The behaviour of a test: its steps in order (action + label). Typed values are not part of it.
export function stepSignature(r) {
  return stepsOf(r).map((s) => `${s.api ?? ''}:${norm(s.label)}`).join('|');
}

const member = (r) => ({ testId: r.testId, file: r.file ?? r.source?.file ?? '', line: r.source?.line ?? null, title: titleOf(r), target: r.targetId, status: r.status });

// Groups of distinct tests (by testId, so one test on several targets is not a duplicate of itself).
export function findDuplicates(report) {
  const results = report.run.results ?? [];
  const groups = [];
  const byTitle = new Map();
  const bySteps = new Map();
  for (const r of results) {
    const t = norm(titleOf(r));
    if (t) byTitle.set(t, [...(byTitle.get(t) ?? []), r]);
    const sig = stepSignature(r);
    if (sig.split('|').length >= 2) bySteps.set(sig, [...(bySteps.get(sig) ?? []), r]);
  }
  const oneEach = (rs) => [...new Map(rs.map((r) => [r.testId, r])).values()]; // one row per test, its targets are not repeated
  const distinct = (rs) => oneEach(rs).length >= 2;
  for (const [t, rs] of byTitle) {
    if (distinct(rs)) groups.push({ kind: 'same-title', key: `title:${t}`, why: `cùng tên "${titleOf(rs[0])}"`, members: oneEach(rs).map(member) });
  }
  for (const [sig, rs] of bySteps) {
    if (distinct(rs)) groups.push({ kind: 'same-steps', key: `steps:${sig.slice(0, 80)}`, why: `${stepsOf(rs[0]).length} bước giống hệt nhau`, members: oneEach(rs).map(member) });
  }
  return groups;
}

// Long tests that walk through several pages: split candidates, with the navigation points that would cut them.
export function splitCandidates(report) {
  const out = [];
  for (const r of report.run.results ?? []) {
    const steps = stepsOf(r);
    if (steps.length < SPLIT_STEPS) continue;
    const navs = steps.flatMap((s, i) => (s.events ?? []).filter((e) => e.kind === 'navigation').map(() => i));
    if (navs.length < 2) continue;
    out.push({ kind: 'split', key: `split:${r.testId}`, why: `${steps.length} bước, ${navs.length} lần chuyển trang`, members: [member(r)], cuts: [...new Set(navs)].map((i) => ({ step: i + 1, label: steps[i]?.label ?? steps[i]?.api ?? '' })) });
  }
  return out;
}

// The prompt that makes Claude Code do the change, with the evidence in it. The result is reviewed by a person.
export function actionPrompt(group) {
  const list = group.members.map((m) => `- ${m.title} · \`${m.file}${m.line ? `:${m.line}` : ''}\` · target ${m.target}`).join('\n');
  if (group.kind === 'split') {
    return `Tách test dài sau thành các test nhỏ, mỗi test một luồng nghiệp vụ, không đổi hành vi đã kiểm tra.

Test: ${group.members[0].title} (\`${group.members[0].file}\`)
Điểm có thể cắt (sau bước số):
${group.cuts.map((c) => `- bước ${c.step}: ${c.label}`).join('\n')}

Yêu cầu: giữ nguyên tên gốc cho phần đầu, đặt tên mới cho từng phần, không xoá assertion nào. Chạy lại các test liên quan rồi trình bày diff để tôi duyệt trước khi commit.`;
  }
  const verb = group.kind === 'same-title' ? 'trùng tên' : 'có các bước giống hệt nhau';
  return `Các test sau ${verb} (${group.why}):
${list}

Hãy gộp chúng thành một test: giữ bản đầy đủ assertion nhất, chuyển các assertion còn thiếu từ bản khác sang, rồi xoá các bản còn lại. Chạy lại test đã gộp, và trình bày diff để tôi duyệt trước khi commit. Không xoá gì nếu các test thực ra kiểm tra hành vi khác nhau: nói rõ lý do.`;
}
