// Smoke: server thật — /api/resources trả đúng field mà dải tài nguyên trang Live đọc, bundle UI có dải + CSS.
import './_home.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';
import { resourcesHtml, pushSample } from '../ui/views/live.js';

const UI = fileURLToPath(new URL('../ui', import.meta.url));
const auth = { 'x-e2e-dashboard-token': 't' };
let server, base;
before(async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-smoke-res-'));
  writeFileSync(join(root, 'e2e.config.ts'), 'export default {};\n');
  server = http.createServer(createApp({ projectRoot: root, token: 't', uiDir: UI, live: createLive({ throttleMs: 1 }) }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('3 lần poll /api/resources → dải tài nguyên có CPU, RAM, Disk và sparkline', async () => {
  let hist = [];
  for (let i = 0; i < 3; i++) hist = pushSample(hist, await (await fetch(`${base}/api/resources`, { headers: auth })).json());
  const html = resourcesHtml(hist);
  assert.match(html, /CPU máy/);
  assert.match(html, /RAM máy/);
  assert.match(html, /Disk trống/);
  assert.match(html, /Chưa chạy/); // không có run: thẻ test chờ
  assert.equal((html.match(/<polyline/g) ?? []).length, 2);
});

test('bundle /app.js và /style.css có dải tài nguyên', async () => {
  assert.match(await (await fetch(`${base}/app.js`, { headers: auth })).text(), /res-strip/);
  assert.match(await (await fetch(`${base}/style.css`, { headers: auth })).text(), /\.res-card/);
});
