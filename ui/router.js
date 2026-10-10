const PAGES = ['runs', 'live', 'tests', 'flaky', 'errors', 'cost', 'routes', 'projects', 'digest', 'locators', 'models', 'lint'];

export function parseRoute(hash) {
  const parts = (hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return { view: 'overview' };
  if (PAGES.includes(parts[0])) return { view: parts[0] };
  if (parts[0] === 'run' && parts[1]) return { view: 'run', runId: parts[1], resultId: parts[2] === 'test' ? parts[3] ?? null : null };
  if (parts[0] === 'compare' && parts[1] && parts[2]) return { view: 'compare', a: parts[1], b: parts[2] };
  if (parts[0] === 'branches') return { view: 'branches', a: parts[1] ?? null, b: parts[2] ?? null };
  return { view: 'notfound' };
}

export function runHref(runId, resultId) {
  return `#/run/${encodeURIComponent(runId)}${resultId ? `/test/${encodeURIComponent(resultId)}` : ''}`;
}

export function compareHref(a, b) {
  return `#/compare/${encodeURIComponent(a)}/${encodeURIComponent(b)}`;
}

export function branchesHref(a, b) {
  return a && b ? `#/branches/${encodeURIComponent(a)}/${encodeURIComponent(b)}` : '#/branches';
}
