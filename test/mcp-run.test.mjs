import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';
import { handleMessage, TOOLS } from '../bin/mcp.mjs';

const UI = fileURLToPath(new URL('../ui', import.meta.url));
const TOKEN = 'mcp-run-token-1234567890';

// server dashboard thật + runner giả; server.json như dashboard ghi khi khởi động
async function dashboard(runner) {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-mcp-run-'));
  mkdirSync(join(root, '.e2e-dashboard'), { recursive: true });
  const server = http.createServer(createApp({ projectRoot: root, token: TOKEN, uiDir: UI, live: createLive(), runner }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  writeFileSync(join(root, '.e2e-dashboard', 'server.json'), JSON.stringify({ port: server.address().port, token: TOKEN, pid: process.pid }));
  return { root, close: () => server.close() };
}
const call = (root, name, args) => handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, root);

test('MCP có tool chạy và dừng test', () => {
  const names = TOOLS.map((t) => t.name);
  assert.ok(names.includes('e2e_run_start') && names.includes('e2e_run_stop'));
  const start = TOOLS.find((t) => t.name === 'e2e_run_start');
  assert.deepEqual(start.inputSchema.properties.browser.enum, ['chromium', 'firefox', 'webkit']);
});

test('e2e_run_start gửi đúng tuỳ chọn tới /api/run và báo đã bắt đầu', async () => {
  const seen = [];
  const d = await dashboard({ start: (opts) => (seen.push(opts), { ok: true, pid: 4242 }), stop: () => false, state: () => ({ running: false, pid: null }) });
  try {
    const r = await call(d.root, 'e2e_run_start', { tests: ['tests/checkout.e2e.ts:12'], browser: 'firefox', headed: true, workers: 2, evil: 'x' });
    assert.match(r.result.content[0].text, /Đã bắt đầu run \(pid 4242\)/);
    assert.deepEqual(seen[0].tests, ['tests/checkout.e2e.ts:12']);
    assert.equal(seen[0].browser, 'firefox');
    assert.equal(seen[0].headed, true);
    assert.equal(seen[0].workers, 2);
    assert.equal('evil' in seen[0], false, 'khoá lạ không lọt vào runner');
  } finally {
    d.close();
  }
});

test('e2e_run_start không truyền tests = chạy cả suite', async () => {
  const seen = [];
  const d = await dashboard({ start: (opts) => (seen.push(opts), { ok: true, pid: 1 }), stop: () => false, state: () => ({ running: false, pid: null }) });
  try {
    await call(d.root, 'e2e_run_start', {});
    assert.deepEqual(seen[0].tests, []);
  } finally {
    d.close();
  }
});

test('e2e_run_start báo lỗi rõ khi run đang chạy hoặc dashboard chưa mở', async () => {
  const busy = await dashboard({ start: () => ({ ok: false, error: 'busy' }), stop: () => false, state: () => ({ running: true, pid: 9 }) });
  try {
    const r = await call(busy.root, 'e2e_run_start', {});
    assert.match(r.result.content[0].text, /HTTP 409/);
  } finally {
    busy.close();
  }
  const none = mkdtempSync(join(tmpdir(), 'e2ed-mcp-none-'));
  const r = await call(none, 'e2e_run_start', {});
  assert.match(r.result.content[0].text, /Dashboard chưa chạy/);
});

test('e2e_run_stop gọi /api/run/stop', async () => {
  let stopped = 0;
  const d = await dashboard({ start: () => ({ ok: false }), stop: () => (stopped++, true), state: () => ({ running: true, pid: 9 }) });
  try {
    const r = await call(d.root, 'e2e_run_stop', {});
    assert.equal(stopped, 1);
    assert.equal(r.result.content[0].text, 'Đã dừng run.');
  } finally {
    d.close();
  }
});

test('server.json còn sót sau khi dashboard tắt: báo rõ cần mở lại dashboard', async () => {
  const d = await dashboard({ start: () => ({ ok: true }), stop: () => false, state: () => ({ running: false, pid: null }) });
  d.close();
  await new Promise((r) => setTimeout(r, 50));
  const r = await call(d.root, 'e2e_run_start', {});
  assert.match(r.result.content[0].text, /Không kết nối được dashboard.*mở lại \/e2e-dashboard/);
});
