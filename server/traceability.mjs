// Requirement traceability (M7): tests name the stories they cover with a tag (@LIN-123, @story:LIN-123)
// or a bracketed id in the title ([LIN-123]). The config can list the stories that should be covered:
// "traceability": { "stories": ["LIN-1", { "id": "LIN-2", "title": "Checkout", "url": "https://…" }] }.
import { testKey } from './analytics.mjs';

const FAIL = new Set(['failed', 'timed-out', 'interrupted']);
const ID = /^[A-Z][A-Z0-9]{1,9}-\d{1,7}$/;
const TAG = /^@(?:story[:=])?([A-Z][A-Z0-9]{1,9}-\d{1,7})$/i;
const IN_TITLE = /\[([A-Z][A-Z0-9]{1,9}-\d{1,7})\]/g;
const title = (r) => (Array.isArray(r.titlePath) ? r.titlePath.join(' › ') : String(r.testId ?? r.id));

export function storyIds(r) {
  const ids = new Set();
  for (const t of r.tags ?? []) {
    const m = TAG.exec(String(t));
    if (m) ids.add(m[1].toUpperCase());
  }
  for (const m of title(r).matchAll(IN_TITLE)) ids.add(m[1]);
  return [...ids];
}

export function storyList(cfg) {
  const list = Array.isArray(cfg?.traceability?.stories) ? cfg.traceability.stories : [];
  return list.slice(0, 2000).map((s) => (typeof s === 'string' ? { id: s } : s && typeof s === 'object' ? { id: s.id, title: s.title, url: s.url } : null))
    .filter((s) => s && typeof s.id === 'string' && ID.test(s.id))
    .map((s) => ({ id: s.id, title: typeof s.title === 'string' ? s.title.slice(0, 200) : null, url: typeof s.url === 'string' && /^https:\/\//.test(s.url) ? s.url.slice(0, 500) : null }));
}

// history: newest first.
export function traceMatrix(history, { stories = [] } = {}) {
  const latest = new Map();
  const flakyKeys = new Set();
  for (const { meta, report } of history) {
    if (meta.kind === 'explore') continue;
    for (const r of report?.run?.results ?? []) {
      if (!r || r.kind === 'setup' || r.selected === false) continue;
      const k = testKey(r);
      if (r.status === 'flaky') flakyKeys.add(k);
      if (!latest.has(k)) latest.set(k, { r, meta });
    }
  }
  const byStory = new Map(stories.map((s) => [s.id, { ...s, tests: [] }]));
  let unlinked = 0;
  for (const [k, { r, meta }] of latest) {
    const ids = storyIds(r);
    if (!ids.length) unlinked++;
    for (const id of ids) {
      if (!byStory.has(id)) byStory.set(id, { id, title: null, url: null, tests: [], unlisted: stories.length > 0 });
      byStory.get(id).tests.push({ key: k, title: title(r), target: r.targetId, status: r.status, flaky: flakyKeys.has(k), runId: meta.runId, resultId: r.id, at: meta.startedAt });
    }
  }
  const rows = [...byStory.values()].map((s) => {
    const run = s.tests.filter((t) => t.status !== 'skipped');
    const status = !s.tests.length ? 'no-tests' : !run.length ? 'not-run' : run.some((t) => FAIL.has(t.status)) ? 'failing' : run.some((t) => t.flaky || t.status === 'flaky') ? 'flaky' : 'passing';
    return { ...s, status };
  });
  const order = { failing: 0, 'no-tests': 1, flaky: 2, 'not-run': 3, passing: 4 };
  rows.sort((a, b) => order[a.status] - order[b.status] || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const count = (st) => rows.filter((r) => r.status === st).length;
  const listed = rows.filter((r) => !r.unlisted);
  return {
    rows,
    summary: { stories: rows.length, passing: count('passing'), failing: count('failing'), flaky: count('flaky'), notRun: count('not-run'), noTests: count('no-tests'), covered: listed.filter((r) => r.tests.length).length, listed: stories.length },
    tests: latest.size,
    unlinkedTests: unlinked,
  };
}
