// CSV exports (Excel opens them; a leading BOM keeps Vietnamese text readable there).
const cell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // never let a spreadsheet read report text as a formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const table = (head, rows) => `\ufeff${[head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;

export const csvRuns = (metas) => table(
  ['run_id', 'started_at', 'status', 'branch', 'commit', 'passed', 'flaky', 'failed', 'skipped', 'duration_ms', 'tokens', 'cost_usd', 'source'],
  metas.map((m) => [m.runId, m.startedAt, m.status, m.git?.branch, m.git?.commit, m.summary?.passed ?? 0, m.summary?.flaky ?? 0, m.summary?.failed ?? 0, m.summary?.skipped ?? 0, m.durationMs, (m.tokens?.input ?? 0) + (m.tokens?.output ?? 0), m.costUsd, m.source]),
);

export const csvTests = (tests) => table(
  ['test', 'file', 'line', 'target', 'agent', 'runs', 'passed', 'failed', 'avg_duration_ms', 'latest_status'],
  tests.map((t) => [t.title, t.file, t.line, t.target, t.agent, t.history.length, t.history.filter((h) => h.status === 'passed' || h.status === 'flaky').length, t.history.filter((h) => ['failed', 'timed-out', 'interrupted'].includes(h.status)).length, t.avgDurationMs, t.history[0]?.status]),
);

export const csvFlaky = (flaky) => table(
  ['test', 'file', 'line', 'target', 'score', 'flaky', 'flips', 'same_commit_flips', 'fail_rate', 'runs'],
  flaky.map((t) => [t.title, t.file, t.line, t.target, t.score, t.flaky, t.flips, t.sameCommitFlips, Math.round(t.failRate * 1000) / 1000, t.runs]),
);
