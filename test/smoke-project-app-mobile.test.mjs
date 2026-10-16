// Smoke: server thật — URL app / bundleId lưu theo từng project, bộ đổi nhanh project trong bundle UI, project mobile
// (Quick Setup không đòi trình duyệt, form chạy ẩn ô trình duyệt).
import './_home.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';
import { registerProject } from '../server/projects.mjs';

const UI = fileURLToPath(new URL('../ui', import.meta.url));
const TOKEN = 'smoke-token';
const auth = { 'x-e2e-dashboard-token': TOKEN, 'content-type': 'application/json' };
let server, base, root, webRoot;
const ai = { run: async ({ onEvent }) => onEvent({ type: 'done', result: 'ok' }) };
const get = async (p) => (await fetch(base + p, { headers: auth })).json();
const post = (p, body) => fetch(base + p, { method: 'POST', headers: auth, body: JSON.stringify(body) });

before(async () => {
  // project đang mở: mobile (Android); project thứ hai: web
  root = mkdtempSync(join(tmpdir(), 'e2ed-smoke-mob-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { e2e: '1', '@e2e-dev/mobile': '1' } }));
  writeFileSync(join(root, 'e2e.config.ts'), "import { mobile } from '@e2e-dev/mobile';\nconst pixel = mobile({ platform: 'android' });\nexport default {\n  targets: [{ name: 'pixel', engine: pixel, app: { bundleId: 'com.android.settings' } }],\n};\n");
  webRoot = mkdtempSync(join(tmpdir(), 'e2ed-smoke-web-'));
  writeFileSync(join(webRoot, 'e2e.config.ts'), "import { web } from '@e2e-dev/web';\nexport default {\n  app: {\n    url: process.env.APP_URL ?? 'http://localhost:3000',\n  },\n};\n");
  await registerProject(root);
  await registerProject(webRoot);
  server = http.createServer(createApp({ projectRoot: root, token: TOKEN, uiDir: UI, live: createLive({ throttleMs: 1 }), ai }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('URL app của project khác lưu vào e2e.config của project đó; thẻ Projects hiện URL / bundleId', async () => {
  const r = await post('/api/project-context', { root: webRoot, appUrl: 'http://localhost:5173', command: 'npm run dev' });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).app.appUrl, 'http://localhost:5173');
  assert.match(readFileSync(join(webRoot, 'e2e.config.ts'), 'utf8'), /localhost:5173/);
  assert.doesNotMatch(readFileSync(join(root, 'e2e.config.ts'), 'utf8'), /localhost/);
  const { projects } = await get('/api/projects');
  assert.equal(projects.find((p) => p.root === webRoot).appUrl, 'http://localhost:5173');
  assert.equal(projects.find((p) => p.root === root).appUrl, 'com.android.settings');
  assert.equal((await post('/api/project-context', { root: webRoot, appUrl: 'javascript:alert(1)' })).status, 400);
});

test('project mobile: đọc / sửa bundleId; Quick Setup không có bước trình duyệt, có bước Android; form chạy biết mobileOnly', async () => {
  const cfg = await get('/api/system/e2e-config');
  assert.equal(cfg.engine, 'mobile');
  assert.deepEqual(cfg.platforms, ['android']);
  const r = await (await post('/api/system/e2e-config', { bundleId: 'com.example.shop' })).json();
  assert.deepEqual(r.changed, ['bundleId']);
  assert.deepEqual(r.bundleIds, ['com.example.shop']);
  const plan = await get('/api/system/quick-setup');
  const ids = plan.items.map((x) => x.id);
  assert.ok(ids.includes('android'), ids.join(','));
  assert.ok(!ids.includes('browsers'));
  assert.match(plan.items.find((x) => x.id === 'e2e').label, /@e2e-dev\/mobile/);
  assert.equal((await get('/api/settings')).browsers.mobileOnly, true);
});

test('bundle UI có bộ đổi nhanh project và ô bundleId', async () => {
  const js = await (await fetch(`${base}/app.js`, { headers: auth })).text();
  assert.match(js, /data-project-switch/);
  assert.match(js, /name="bundleId"/);
  assert.match(js, /mobileOnly/);
  const css = await (await fetch(`${base}/style.css`, { headers: auth })).text();
  assert.match(css, /\.nav-project/);
});
