// Smoke: server thật — lịch sử chat AI (ghi, đọc, xoá qua API, có trên ổ đĩa) và bundle UI có nút Hỏi AI nổi + Live mới.
import './_home.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';
import { chatEntry } from '../ui/views/ai-panel.js';

const UI = fileURLToPath(new URL('../ui', import.meta.url));
const auth = { 'x-e2e-dashboard-token': 't', 'content-type': 'application/json' };
let server, base, root;
before(async () => {
  root = mkdtempSync(join(tmpdir(), 'e2ed-smoke-hist-'));
  writeFileSync(join(root, 'e2e.config.ts'), 'export default {};\n');
  server = http.createServer(createApp({ projectRoot: root, token: 't', uiDir: UI, live: createLive({ throttleMs: 1 }) }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
const post = (p, body) => fetch(base + p, { method: 'POST', headers: auth, body: JSON.stringify(body) });
const get = (p) => fetch(base + p, { headers: auth });

test('phân tích lỗi + hỏi tiếp + Hỏi AI → lịch sử trên ổ đĩa, mở lại được, xoá được', async () => {
  const first = chatEntry({ sessionId: 's-a', title: 'Phân tích lỗi · cart', source: { action: 'analyze-failure', runId: null, resultId: null }, question: 'Phân tích lỗi · cart', answer: 'do locator' });
  assert.equal((await post('/api/ai/chats', first)).status, 200);
  assert.equal((await post('/api/ai/chats', chatEntry({ chatId: 's-a', sessionId: 's-b', title: 'x', question: 'sửa sao?', answer: 'đổi getByRole' }))).status, 200);
  assert.equal((await post('/api/ai/chats', chatEntry({ sessionId: 's-c', title: 'test nào flaky?', source: { action: 'ask' }, question: 'test nào flaky?', answer: 'login' }))).status, 200);
  assert.ok(existsSync(join(root, '.e2e-dashboard', 'state', 'ai-chats.json')));
  const list = await (await get('/api/ai/chats')).json();
  assert.deepEqual(list.map((c) => c.id), ['s-c', 's-a']);
  const a = await (await get('/api/ai/chats?id=s-a')).json();
  assert.equal(a.sessionId, 's-b'); // hỏi tiếp dùng session mới nhất
  assert.deepEqual(a.msgs.map((m) => m.text), ['Phân tích lỗi · cart', 'do locator', 'sửa sao?', 'đổi getByRole']);
  assert.equal((await post('/api/ai/chats', { id: '../x', title: 't', msgs: [{ role: 'user', text: 'a' }] })).status, 400);
  assert.equal((await get('/api/ai/chats?id=nope')).status, 404);
  assert.deepEqual(await (await post('/api/ai/chats/delete', { id: 's-c' })).json(), { removed: 1 });
  assert.deepEqual((await (await get('/api/ai/chats')).json()).map((c) => c.id), ['s-a']);
});

test('bundle: nút Hỏi AI nổi thay nút trong menu; Live có số liệu, tiến độ chia đoạn, hai cột', async () => {
  const js = await (await get('/app.js')).text();
  assert.match(js, /ai-fab/);
  assert.doesNotMatch(js, /nav-ask/);
  for (const s of ['kpi-row', 'progress-segs', 'live-cols', 'running-list', 'hist-item']) assert.match(js, new RegExp(s), s);
  const css = await (await get('/style.css')).text();
  assert.match(css, /body:has\(#ai-panel\) \.ai-fab/);
});
