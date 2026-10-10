const EXPORT = globalThis.__E2ED_EXPORT__ ?? null;

export function isExport() {
  return Boolean(EXPORT);
}

export async function getJson(path) {
  if (EXPORT) {
    if (!(path in EXPORT.api)) throw new Error('Không có trong bản export');
    return structuredClone(EXPORT.api[path]);
  }
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

export async function postJson(path, body) {
  if (EXPORT) throw new Error('Bản export chỉ đọc');
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

export function encodePath(rel) {
  return rel.split('/').map(encodeURIComponent).join('/');
}

export function fileUrl(runId, rel) {
  if (!rel) return null;
  const key = `runs/${runId}/${rel}`;
  if (EXPORT) return EXPORT.files[key] ?? null;
  return `/files/${encodePath(key)}`;
}

// One EventSource per page, shared by every subscriber (nav badge + Live view), so tabs do not
// exhaust the browser's per-host connection limit.
let liveSource = null;
let liveLast = null;
const liveSubs = new Set();

export function liveStream(onSnapshot) {
  if (EXPORT) return () => {};
  liveSubs.add(onSnapshot);
  if (!liveSource) {
    liveSource = new EventSource('/api/live');
    liveSource.onmessage = (e) => {
      liveLast = JSON.parse(e.data);
      for (const fn of liveSubs) fn(liveLast);
    };
  } else if (liveLast) {
    onSnapshot(liveLast);
  }
  return () => {
    liveSubs.delete(onSnapshot);
    if (!liveSubs.size && liveSource) {
      liveSource.close();
      liveSource = null;
      liveLast = null;
    }
  };
}
