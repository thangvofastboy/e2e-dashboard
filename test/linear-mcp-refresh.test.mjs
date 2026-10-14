import './_home.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';

const UI = fileURLToPath(new URL('../ui', import.meta.url));

// Nút "Kiểm tra lại" (Cài đặt hệ thống › Tích hợp): dò lại MCP Linear ngay, không dùng kết quả cũ trong cache
test('GET /api/linear?refresh=1 dò lại MCP Linear ngay; không có refresh thì dùng kết quả đã có', async () => {
  const seen = [];
  let connected = false;
  const mcpDetect = async ({ force = false } = {}) => {
    seen.push(force);
    return { connected, needsAuth: !connected, installed: true, prefixes: connected ? ['mcp__plugin_linear_linear'] : [], servers: [{ name: 'plugin:linear:linear', connected }] };
  };
  const env = { E2E_DASHBOARD_HOME: mkdtempSync(join(tmpdir(), 'e2ed-lmr-')) }; // không có LINEAR_API_KEY
  const server = http.createServer(createApp({ projectRoot: mkdtempSync(join(tmpdir(), 'e2ed-lmr-p-')), token: 't', uiDir: UI, live: createLive(), env, mcpDetect }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const get = (p) => fetch(`http://127.0.0.1:${server.address().port}${p}`, { headers: { 'x-e2e-dashboard-token': 't' } }).then((r) => r.json());
  try {
    assert.equal((await get('/api/linear')).mode, null);
    connected = true; // người dùng vừa đăng nhập MCP Linear
    const fresh = await get('/api/linear?refresh=1');
    assert.equal(fresh.mode, 'mcp');
    assert.equal(seen.at(-1), true, 'refresh=1 gọi dò với force');
    await get('/api/linear');
    assert.equal(seen.at(-1), false, 'không refresh thì không force');
  } finally {
    server.close();
  }
});
