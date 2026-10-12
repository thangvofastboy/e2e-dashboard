const EXPORT = globalThis.__E2ED_EXPORT__ ?? null;

export function isExport() {
  return Boolean(EXPORT);
}

// "409: busy" rather than "409: {\"error\":\"busy\"}"
async function httpError(res) {
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    if (typeof j?.error === 'string') return new Error(`${res.status}: ${j.error}`);
  } catch {
    // plain text body
  }
  return new Error(`${res.status}: ${text}`);
}

// Safari and macOS Firefox do not focus a clicked button, so remember the last click instead
let lastClick = null;
const busyCount = new WeakMap();
globalThis.document?.addEventListener('click', (e) => {
  const el = e.target.closest?.('button');
  if (el) lastClick = { el, at: Date.now() };
}, true);

// <html data-busy> while any request is in flight: style.css draws the top activity bar from it
let inflight = 0;
async function tracked(work) {
  const root = globalThis.document?.documentElement;
  if (++inflight === 1) root?.setAttribute('data-busy', '');
  try {
    return await work();
  } finally {
    if (--inflight === 0) root?.removeAttribute('data-busy');
  }
}

export async function getJson(path) {
  if (EXPORT) {
    if (!(path in EXPORT.api)) throw new Error('Không có trong bản export');
    return structuredClone(EXPORT.api[path]);
  }
  return tracked(async () => {
    const res = await fetch(path, { headers: { accept: 'application/json' } });
    if (!res.ok) throw await httpError(res);
    return res.json();
  });
}

export async function postJson(path, body) {
  if (EXPORT) throw new Error('Bản export chỉ đọc');
  // the button clicked just before this request shows a spinner until the server answers
  const btn = lastClick && Date.now() - lastClick.at < 1000 ? lastClick.el : null;
  if (btn) busyCount.set(btn, (busyCount.get(btn) ?? 0) + 1);
  btn?.setAttribute('aria-busy', 'true');
  try {
    return await tracked(async () => {
      const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw await httpError(res);
      return res.json();
    });
  } finally {
    if (btn) {
      busyCount.set(btn, busyCount.get(btn) - 1);
      if (!busyCount.get(btn)) btn.removeAttribute('aria-busy'); // two overlapping posts: wait for both
    }
  }
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
    // CLOSED = trình duyệt bỏ kết nối hẳn (vd. dashboard khởi động lại với token mới → 401): báo cho trang
    // thay vì giữ nguyên snapshot cũ (nút Dừng của một run không còn tồn tại)
    liveSource.onerror = () => {
      if (liveSource?.readyState !== EventSource.CLOSED) return; // đang tự kết nối lại
      const snap = { ...(liveLast ?? { status: 'idle', tests: [], output: [] }), disconnected: true };
      for (const fn of liveSubs) fn(snap);
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

// SSE over fetch (EventSource cannot POST): split "data: …\n\n" blocks across chunks.
export function createSseParser(onEvent) {
  let buf = '';
  return (chunk) => {
    buf += chunk;
    const blocks = buf.split('\n\n');
    buf = blocks.pop();
    for (const b of blocks) {
      const line = b.split('\n').find((l) => l.startsWith('data: '));
      if (line) onEvent(JSON.parse(line.slice(6)));
    }
  };
}

export async function postStream(path, body, onEvent, signal) {
  if (EXPORT) throw new Error('Bản export chỉ đọc');
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok) throw await httpError(res);
  const feed = createSseParser(onEvent);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    feed(dec.decode(value, { stream: true }));
  }
}
