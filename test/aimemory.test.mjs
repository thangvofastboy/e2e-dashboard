// AI ghi nhớ dự án: lưu bối cảnh (thư mục test, thư mục khác + mô tả) → AI đọc và viết bản ghi nhớ → gửi kèm mọi lần gọi AI.
import './_home.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLearner, contextHash, readMemory, learnPrompt, effectiveTestDir } from '../server/aimemory.mjs';
import { writeSettings, readSettings } from '../server/settings.mjs';
import { projectBlock } from '../server/ai.mjs';

const project = () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-mem-'));
  writeFileSync(join(root, 'e2e.config.ts'), "export default { tests: './tests/**/*.e2e.ts' };\n");
  mkdirSync(join(root, 'tests'));
  mkdirSync(join(root, 'backend'));
  return root;
};
const fakeAi = (reply, calls = []) => ({ calls, run: async (o) => {
  calls.push(o);
  o.onEvent({ type: 'text', text: 'Tôi sẽ đọc thư mục…' });
  o.onEvent({ type: 'done', result: reply });
} });

test('thư mục test: đặt thì dùng; không đặt thì đoán từ e2e.config / tests', async () => {
  const root = project();
  assert.deepEqual(await effectiveTestDir(root, await readSettings(root)), { path: 'tests', detected: true });
  await writeSettings(root, { testDir: 'backend' });
  assert.equal((await readSettings(root)).testDir, 'backend');
  assert.deepEqual(await effectiveTestDir(root, await readSettings(root)), { path: 'backend', detected: false });
  await assert.rejects(writeSettings(root, { testDir: 'khong-co' }), (e) => e.status === 400);
});

test('learn: prompt có thư mục test + thư mục khác + mô tả; lưu bản ghi nhớ (kết quả cuối, không phải lời dẫn); trạng thái ready → stale khi đổi', async () => {
  const root = project();
  await writeSettings(root, { sources: [{ path: 'backend', description: 'API NestJS' }] });
  const calls = [];
  const learner = createLearner({ aiFor: () => fakeAi('## Hệ thống làm gì\nBán hàng online', calls) });
  assert.equal((await learner.status(root)).state, 'none');
  const p = learner.learn(root);
  assert.equal((await learner.status(root)).state, 'learning');
  assert.equal(learner.learn(root), p); // đang đọc: không chạy lần hai
  await p;
  assert.match(calls[0].prompt, /Thư mục chứa test e2e: tests/);
  assert.match(calls[0].prompt, /- backend: API NestJS/);
  const st = await learner.status(root);
  assert.equal(st.state, 'ready');
  assert.equal(st.text, '## Hệ thống làm gì\nBán hàng online');
  await writeSettings(root, { sources: [{ path: 'backend', description: 'API NestJS + job nền' }] });
  assert.equal((await learner.status(root)).state, 'stale');
});

test('learn lỗi: giữ bản ghi nhớ cũ, ghi lại lỗi', async () => {
  const root = project();
  await createLearner({ aiFor: () => fakeAi('Bản cũ') }).learn(root);
  await createLearner({ aiFor: () => ({ run: async (o) => o.onEvent({ type: 'error', message: 'claude thoát với mã 1' }) }) }).learn(root);
  const m = await readMemory(root);
  assert.equal(m.text, 'Bản cũ');
  assert.equal(m.error, 'claude thoát với mã 1');
});

test('projectBlock gửi kèm thư mục test và bản ghi nhớ', () => {
  const b = projectBlock({ sources: [{ path: '../api', description: 'Backend' }], prompt: '', testDir: 'tests', memory: '## Hệ thống\nCRM' });
  assert.match(b, /Thư mục chứa test e2e: tests/);
  assert.match(b, /- \.\.\/api: Backend/);
  assert.match(b, /Ghi nhớ về hệ thống[\s\S]*CRM/);
  assert.equal(projectBlock({}), '');
  assert.match(learnPrompt({ testDir: '', sources: [], prompt: '' }), /tự tìm file \*\.e2e\.ts/);
  assert.notEqual(contextHash({ testDir: 'a' }), contextHash({ testDir: 'b' }));
});

test('API: GET / POST /api/project-context cho project đang mở và project trong danh sách; lưu là AI đọc lại; project lạ bị từ chối', async () => {
  const http = await import('node:http');
  const { createApp } = await import('../server/app.mjs');
  const { createLive } = await import('../server/live.mjs');
  const { registerProject } = await import('../server/projects.mjs');
  const root = project();
  const other = project();
  await registerProject(other);
  const calls = [];
  const learner = createLearner({ aiFor: (r) => fakeAi(`Ghi nhớ của ${r === other ? 'other' : 'root'}`, calls) });
  const server = http.createServer(createApp({ projectRoot: root, token: 't', uiDir: join(import.meta.dirname, '..', 'ui'), live: createLive(), learner }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const h = { 'x-e2e-dashboard-token': 't', 'content-type': 'application/json' };
  try {
    const cur = await (await fetch(`${base}/api/project-context`, { headers: h })).json();
    assert.equal(cur.root, root);
    assert.equal(cur.memory.inputs.testDir, 'tests');
    const saved = await (await fetch(`${base}/api/project-context`, { method: 'POST', headers: h, body: JSON.stringify({ root: other, testDir: 'tests', sources: [{ path: 'backend', description: 'API' }] }) })).json();
    assert.equal(saved.root, other);
    assert.equal(saved.memory.state, 'learning');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await readMemory(other)).text, 'Ghi nhớ của other');
    // lưu lại y nguyên: bối cảnh không đổi → không đọc lại
    await fetch(`${base}/api/project-context`, { method: 'POST', headers: h, body: JSON.stringify({ root: other, testDir: 'tests', sources: [{ path: 'backend', description: 'API' }] }) });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls.length, 1);
    // nút AI đọc lại: đọc kể cả khi không đổi
    await fetch(`${base}/api/project-memory/refresh`, { method: 'POST', headers: h, body: JSON.stringify({ root: other }) });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls.length, 2);
    const list = await (await fetch(`${base}/api/projects`, { headers: h })).json();
    assert.equal(list.projects.find((x) => x.root === other).ai.state, 'ready');
    // URL app / lệnh khởi động: ghi vào e2e.config.ts của đúng project đó, không đụng project đang mở
    writeFileSync(join(other, 'e2e.config.ts'), "export default {\n  tests: './tests/**/*.e2e.ts',\n  app: {\n    url: process.env.APP_URL ?? 'http://localhost:3000',\n  },\n};\n");
    const app = await (await fetch(`${base}/api/project-context`, { method: 'POST', headers: h, body: JSON.stringify({ root: other, appUrl: 'http://localhost:5173', command: 'npm run dev' }) })).json();
    assert.deepEqual(app.app, { file: 'e2e.config.ts', engine: null, appUrl: 'http://localhost:5173', appUrlEnv: 'APP_URL', bundleIds: [], platforms: [], command: 'npm run dev' });
    assert.match(readFileSync(join(other, 'e2e.config.ts'), 'utf8'), /url: process\.env\.APP_URL \?\? 'http:\/\/localhost:5173'/);
    assert.equal((await (await fetch(`${base}/api/project-context`, { headers: h })).json()).app.appUrl, null);
    assert.equal((await (await fetch(`${base}/api/projects`, { headers: h })).json()).projects.find((x) => x.root === other).appUrl, 'http://localhost:5173');
    const badUrl = await fetch(`${base}/api/project-context`, { method: 'POST', headers: h, body: JSON.stringify({ root: other, appUrl: 'ftp://x' }) });
    assert.equal(badUrl.status, 400);
    assert.match((await badUrl.json()).error, /URL không hợp lệ/);
    // một mục lỗi thì không ghi mục nào (URL hợp lệ đi kèm lệnh sai): config giữ nguyên
    const before = readFileSync(join(other, 'e2e.config.ts'), 'utf8');
    assert.equal((await fetch(`${base}/api/project-context`, { method: 'POST', headers: h, body: JSON.stringify({ root: other, appUrl: 'http://localhost:9999', command: 'npm run dev | tee log' }) })).status, 400);
    assert.equal(readFileSync(join(other, 'e2e.config.ts'), 'utf8'), before);
    // URL hợp lệ nhưng thư mục test sai: lỗi ở bước lưu bối cảnh, config chưa bị ghi
    assert.equal((await fetch(`${base}/api/project-context`, { method: 'POST', headers: h, body: JSON.stringify({ root: other, appUrl: 'http://localhost:9999', testDir: 'khong-co' }) })).status, 400);
    assert.equal(readFileSync(join(other, 'e2e.config.ts'), 'utf8'), before);
    const brief = await (await fetch(`${base}/api/projects/brief`, { headers: h })).json();
    assert.ok(brief.projects.some((x) => x.root === other && x.current === false && x.exists === true));
    const bad = await fetch(`${base}/api/project-context`, { method: 'POST', headers: h, body: JSON.stringify({ root: tmpdir(), testDir: '' }) });
    assert.equal(bad.status, 400);
    const badDir = await fetch(`${base}/api/project-context`, { method: 'POST', headers: h, body: JSON.stringify({ root, testDir: 'khong-co' }) });
    assert.equal(badDir.status, 400);
  } finally {
    server.close();
  }
});
