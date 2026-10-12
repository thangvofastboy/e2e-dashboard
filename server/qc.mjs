// QC workspace: notes and known-bug links per test, manual test cases, a bug report in Markdown, the build matrix
// and the bug list as CSV. Notes and manual cases are dashboard state (state/), never written into the project.
import { randomBytes } from 'node:crypto';
import { readState, writeState, serial } from './jsonstate.mjs';
import { testKey } from './analytics.mjs';

const NOTES = 'qc-notes.json';
const MANUAL = 'qc-manual.json';
const MANUAL_STATUSES = ['not-run', 'pass', 'fail', 'blocked'];
const FAILED = new Set(['failed', 'timed-out', 'interrupted']);
const KNOWN = /^[\w.#/-]{0,40}$/;

const clip = (s, n) => String(s ?? '').slice(0, n);
export const titleOf = (r) => (Array.isArray(r.titlePath) ? r.titlePath.join(' › ') : String(r.testId ?? r.id));
export const lastAttempt = (r) => (r.attempts ?? []).at(-1) ?? {};
export const errorOf = (r) => lastAttempt(r).error ?? (lastAttempt(r).steps ?? []).find((s) => s.error)?.error ?? null;
export const buildKey = (meta) => `${meta.git?.branch ?? '?'}@${String(meta.git?.commit ?? '').slice(0, 7) || '?'}`;

// ---------------------------------------------------------------- notes & known bugs

export async function readNotes(root) {
  const s = await readState(root, NOTES, null);
  return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
}

// `note` and `known` are each optional; an empty pair removes the entry.
export async function setNote(root, key, body = {}) {
  const k = clip(key, 300);
  if (!k) throw new Error('thiếu key của test');
  if (body.known != null && !KNOWN.test(String(body.known).trim())) throw new Error('mã ticket chỉ gồm chữ, số, . # / -');
  return serial(`${root}:qc-notes`, async () => {
    const all = await readNotes(root);
    const prev = all[k] ?? {};
    const note = body.note !== undefined ? clip(body.note, 2000).trim() : (prev.note ?? '');
    const known = body.known !== undefined ? (clip(body.known, 40).trim() || null) : (prev.known ?? null);
    // error shapes already reported on the known issue: a failure with another shape is a new bug (knownbug.mjs)
    const incoming = Array.isArray(body.seen) ? body.seen.map((x) => clip(x, 40)).filter(Boolean) : [];
    const seen = known ? [...new Set([...(prev.known === known ? (prev.seen ?? []) : []), ...incoming])].slice(-20) : [];
    if (!note && !known) delete all[k];
    else all[k] = { note, known, ...(seen.length ? { seen } : {}), updatedAt: new Date().toISOString() };
    await writeState(root, NOTES, all);
    return all[k] ?? null;
  });
}

// A test whose failure now has a Linear issue (new, or already open) is a known bug: link the ticket to it.
// Never throws: filing the issue matters more than the label.
export async function markKnown(root, result, issue, sig = null) {
  const id = String(issue?.identifier ?? '');
  if (!id || !KNOWN.test(id) || !result) return null;
  return setNote(root, testKey(result), { known: id, ...(sig ? { seen: [sig] } : {}) }).catch(() => null);
}

// Keys of tests that have a known bug: the gate does not count them as new failures.
export function knownKeys(notes) {
  return new Set(Object.entries(notes).filter(([, v]) => v?.known).map(([k]) => k));
}

// ---------------------------------------------------------------- manual test cases

export async function readManual(root) {
  const s = await readState(root, MANUAL, null);
  return Array.isArray(s) ? s : [];
}

export function manualSummary(list) {
  const c = Object.fromEntries(MANUAL_STATUSES.map((s) => [s, 0]));
  for (const x of list) c[x.status] = (c[x.status] ?? 0) + 1;
  const executed = c.pass + c.fail + c.blocked;
  return { total: list.length, ...c, passRate: executed ? c.pass / executed : null };
}

// body: { id?, title, module?, owner?, steps?, status?, note? } to save one case; { delete: id } to remove it.
export function saveManual(root, body = {}) {
  return serial(`${root}:qc-manual`, async () => {
    const list = await readManual(root);
    const now = new Date().toISOString();
    if (body.delete) {
      const next = list.filter((x) => x.id !== clip(body.delete, 40));
      await writeState(root, MANUAL, next);
      return { items: next };
    }
    const id = body.id ? clip(body.id, 40) : randomBytes(6).toString('hex');
    const i = list.findIndex((x) => x.id === id);
    const prev = i >= 0 ? list[i] : { id, createdAt: now, history: [] };
    const title = body.title !== undefined ? clip(body.title, 200).trim() : prev.title;
    if (!title) throw new Error('thiếu tiêu đề test');
    const status = body.status ?? prev.status ?? 'not-run';
    if (!MANUAL_STATUSES.includes(status)) throw new Error('trạng thái không hợp lệ');
    const item = {
      id, title,
      module: clip(body.module ?? prev.module ?? '', 80).trim(),
      owner: clip(body.owner ?? prev.owner ?? '', 80).trim(),
      steps: clip(body.steps ?? prev.steps ?? '', 4000),
      status,
      note: clip(body.note ?? prev.note ?? '', 2000),
      createdAt: prev.createdAt, updatedAt: now,
      history: status !== prev.status ? [...(prev.history ?? []), { at: now, status }].slice(-20) : (prev.history ?? []),
    };
    if (i < 0 && list.length >= 2000) throw new Error('quá 2000 test thủ công');
    const next = i >= 0 ? list.map((x, j) => (j === i ? item : x)) : [...list, item];
    await writeState(root, MANUAL, next);
    return { item, items: next };
  });
}

// ---------------------------------------------------------------- bug report (Markdown, for Linear / Jira / chat)

// One failing result of a run, as a bug a person can file: what ran, the steps, the error, the build and any QC note.
export function bugReport({ meta, report, resultId, note = null, known = null }) {
  const r = (report.run.results ?? []).find((x) => x.id === resultId);
  if (!r) return null;
  const a = lastAttempt(r);
  const err = errorOf(r);
  const env = report.run.environment ?? {};
  const steps = (a.steps ?? []).map((s, i) => `${i + 1}. ${s.label ?? s.api}${s.status && s.status !== 'passed' ? ` — ${s.status}` : ''}${s.error ? `\n   > ${clip(s.error.message ?? s.error, 300)}` : ''}`);
  const files = (a.artifacts ?? []).concat((a.steps ?? []).flatMap((s) => s.artifacts ?? [])).map((x) => `- ${x.kind}: ${x.path ?? x.url ?? '?'}`);
  const lines = [
    `## [QC] ${titleOf(r)}`,
    '',
    `- **Test:** \`${r.file}${r.source?.line ? `:${r.source.line}` : ''}\``,
    `- **Target / agent:** ${r.targetId} / ${r.agent ?? 'default'}`,
    `- **Trạng thái:** ${r.status}${(r.attempts ?? []).length > 1 ? ` (sau ${r.attempts.length} attempt)` : ''}`,
    `- **Run:** \`${meta.runId}\` · ${meta.startedAt}`,
    `- **Build:** ${buildKey(meta)}`,
    `- **Môi trường:** ${[env.os, env.arch, env.runtime].filter(Boolean).join(' ') || '?'}`,
    ...(known ? [`- **Known bug:** ${known}`] : []),
    '',
    '### Bước tái hiện',
    steps.length ? steps.join('\n') : '_(không có step)_',
    '',
    '### Lỗi',
    err ? `\`${err.code ?? 'ERROR'}\`: ${clip(err.message, 1000)}` : '_(không có thông báo lỗi)_',
    ...(files.length ? ['', '### Đính kèm (trong thư mục run)', ...files] : []),
    ...(note ? ['', '### Ghi chú QC', note] : []),
  ];
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------- build matrix

// The newest run of each build (branch@commit), up to `builds` builds, oldest column first; a row per test.
// `history` is newest first.
export function buildMatrix(history, { builds = 8 } = {}) {
  const seen = new Map();
  for (const { meta, report } of history) {
    if (meta.kind === 'explore') continue;
    const key = buildKey(meta);
    if (!seen.has(key)) seen.set(key, { key, meta, report });
    if (seen.size >= builds) break;
  }
  const cols = [...seen.values()].reverse();
  const rows = new Map();
  cols.forEach((c, i) => {
    for (const r of c.report.run.results ?? []) {
      if (r.selected === false) continue;
      const k = testKey(r);
      if (!rows.has(k)) rows.set(k, { key: k, title: titleOf(r), file: r.file ?? null, target: r.targetId, cells: Array(cols.length).fill(null) });
      rows.get(k).cells[i] = r.status;
    }
  });
  const out = [...rows.values()].map((x) => ({ ...x, changed: new Set(x.cells.filter(Boolean)).size > 1 }));
  out.sort((a, b) => Number(b.changed) - Number(a.changed) || a.title.localeCompare(b.title));
  return {
    builds: cols.map((c) => ({ key: c.key, runId: c.meta.runId, startedAt: c.meta.startedAt, status: c.meta.status })),
    rows: out,
  };
}

// ---------------------------------------------------------------- bug list (CSV)

// Failing results of the newest run, with the QC note and known-bug link of each test.
export function bugRows(latest, notes = {}) {
  if (!latest) return [];
  const { meta, report } = latest;
  return (report.run.results ?? []).filter((r) => FAILED.has(r.status)).map((r) => {
    const err = errorOf(r);
    const n = notes[testKey(r)] ?? {};
    return {
      id: r.id, runId: meta.runId, test: titleOf(r), file: r.file ?? '', target: r.targetId ?? '', agent: r.agent ?? 'default', status: r.status,
      code: err?.code ?? '', category: err?.category ?? '', message: clip(err?.message, 300),
      known: n.known ?? '', note: n.note ?? '', run: meta.runId, build: buildKey(meta),
    };
  });
}

// Spreadsheet-safe CSV: a cell that starts with = + - @ is prefixed so Excel does not run it as a formula.
const cell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function bugsCsv(rows) {
  const cols = ['test', 'file', 'target', 'agent', 'status', 'code', 'category', 'message', 'known', 'note', 'run', 'build'];
  return `﻿${[cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n')}\r\n`;
}
