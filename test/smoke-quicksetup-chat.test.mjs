// Smoke: server thật — Quick Setup (plan + chạy bước trong project tạm) và khung chat Hỏi AI (ask rồi followup cùng session).
import './_home.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';

const UI = fileURLToPath(new URL('../ui', import.meta.url));
const TOKEN = 'smoke-token';
const auth = { 'x-e2e-dashboard-token': TOKEN, 'content-type': 'application/json' };
let server, base, root;
const calls = [];
const ai = { run: async ({ prompt, resume, onEvent }) => {
  calls.push({ prompt, resume });
  onEvent({ type: 'session', sessionId: 'sess-1' });
  onEvent({ type: 'text', text: resume ? 'trả lời 2' : 'trả lời 1' });
  onEvent({ type: 'done', result: resume ? 'trả lời 2' : 'trả lời 1', sessionId: 'sess-1' });
} };

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'e2ed-smoke-'));
  writeFileSync(join(root, 'e2e.config.ts'), "import { defineConfig } from 'e2e';\nexport default defineConfig({ reporters: ['list'] });\n");
  writeFileSync(join(root, '.env.example'), 'BASE_URL=http://localhost\n');
  server = http.createServer(createApp({ projectRoot: root, token: TOKEN, uiDir: UI, live: createLive({ throttleMs: 1 }), ai }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const sse = async (path, body) => {
  const r = await fetch(base + path, { method: 'POST', headers: auth, body: JSON.stringify(body) });
  assert.equal(r.status, 200, await r.clone().text());
  return (await r.text()).split('\n\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, '')));
};

test('Quick Setup: GET plan có đủ các mục, project chưa setup được đánh dấu tự cài', async () => {
  const plan = await (await fetch(`${base}/api/system/quick-setup`, { headers: auth })).json();
  for (const id of ['git', 'gh', 'node', 'e2e', 'deps', 'browsers', 'claude', 'project']) assert.ok(plan.items.some((x) => x.id === id), id);
  assert.ok(plan.steps.includes('project'));
  assert.ok(plan.steps.includes('e2e')); // project tạm chưa có package.json
});

test('Quick Setup: chạy bước project qua SSE, id lạ bị bỏ qua, id sai dạng bị 400', async () => {
  const ev = await sse('/api/system/quick-setup/run', { ids: ['project', 'khong-co'] });
  assert.deepEqual(ev.filter((e) => e.type === 'step').map((e) => e.id), ['project']);
  assert.equal(ev.find((e) => e.type === 'step-done').ok, true);
  assert.ok(existsSync(join(root, 'e2e-dashboard.reporter.mjs')));
  assert.equal(ev.at(-1).type, 'done');
  const after = await (await fetch(`${base}/api/system/quick-setup`, { headers: auth })).json();
  assert.ok(after.items.find((x) => x.id === 'project').ok); // kế hoạch lập lại thấy reporter đã cài
  const bad = await fetch(`${base}/api/system/quick-setup/run`, { method: 'POST', headers: auth, body: JSON.stringify({ ids: ['rm -rf /'] }) });
  assert.equal(bad.status, 400);
});

test('Hỏi AI dạng chat: câu đầu /ask mở session, câu sau /followup resume đúng session', async () => {
  const { chatRequest } = await import('../ui/views/ai-panel.js');
  const first = chatRequest(null, 'test nào flaky?');
  const ev1 = await sse(first.path, first.payload);
  const sid = ev1.find((e) => e.type === 'session').sessionId;
  assert.equal(ev1.find((e) => e.type === 'done').result, 'trả lời 1');
  const next = chatRequest(sid, 'vì sao?');
  const ev2 = await sse(next.path, next.payload);
  assert.equal(ev2.find((e) => e.type === 'done').result, 'trả lời 2');
  assert.equal(calls.at(-1).resume, 'sess-1');
  assert.equal(calls.at(-1).prompt, 'vì sao?');
});

test('bundle UI (/app.js) và CSS có khung chat + Quick Setup', async () => {
  const js = await (await fetch(`${base}/app.js`, { headers: auth })).text();
  assert.match(js, /chat-log/);
  assert.match(js, /data-quick-run/);
  const css = await (await fetch(`${base}/style.css`, { headers: auth })).text();
  assert.match(css, /\.chat-input/);
});

test('Quick Setup: kế hoạch có hệ điều hành đang chạy', async () => {
  const plan = await (await fetch(`${base}/api/system/quick-setup`, { headers: auth })).json();
  assert.ok(plan.os?.label);
  assert.equal(plan.items[0].id, 'os');
});

test('e2e.config: GET đọc URL app / lệnh, POST sửa đúng hai giá trị, kiểu sai bị 400', async () => {
  const cfgPath = join(root, 'e2e.config.ts');
  const before = readFileSync(cfgPath, 'utf8');
  writeFileSync(cfgPath, before.replace("defineConfig({", "defineConfig({\n  targets: [{ engine: web(), app: {\n    url: process.env.APP_URL ?? 'http://localhost:3000',\n  } }],"));
  try {
    const cur = await (await fetch(`${base}/api/system/e2e-config`, { headers: auth })).json();
    assert.equal(cur.exists, true);
    assert.equal(cur.appUrl, 'http://localhost:3000');
    const r = await (await fetch(`${base}/api/system/e2e-config`, { method: 'POST', headers: auth, body: JSON.stringify({ appUrl: 'http://localhost:5173', command: 'npm run dev' }) })).json();
    assert.deepEqual(r.changed, ['URL app', 'lệnh khởi động']);
    assert.equal(r.command, 'npm run dev');
    assert.match(readFileSync(cfgPath, 'utf8'), /command: \{ executable: 'npm', args: \['run', 'dev'\] \}/);
    const bad = await fetch(`${base}/api/system/e2e-config`, { method: 'POST', headers: auth, body: JSON.stringify({ appUrl: 42 }) });
    assert.equal(bad.status, 400);
  } finally {
    writeFileSync(cfgPath, before);
  }
});
