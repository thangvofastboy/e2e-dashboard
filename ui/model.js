const sumDuration = (attempts) => attempts.reduce((s, a) => s + (a.durationMs ?? 0), 0);

function serialAttempts(report, r) {
  const g = (report.run.serialGroups ?? []).find((x) =>
    r.serialGroupId
      ? x.id === r.serialGroupId
      : x.memberTestIds?.includes(r.testId) && x.targetId === r.targetId &&
        (x.agent ?? 'default') === (r.agent ?? 'default') && (x.repeat ?? 0) === (r.repeat ?? 0));
  if (!g) return [];
  return (g.attempts ?? []).flatMap((ga) =>
    (ga.members ?? [])
      .filter((m) => m.testId === r.testId)
      .map((m) => ({ ...m, memberId: m.id, id: ga.id, index: ga.index, artifacts: ga.artifacts ?? [], serial: true })));
}

export function flattenResults(report) {
  return (report.run.results ?? []).map((r) => {
    const attempts = r.attempts?.length ? r.attempts : serialAttempts(report, r);
    return {
      id: r.id,
      testId: r.testId,
      title: Array.isArray(r.titlePath) ? r.titlePath.join(' › ') : String(r.testId ?? r.id),
      titlePath: Array.isArray(r.titlePath) ? r.titlePath : [String(r.testId ?? r.id)],
      file: r.source?.file ?? r.file,
      line: r.source?.line ?? null,
      target: r.targetId,
      agent: r.agent ?? 'default',
      repeat: r.repeat ?? 0,
      tags: r.tags ?? [],
      status: r.status,
      kind: r.kind,
      durationMs: sumDuration(attempts),
      attempts,
    };
  });
}

const uniq = (xs) => [...new Set(xs)].sort();

export function facets(rows) {
  return {
    tags: uniq(rows.flatMap((r) => r.tags)),
    files: uniq(rows.map((r) => r.file)),
    targets: uniq(rows.map((r) => r.target)),
    agents: uniq(rows.map((r) => r.agent)),
    statuses: uniq(rows.map((r) => r.status)),
  };
}

export function applyFilters(rows, { tags = [], files = [], targets = [], agents = [], statuses = [] } = {}) {
  const has = (list, v) => !list.length || list.includes(v);
  return rows.filter(
    (r) => has(files, r.file) && has(targets, r.target) && has(agents, r.agent) && has(statuses, r.status) &&
      (!tags.length || r.tags.some((t) => tags.includes(t))));
}

// Known bug (QC notes keyed like the test page): mode 'only' keeps them, 'hide' drops them, anything else keeps all.
export const knownKey = (r) => `${r.testId}|${r.target}|${r.agent}`;
export function filterKnown(rows, mode, notes = {}) {
  if (mode !== 'only' && mode !== 'hide') return rows;
  return rows.filter((r) => Boolean(notes?.[knownKey(r)]?.known) === (mode === 'only'));
}

export function matrix(rows) {
  const targets = uniq(rows.map((r) => r.target));
  const byTest = new Map();
  for (const r of rows) {
    const k = `${r.testId}|${r.agent}|${r.repeat}`;
    if (!byTest.has(k)) byTest.set(k, { testId: r.testId, title: r.title, cells: {} });
    byTest.get(k).cells[r.target] = r;
  }
  return { targets, rows: [...byTest.values()] };
}

// "Chỉ test fail": fail thật ở lần chạy cuối (flaky = pass sau khi thử lại, không tính)
export const isFailed = (status) => ['failed', 'timed-out', 'interrupted', 'error'].includes(status);

export function isFailure(status) {
  return ['failed', 'timed-out', 'interrupted', 'flaky'].includes(status);
}

export function stepVideoOffset(step, video, attempt) {
  const origin = Date.parse(video?.startedAt ?? attempt?.startedAt);
  const t = Date.parse(step?.startedAt);
  if (Number.isNaN(origin) || Number.isNaN(t) || t < origin) return null;
  return (t - origin) / 1000;
}

// Selected result rows → the body of POST /api/run (file:line per test, union of targets/agents).
export function selectionToRun(rows, ids) {
  const picked = rows.filter((r) => ids.has(r.id));
  const tests = [...new Set(picked.map((r) => (r.line ? `${r.file}:${r.line}` : r.file)))];
  return { tests, targets: [...new Set(picked.map((r) => r.target))], agents: [...new Set(picked.map((r) => r.agent))] };
}
