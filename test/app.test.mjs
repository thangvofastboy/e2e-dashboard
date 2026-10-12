import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';

const TOKEN = 'tok-123';
const VIDEO = 'web/tests_example.e2e.ts__opens_app/attempt-0/video/video.webm';
const UI = fileURLToPath(new URL('../ui', import.meta.url));
let server, base, runId;

function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

before(async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  const report = JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));
  report.run.results[0].status = 'failed';
  report.run.results[0].attempts[0].artifacts.push({ id: 'h', kind: 'other', mediaType: 'text/html', path: 'web/page.html', redaction: 'complete', producer: { kind: 'attempt' } });
  runId = report.run.id;
  put(root, '.e2e/report.json', JSON.stringify(report));
  put(root, `.e2e/results/${VIDEO}`, 'webm-bytes');
  put(root, '.e2e/results/web/page.html', '<script>alert(1)</script>');
  await archive(root, { source: 'hook' });
  server = http.createServer(createApp({ projectRoot: root, token: TOKEN, uiDir: UI, live: createLive({ throttleMs: 1 }) }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const auth = { 'x-e2e-dashboard-token': TOKEN };

test('rejects requests without token', async () => {
  assert.equal((await fetch(`${base}/api/runs`)).status, 401);
});

test('token in URL sets a strict HttpOnly cookie and redirects', async () => {
  const res = await fetch(`${base}/?token=${TOKEN}`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/');
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const runs = await fetch(`${base}/api/runs`, { headers: { cookie: cookie.split(';')[0] } });
  assert.equal(runs.status, 200);
  assert.equal((await runs.json())[0].runId, runId);
});

test('rejects foreign Host header (DNS rebinding)', async () => {
  const status = await new Promise((resolve) => {
    http.get(`${base}/api/runs`, { headers: { ...auth, host: 'evil.example:80' } }, (res) => resolve(res.statusCode));
  });
  assert.equal(status, 403);
});

test('POST requires same Origin', async () => {
  const body = JSON.stringify({ value: true });
  const bad = await fetch(`${base}/api/runs/${runId}/pin`, { method: 'POST', headers: { ...auth, origin: 'http://evil.example', 'content-type': 'application/json' }, body });
  assert.equal(bad.status, 403);
  const ok = await fetch(`${base}/api/runs/${runId}/pin`, { method: 'POST', headers: { ...auth, origin: base, 'content-type': 'application/json' }, body });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).pinned, true);
});

test('run detail and 404', async () => {
  assert.equal((await (await fetch(`${base}/api/runs/${runId}`, { headers: auth })).json()).report.run.id, runId);
  assert.equal((await fetch(`${base}/api/runs/018f0f5c-0000-0000-0000-000000000000`, { headers: auth })).status, 404);
});

test('files support Range and never escape the run dir', async () => {
  const res = await fetch(`${base}/files/runs/${runId}/artifacts/${VIDEO}`, { headers: { ...auth, range: 'bytes=0-3' } });
  assert.equal(res.status, 206);
  assert.equal(await res.text(), 'webm');
  assert.equal(res.headers.get('content-range'), 'bytes 0-3/10');
  assert.equal((await fetch(`${base}/files/runs/${runId}/..%2F..%2Fmeta.json`, { headers: auth })).status, 404);
});

test('HTML artifacts are served inert', async () => {
  const res = await fetch(`${base}/files/runs/${runId}/artifacts/web/page.html`, { headers: auth });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain/);
  assert.match(res.headers.get('content-security-policy'), /sandbox/);
});

test('events posted by the reporter reach SSE clients', async () => {
  const sse = await fetch(`${base}/api/live`, { headers: auth });
  const reader = sse.body.getReader();
  await reader.read(); // initial snapshot
  await fetch(`${base}/api/events`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'run-started', at: '2026-07-24T12:00:00.000Z', runId: 'live-1' }) });
  let text = '';
  while (!text.includes('live-1')) text += new TextDecoder().decode((await reader.read()).value);
  await reader.cancel();
  assert.match(text, /^data: /m);
});

test('live frames drop steps of finished tests (fetched via /api/live/test) and keep 50 output lines; lite is progress only', async () => {
  const post = (e) => fetch(`${base}/api/events`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(e) });
  const id = (n) => ({ testId: n, target: 'web', agent: 'default', repeat: 0 });
  await post({ type: 'run-started', at: '2026-07-24T12:00:00.000Z', runId: 'slim-1' });
  for (const n of ['done', 'busy']) {
    await post({ type: 'test-started', ...id(n), title: n, at: '2026-07-24T12:00:01.000Z' });
    await post({ type: 'step', ...id(n), progress: { phase: 'start', api: 'agent.act', label: 'x', identity: { stepId: 's1' } } });
  }
  await post({ type: 'test-finished', at: '2026-07-24T12:00:02.000Z', result: { testId: 'done', targetId: 'web', status: 'passed', attempts: [] } });
  for (let i = 0; i < 80; i++) await post({ type: 'output', stream: 'stdout', text: `l${i}` });
  const first = async (path) => {
    const res = await fetch(`${base}${path}`, { headers: auth });
    const reader = res.body.getReader();
    let text = '';
    while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    return JSON.parse(text.slice(6, text.indexOf('\n\n')));
  };
  const full = await first('/api/live');
  const t = Object.fromEntries(full.tests.map((x) => [x.title, x]));
  assert.equal(t.done.steps, undefined);
  assert.equal(t.done.stepCount, 1);
  assert.equal(t.busy.steps.length, 1);
  assert.equal(full.output.length, 50);
  const lite = await first('/api/live?lite=1');
  assert.deepEqual(Object.keys(lite).sort(), ['done', 'runId', 'runStatus', 'startedAt', 'status', 'total']);
  const one = await (await fetch(`${base}/api/live/test?key=${encodeURIComponent(t.done.key)}`, { headers: auth })).json();
  assert.equal(one.steps[0].api, 'agent.act');
});

test('run-level AI actions (why-slow, run-summary) stream instead of failing without a resultId', async () => {
  for (const action of ['why-slow', 'run-summary']) {
    const res = await fetch(`${base}/api/ai/${action}`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ runId }) });
    assert.equal(res.status, 200, action);
    assert.match(await res.text(), /^data: /m, action);
  }
  const bad = await fetch(`${base}/api/ai/explain-group`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ runId, groupId: '../x' }) });
  assert.equal(bad.status, 400);
});

test('suite AI actions validate input; drafts save once inside the project only', async () => {
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('/api/ai/ticket-test', { ticket: 'short' })).status, 400);
  assert.equal((await post('/api/ai/select-tests', { base: 'main' })).status, 400); // không phải repo git
  assert.equal((await post('/api/tests/draft', { path: '../evil.e2e.ts', content: 'x' })).status, 400);
  const ok = await post('/api/tests/draft', { path: 'TestCases/x/new.e2e.ts', content: 'test("x", () => {});' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).saved, 'TestCases/x/new.e2e.ts');
  assert.equal((await post('/api/tests/draft', { path: 'TestCases/x/new.e2e.ts', content: 'y' })).status, 409); // không ghi đè
  const dup = await post('/api/ai/duplicate-tests', {});
  assert.equal(dup.status, 200); // có run: stream (AI giả trả lỗi "chưa sẵn sàng")
  assert.match(await dup.text(), /^data: /m);
});

test('run API rejects an unknown browser; settings keep chromium by default', async () => {
  const r = await fetch(`${base}/api/run`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ browser: 'netscape' }) });
  assert.equal(r.status, 400);
  const s = await (await fetch(`${base}/api/settings`, { headers: auth })).json();
  assert.equal(s.browser, 'chromium');
  assert.deepEqual(Object.keys(s.browsers.installed).sort(), ['chromium', 'firefox', 'webkit']);
});

test('serves the UI bundle', async () => {
  const res = await fetch(`${base}/app.js`, { headers: auth });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
});

test('token redirect is not cached and pages never send a referrer', async () => {
  const redirect = await fetch(`${base}/?token=${TOKEN}`, { redirect: 'manual' });
  assert.match(redirect.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(redirect.headers.get('referrer-policy'), 'no-referrer');
  const page = await fetch(`${base}/`, { headers: auth });
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
});
