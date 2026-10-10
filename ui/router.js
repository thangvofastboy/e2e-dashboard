export function parseRoute(hash) {
  const parts = (hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return { view: 'overview' };
  if (parts[0] === 'runs' || parts[0] === 'live' || parts[0] === 'tests') return { view: parts[0] };
  if (parts[0] === 'run' && parts[1]) return { view: 'run', runId: parts[1], resultId: parts[2] === 'test' ? parts[3] ?? null : null };
  return { view: 'notfound' };
}

export function runHref(runId, resultId) {
  return `#/run/${encodeURIComponent(runId)}${resultId ? `/test/${encodeURIComponent(resultId)}` : ''}`;
}
