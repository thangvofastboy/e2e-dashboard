// Release readiness (M7): compare the runs at one git tag with the runs at the previous one and give a
// verdict. git is only ever called with argv; tag names must be tags the repo actually has.
import { execFile } from 'node:child_process';
import { listRuns, getRun } from './store.mjs';
import { compareRuns, flakyTests } from './analytics.mjs';
import { gitTags } from './events.mjs';
import { passRate } from '../ui/health.js';

const FAIL = new Set(['failed', 'timed-out', 'interrupted']);

function revList(root, args, execImpl = execFile) {
  return new Promise((ok) => {
    execImpl('git', ['rev-list', '--max-count=3000', ...args], { cwd: root, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => ok(err ? [] : String(out).split('\n').filter(Boolean)));
  });
}

const newest = (metas) => [...metas].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0] ?? null;

export async function releaseReport(root, { from = null, to = null, slo = 0.95, openTriage = 0, execImpl = execFile } = {}) {
  const tags = await gitTags(root, { execImpl });
  if (!tags.length) return { tags: [], error: 'no-tags' };
  const toTag = tags.find((t) => t.name === to) ?? tags[0];
  const fromTag = from ? tags.find((t) => t.name === from) : tags[tags.indexOf(toTag) + 1] ?? null;
  if ((to && toTag.name !== to) || (from && !fromTag)) return { tags, error: 'unknown-tag' };
  const metas = (await listRuns(root)).filter((m) => m.kind !== 'explore' && m.git?.commit);
  const range = new Set(fromTag ? await revList(root, [`${fromTag.commit}..${toTag.commit}`], execImpl) : await revList(root, [toTag.commit], execImpl));
  range.add(toTag.commit);
  const inRange = metas.filter((m) => range.has(m.git.commit));
  const atTag = metas.filter((m) => m.git.commit === toTag.commit);
  const headMeta = newest(atTag) ?? newest(inRange);
  let baseMeta = null;
  if (fromTag) {
    const before = new Set(await revList(root, [fromTag.commit], execImpl));
    baseMeta = newest(metas.filter((m) => m.git.commit === fromTag.commit)) ?? newest(metas.filter((m) => before.has(m.git.commit) && !range.has(m.git.commit)));
  }
  const [head, base] = await Promise.all([headMeta && getRun(root, headMeta.runId), baseMeta && getRun(root, baseMeta.runId)]);
  const history = [];
  for (const m of inRange.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, 30)) {
    const r = await getRun(root, m.runId).catch(() => null);
    if (r) history.push(r);
  }
  const cmp = head && base ? compareRuns(base, head) : null;
  const failing = head ? (head.report.run.results ?? []).filter((r) => r.kind !== 'setup' && FAIL.has(r.status)).map((r) => ({ title: Array.isArray(r.titlePath) ? r.titlePath.join(' › ') : r.testId, target: r.targetId, resultId: r.id })) : [];
  const flaky = flakyTests(history).filter((f) => f.score >= 0.1);
  const rate = head ? passRate(head.meta) : null;
  const reasons = [];
  if (!head) reasons.push('Chưa có run nào ở commit của tag này.');
  else {
    if (failing.length) reasons.push(`${failing.length} test đang fail ở run của tag.`);
    if (cmp?.counts?.regressed) reasons.push(`${cmp.counts.regressed} test mới fail so với ${fromTag.name}.`);
    if (rate != null && rate < slo) reasons.push(`Pass rate ${Math.round(rate * 100)}% dưới mục tiêu ${Math.round(slo * 100)}%.`);
    if (flaky.length) reasons.push(`${flaky.length} test flaky trong các run của bản này.`);
    if (openTriage) reasons.push(`${openTriage} lỗi chưa xử lý trong Triage.`);
  }
  const verdict = !head ? 'unknown' : failing.length || cmp?.counts?.regressed || (rate != null && rate < slo) ? 'blocked' : flaky.length || openTriage ? 'risk' : 'ready';
  return {
    tags,
    from: fromTag, to: toTag,
    head: head?.meta ?? null, base: base?.meta ?? null, atTag: Boolean(atTag.length),
    runs: inRange.length, commits: range.size,
    passRate: rate, compare: cmp && { counts: cmp.counts, deltas: cmp.deltas, rows: cmp.rows.filter((r) => r.change !== 'unchanged').slice(0, 200) }, failing, flaky: flaky.slice(0, 20).map((f) => ({ key: f.key, title: f.title, target: f.target, score: f.score })),
    verdict, reasons,
  };
}
