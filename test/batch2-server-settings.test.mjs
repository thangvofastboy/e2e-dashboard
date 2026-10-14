// Đợt 2 (server): headed, thư mục nguồn + prompt dự án trong Settings, /api/settings và /api/run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSettings, writeSettings, normalizeSources } from '../server/settings.mjs';
import { buildRunArgs } from '../server/runner.mjs';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';

const UI = fileURLToPath(new URL('../ui', import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'e2ed-b2-'));

test('buildRunArgs: --headed chỉ khi headed true, sai kiểu thì lỗi', () => {
  assert.ok(buildRunArgs({ headed: true }).includes('--headed'));
  assert.ok(!buildRunArgs({ headed: false }).includes('--headed'));
  assert.ok(!buildRunArgs({}).includes('--headed'));
  assert.throws(() => buildRunArgs({ headed: 'yes' }), /invalid headed/);
});

test('settings headed: mặc định false, lưu được, sai kiểu → 400', async () => {
  const root = tmp();
  assert.equal((await readSettings(root)).headed, false);
  assert.equal((await writeSettings(root, { headed: true })).headed, true);
  assert.equal((await readSettings(root)).headed, true);
  await assert.rejects(writeSettings(root, { headed: 'on' }), (e) => e.status === 400);
});

test('settings sources + prompt: chuẩn hoá và từ chối dữ liệu sai', async () => {
  const root = tmp();
  mkdirSync(join(root, 'backend'));
  const outside = tmp();
  symlinkSync(outside, join(root, 'link-out'));
  const s = await readSettings(root);
  assert.deepEqual(s.sources, []);
  assert.equal(s.prompt, '');
  const saved = await writeSettings(root, { sources: [{ path: ' backend ', description: ' API Go ' }, { path: outside, description: '' }], prompt: 'Rule: luôn đăng nhập trước' });
  assert.deepEqual(saved.sources, [{ path: 'backend', description: 'API Go' }, { path: outside, description: '' }]);
  assert.equal((await readSettings(root)).prompt, 'Rule: luôn đăng nhập trước');
  const bad = (patch) => assert.rejects(writeSettings(root, patch), (e) => e.status === 400);
  await bad({ sources: [{ path: 'khong-ton-tai', description: '' }] });
  await bad({ sources: [{ path: 'link-out', description: '' }] }); // symlink ra ngoài project
  await bad({ sources: [{ path: '../', description: '' }] });
  await bad({ sources: Array.from({ length: 21 }, () => ({ path: 'backend', description: '' })) });
  await bad({ sources: [{ path: 'backend', description: 'x'.repeat(501) }] });
  await bad({ sources: 'backend' });
  await bad({ prompt: 'x'.repeat(8001) });
  await bad({ prompt: 3 });
  // file có đường dẫn: không phải thư mục
  await assert.rejects(normalizeSources(root, [{ path: 'settings.json', description: '' }]), (e) => e.status === 400);
});

async function serve(runner, root = tmp()) {
  const server = http.createServer(createApp({ projectRoot: root, token: 't', uiDir: UI, live: createLive(), runner }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'x-e2e-dashboard-token': 't', origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { server, base, post, root };
}

test('/api/settings nhận headed / sources / prompt, sai thì 400; /api/run lấy headed từ Settings', async () => {
  const started = [];
  const runner = { start: (o) => (started.push(o), { ok: true, pid: 1 }), stop: () => false, state: () => ({ running: false, pid: null }) };
  const { server, post, root } = await serve(runner);
  mkdirSync(join(root, 'web'));
  try {
    assert.equal((await post('/api/settings', { headed: 'x' })).status, 400);
    assert.equal((await post('/api/settings', { sources: [{ path: 'nope', description: '' }] })).status, 400);
    assert.equal((await post('/api/settings', { prompt: 'x'.repeat(9000) })).status, 400);
    const ok = await post('/api/settings', { headed: true, sources: [{ path: 'web', description: 'Frontend' }], prompt: 'p' });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.headed, true);
    assert.deepEqual(body.sources, [{ path: 'web', description: 'Frontend' }]);
    await post('/api/run', {});
    assert.equal(started[0].headed, true, 'không gửi headed → lấy mặc định Settings');
    await post('/api/run', { headed: false });
    assert.equal(started[1].headed, false, 'gửi headed thì đè Settings');
  } finally {
    server.close();
  }
});

test('một thư mục nguồn biến mất: đọc bỏ riêng dòng đó, lưu setting khác không xoá danh sách trên đĩa', async () => {
  const { mkdtempSync: mk, mkdirSync: md, rmSync: rm, readFileSync: rf } = await import('node:fs');
  const { join: j } = await import('node:path');
  const { tmpdir: td } = await import('node:os');
  const { readSettings: read, writeSettings: write } = await import('../server/settings.mjs');
  const root = mk(j(td(), 'e2ed-src-keep-'));
  md(j(root, 'a'));
  md(j(root, 'b'));
  await write(root, { sources: [{ path: 'a', description: 'backend' }, { path: 'b', description: 'frontend' }] });
  rm(j(root, 'b'), { recursive: true });
  assert.deepEqual((await read(root)).sources, [{ path: 'a', description: 'backend' }], 'chỉ bỏ dòng hỏng');
  await write(root, { workers: 2 });
  md(j(root, 'b'));
  assert.equal((await read(root)).sources.length, 2, 'thư mục quay lại thì danh sách còn nguyên');
  const raw = JSON.parse(rf(j(root, '.e2e-dashboard', 'state', 'settings.json'), 'utf8'));
  assert.equal(raw.sources.length, 2);
});

test('thư mục nguồn không được là / hay thư mục home (AI đọc được cả máy)', async () => {
  const { mkdtempSync: mk } = await import('node:fs');
  const { join: j } = await import('node:path');
  const { tmpdir: td, homedir } = await import('node:os');
  const { writeSettings: write } = await import('../server/settings.mjs');
  const root = mk(j(td(), 'e2ed-src-root-'));
  for (const path of ['/', homedir()]) await assert.rejects(write(root, { sources: [{ path, description: 'x' }] }), /không hợp lệ|quá rộng/, path);
});
