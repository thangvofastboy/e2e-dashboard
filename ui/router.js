const PAGES = ['runs', 'live', 'tests', 'flaky', 'errors', 'cost', 'routes', 'projects', 'digest', 'locators', 'models', 'lint', 'app-errors', 'settings', 'coverage', 'environment', 'report'];

// "#/run/<id>?status=failed" → view + params; params (filters) only appear when the hash has them.
export function parseRoute(hash) {
  const [path, query] = (hash || '#/').split('?');
  const parts = path.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const params = query ? Object.fromEntries(new URLSearchParams(query)) : null;
  const withParams = (r) => (params ? { ...r, params } : r);
  if (!parts.length) return withParams({ view: 'overview' });
  if (PAGES.includes(parts[0])) return withParams({ view: parts[0] });
  if (parts[0] === 'run' && parts[1]) return withParams({ view: 'run', runId: parts[1], resultId: parts[2] === 'test' ? parts[3] ?? null : null });
  if (parts[0] === 'test' && parts[1]) return withParams({ view: 'test', key: parts[1] });
  if (parts[0] === 'compare' && parts[1] && parts[2]) return { view: 'compare', a: parts[1], b: parts[2] };
  if (parts[0] === 'branches') return { view: 'branches', a: parts[1] ?? null, b: parts[2] ?? null };
  return { view: 'notfound' };
}

export function runHref(runId, resultId) {
  return `#/run/${encodeURIComponent(runId)}${resultId ? `/test/${encodeURIComponent(resultId)}` : ''}`;
}

export function testHref(key) {
  return `#/test/${encodeURIComponent(key)}`;
}

export function compareHref(a, b) {
  return `#/compare/${encodeURIComponent(a)}/${encodeURIComponent(b)}`;
}

export function branchesHref(a, b) {
  return a && b ? `#/branches/${encodeURIComponent(a)}/${encodeURIComponent(b)}` : '#/branches';
}

// Keep filters in the URL (shareable, survive reload) without adding history entries or re-rendering.
export function replaceParams(params) {
  const [path] = location.hash.split('?');
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  history.replaceState(null, '', `${location.pathname}${location.search}${path}${q ? `?${q}` : ''}`);
}
