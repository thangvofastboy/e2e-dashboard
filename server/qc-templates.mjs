// Mẫu prompt QC: người dùng viết prompt với chỗ trống {{tên}}. Dashboard điền dữ liệu của một test hoặc một run,
// rồi hoặc chép prompt đi (dán vào Claude Code / Linear MCP), hoặc để AI (claude) viết luôn nội dung bug report,
// báo cáo, mô tả Linear. Mẫu lưu trong state/ của dashboard, không đụng repo.
import { readState, writeState, serial } from './jsonstate.mjs';
import { passRate } from '../ui/health.js';
import { bugReport, titleOf, errorOf, lastAttempt, buildKey } from './qc.mjs';
import { testKey } from './analytics.mjs';

const FILE = 'qc-templates.json';
const KINDS = ['linear', 'bug', 'report', 'custom'];
const FAILED = new Set(['failed', 'timed-out', 'interrupted']);
const clip = (s, n) => String(s ?? '').slice(0, n);

export const PLACEHOLDERS = {
  title: 'Tiêu đề test', file: 'File test', line: 'Dòng trong file', target: 'Target (web, ios…)', agent: 'Agent / persona',
  status: 'Trạng thái', errorCode: 'Mã lỗi', errorCategory: 'Loại lỗi (test, infrastructure…)', errorMessage: 'Thông báo lỗi',
  steps: 'Các bước đã chạy (đánh số)', build: 'Build (branch@commit)', branch: 'Branch', commit: 'Commit',
  runId: 'Mã run', startedAt: 'Thời điểm chạy', env: 'Môi trường (OS, arch, runtime)', attempts: 'Số attempt',
  note: 'Ghi chú QC', known: 'Mã known bug', evidence: 'Toàn bộ bug report (Markdown)',
  counts: 'Đếm kết quả của run', passRate: 'Pass rate của run', failures: 'Danh sách test fail của run', runErrors: 'Lỗi cấp run',
};

export const DEFAULTS = [
  {
    id: 'bug-linear', name: 'Bug report cho Linear', kind: 'linear',
    body: `Bạn là QC viết bug report cho Linear, tiếng Việt, Markdown, ngắn gọn.
Chỉ dùng dữ liệu bên dưới. Không bịa số liệu. Nếu thiếu thông tin thì ghi "Chưa rõ".

Viết mô tả issue gồm các mục:
1. **Tóm tắt**: một câu nêu lỗi và ảnh hưởng.
2. **Các bước tái hiện**: đánh số, lấy từ bước đã chạy.
3. **Kết quả thực tế**: lấy từ thông báo lỗi.
4. **Kết quả mong đợi**: suy ra từ tên test, ghi rõ đây là suy đoán.
5. **Môi trường và build**: {{build}}, {{env}}, target {{target}}.
6. **Mức độ đề xuất**: Thấp / Trung bình / Cao, kèm lý do ngắn.

Test: {{title}} ({{file}}:{{line}}), target {{target}}, trạng thái {{status}}.
Ghi chú QC: {{note}}

Dữ liệu:
{{evidence}}`,
  },
  {
    id: 'bug-short', name: 'Bug ngắn (chat / Slack)', kind: 'bug',
    body: `Viết một đoạn ngắn (tối đa 6 dòng) báo bug này cho dev, tiếng Việt: lỗi gì, tái hiện thế nào (1-3 bước), build nào.

Test {{title}} fail ở {{target}} trên build {{build}}.
Lỗi: {{errorCode}} — {{errorMessage}}
Các bước:
{{steps}}`,
  },
  {
    id: 'run-report', name: 'Báo cáo chạy test (run)', kind: 'report',
    body: `Viết báo cáo kết quả một lần chạy test cho QC lead, tiếng Việt, Markdown.

Gồm: kết luận có đạt không (1 câu), bảng số liệu, danh sách test fail kèm lỗi, và 2-3 việc nên làm tiếp theo.
Chỉ dùng số liệu bên dưới.

Run {{runId}} lúc {{startedAt}} trên build {{build}}, môi trường {{env}}.
Số liệu: {{counts}}
Pass rate: {{passRate}}
Test fail:
{{failures}}
Lỗi cấp run: {{runErrors}}`,
  },
];

export async function readTemplates(root) {
  const s = await readState(root, FILE, null);
  return Array.isArray(s) && s.length ? s : DEFAULTS.map((t) => ({ ...t }));
}

export function findTemplate(list, id) {
  return list.find((t) => t.id === id) ?? null;
}

// body: { id?, name, kind, body } saves one template (a new id when none); { delete: id }; { reset: true } restores the defaults.
export function saveTemplate(root, body = {}) {
  return serial(`${root}:qc-templates`, async () => {
    if (body.reset) {
      const fresh = DEFAULTS.map((t) => ({ ...t }));
      await writeState(root, FILE, fresh);
      return { templates: fresh };
    }
    const list = await readTemplates(root);
    if (body.delete) {
      const next = list.filter((t) => t.id !== clip(body.delete, 60));
      await writeState(root, FILE, next);
      return { templates: next };
    }
    const name = clip(body.name, 80).trim();
    if (!name) throw new Error('thiếu tên mẫu');
    const text = clip(body.body, 8000);
    if (text.trim().length < 10) throw new Error('nội dung mẫu cần ít nhất 10 ký tự');
    const kind = KINDS.includes(body.kind) ? body.kind : 'custom';
    const id = body.id ? clip(body.id, 60) : `t-${Date.now().toString(36)}`;
    const i = list.findIndex((t) => t.id === id);
    const item = { id, name, kind, body: text };
    const next = i >= 0 ? list.map((t, j) => (j === i ? item : t)) : [...list, item];
    if (next.length > 100) throw new Error('quá 100 mẫu');
    await writeState(root, FILE, next);
    return { item, templates: next };
  });
}

// Replaces {{name}} with vars[name]; unknown names stay as they are and are reported.
export function fill(body, vars) {
  const missing = new Set();
  const text = String(body).replace(/\{\{\s*([\w]+)\s*\}\}/g, (m, k) => {
    if (!Object.hasOwn(vars, k)) { // not `in`: {{constructor}} must not read a prototype property
      missing.add(k);
      return m;
    }
    return String(vars[k] ?? '');
  });
  return { text, missing: [...missing] };
}

const stepsText = (steps = []) => steps.map((s, i) => `${i + 1}. ${s.label ?? s.api}${s.status && s.status !== 'passed' ? ` — ${s.status}` : ''}${s.error ? `: ${clip(s.error.message ?? s.error, 200)}` : ''}`).join('\n') || '(không có step)';

// Variables of one result of a run (test-level templates).
export function resultVars({ meta, report }, resultId, note = null, known = null) {
  const r = (report.run.results ?? []).find((x) => x.id === resultId);
  if (!r) return null;
  const a = lastAttempt(r);
  const err = errorOf(r);
  const env = report.run.environment ?? {};
  return {
    ...runVars({ meta, report }),
    title: titleOf(r), file: r.file ?? '', line: String(r.source?.line ?? ''), target: r.targetId ?? '', agent: r.agent ?? 'default',
    status: r.status, errorCode: err?.code ?? '', errorCategory: err?.category ?? '', errorMessage: clip(err?.message, 1000),
    steps: stepsText(a.steps), attempts: String((r.attempts ?? []).length || 1),
    note: note ?? '', known: known ?? '', testKey: testKey(r),
    evidence: bugReport({ meta, report, resultId, note, known }) ?? '',
    env: [env.os, env.arch, env.runtime].filter(Boolean).join(' ') || '?',
  };
}

// Variables of a whole run (report templates).
export function runVars({ meta, report }) {
  const s = meta.summary ?? {};
  const env = report.run.environment ?? {};
  const failures = (report.run.results ?? []).filter((r) => FAILED.has(r.status)).map((r) => `- ${titleOf(r)} [${r.targetId}]${errorOf(r)?.code ? `: ${errorOf(r).code}` : ''}`);
  const rate = passRate(meta);
  return {
    runId: meta.runId, startedAt: meta.startedAt, build: buildKey(meta), branch: meta.git?.branch ?? '?', commit: String(meta.git?.commit ?? '').slice(0, 10) || '?',
    env: [env.os, env.arch, env.runtime].filter(Boolean).join(' ') || '?',
    counts: ['passed', 'failed', 'flaky', 'skipped', 'interrupted'].map((k) => `${k} ${s[k] ?? 0}`).join(', '),
    passRate: rate == null ? 'chưa có' : `${Math.round(rate * 100)}%`,
    failures: failures.length ? failures.join('\n') : '(không có)',
    runErrors: (report.run.errors ?? []).map((e) => `${e.code}: ${clip(e.message, 200)}`).join('; ') || '(không có)',
  };
}

// The prompt to paste somewhere else: the template, with the evidence attached when it does not use {{evidence}}.
export function renderPrompt(template, vars) {
  const out = fill(template.body, vars);
  const attach = Boolean(vars.evidence) && !template.body.includes('{{evidence}}');
  return { prompt: attach ? `${out.text}\n\n---\nDữ liệu:\n${vars.evidence}` : out.text, missing: out.missing };
}

// The same template for the AI: the instructions keep «names» where the blanks are, and the values go in a separate
// block that is fenced as untrusted data (ai.mjs buildPrompt 'qc-template'), so error text from the app under test
// cannot be read as instructions.
export function aiParts(template, vars) {
  const used = new Set();
  const instructions = String(template.body).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => {
    if (!Object.hasOwn(vars, k)) return m;
    used.add(k);
    return `«${k}»`;
  });
  const evidence = [...used].map((k) => `«${k}»:\n${String(vars[k] ?? '')}`);
  if (!used.has('evidence') && vars.evidence) evidence.push(`Dữ liệu:\n${vars.evidence}`);
  return { instructions, evidence };
}

// For Linear: the AI text must keep the fingerprint line of the draft, or the dashboard's own description is used.
export function keepFingerprint(text, fingerprintLine) {
  if (!fingerprintLine || text.includes(fingerprintLine)) return text;
  return `${text.trim()}\n\n${fingerprintLine}`;
}
