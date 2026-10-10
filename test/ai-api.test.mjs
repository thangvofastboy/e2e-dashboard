import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';

const UI = fileURLToPath(new URL('../ui', import.meta.url));
let server, base, runId, resultId, prompts;

before(async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  const r = JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));
  r.run.results[0].status = 'failed';
  runId = r.run.id;
  resultId = r.run.results[0].id;
  await archive(root, { source: 'hook', report: r });
  prompts = [];
  const ai = {
    async run({ prompt, resume, onEvent }) {
      prompts.push({ prompt, resume });
      onEvent({ type: 'session', sessionId: 'sess-1' });
      onEvent({ type: 'tool', name: 'Read', detail: 'tests/example.e2e.ts' });
      onEvent({ type: 'text', text: '## Phân loại\nlỗi app' });
      onEvent({ type: 'done', sessionId: 'sess-1', isError: false, result: '## Phân loại\nlỗi app' });
    },
  };
  server = http.createServer(createApp({ projectRoot: root, token: 't', uiDir: UI, live: createLive(), ai }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'x-e2e-dashboard-token': 't', origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const events = async (res) => (await res.text()).split('\n\n').filter((b) => b.startsWith('data: ')).map((b) => JSON.parse(b.slice(6)));

test('analyze-failure streams events, then serves the cached result, refresh reruns', async () => {
  const first = await post('/api/ai/analyze-failure', { runId, resultId });
  assert.equal(first.status, 200);
  assert.match(first.headers.get('content-type'), /text\/event-stream/);
  const ev1 = await events(first);
  assert.deepEqual(ev1.map((e) => e.type), ['session', 'tool', 'text', 'done']);
  assert.match(prompts[0].prompt, /opens app/);
  const ev2 = await events(await post('/api/ai/analyze-failure', { runId, resultId }));
  assert.equal(ev2[0].type, 'cached');
  assert.match(ev2[0].markdown, /lỗi app/);
  assert.equal(prompts.length, 1);
  await events(await post('/api/ai/analyze-failure', { runId, resultId, refresh: true }));
  assert.equal(prompts.length, 2);
});

test('cached analyses are listed per run (used by the panel and the export)', async () => {
  await events(await post('/api/ai/analyze-run', { runId }));
  const { entries } = await (await fetch(`${base}/api/runs/${runId}/ai`, { headers: { 'x-e2e-dashboard-token': 't' } })).json();
  assert.deepEqual(entries.map((e) => e.action).sort(), ['analyze-failure', 'analyze-run']);
  assert.ok(entries.every((e) => e.markdown.includes('lỗi app')));
});

test('follow-up resumes the session; bad input is rejected', async () => {
  const ev = await events(await post('/api/ai/followup', { runId, sessionId: 'sess-1', question: 'Sửa thế nào?' }));
  assert.equal(ev.at(-1).type, 'done');
  assert.equal(prompts.at(-1).resume, 'sess-1');
  assert.match(prompts.at(-1).prompt, /Sửa thế nào\?/);
  assert.equal((await post('/api/ai/followup', { runId, sessionId: '../x', question: 'q' })).status, 400);
  assert.equal((await post('/api/ai/followup', { runId, sessionId: 's', question: '' })).status, 400);
  assert.equal((await post('/api/ai/explode', { runId })).status, 404);
  assert.equal((await post('/api/ai/analyze-run', { runId: '018f0f5c-0000-0000-0000-000000000000' })).status, 404);
});

test('the export embeds cached analyses for read-only viewing', async () => {
  const { buildExportHtml } = await import('../server/export.mjs');
  const { mkdtempSync: mk } = await import('node:fs');
  const root = mk(join(tmpdir(), 'e2ed-'));
  const r = JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));
  await archive(root, { source: 'hook', report: r });
  const { writeAi } = await import('../server/store.mjs');
  await writeAi(root, r.run.id, 'a'.repeat(64), { action: 'analyze-run', resultId: null, markdown: '## Tóm tắt ổn định', createdAt: '2026-10-10T00:00:00Z' });
  const { html } = await buildExportHtml(root, r.run.id);
  assert.ok(html.includes(`/api/runs/${r.run.id}/ai`));
  assert.ok(html.includes('Tóm tắt ổn định'));
});
