// Đợt 2 (server): bối cảnh dự án trong prompt, --add-dir, model / effort đè từng lần gọi, action quality-review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';
import { result, run } from './_history.mjs';
import { buildPrompt, createAi, cacheKey, AI_ARGS, qualityEvidence, projectBlock } from '../server/ai.mjs';

function fakeClaude() {
  const spawned = [];
  const spawnImpl = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({ write(_c, _e, cb) { cb(); } });
    child.kill = () => child.emit('close', null);
    spawned.push({ cmd, args });
    setImmediate(() => { child.stdout.end(); child.emit('close', 0); });
    return child;
  };
  return { spawned, spawnImpl };
}

const project = { sources: [{ path: 'backend', description: 'API Go, có auth' }], prompt: 'Luôn đăng nhập bằng tài khoản qa@x' };

test('projectBlock: danh sách thư mục + mô tả + Prompt, bị cắt; rỗng thì chuỗi rỗng', () => {
  const b = projectBlock(project);
  assert.match(b, /^Bối cảnh dự án \(người dùng viết\)/);
  assert.match(b, /- backend: API Go, có auth/);
  assert.match(b, /Luôn đăng nhập bằng tài khoản qa@x/);
  assert.equal(projectBlock({ sources: [], prompt: '' }), '');
  assert.equal(projectBlock(null), '');
  assert.ok(projectBlock({ sources: [], prompt: 'x'.repeat(20_000) }).length < 9_000);
});

test('ai.run: bối cảnh dự án qua --append-system-prompt và --add-dir mỗi lần gọi; rỗng thì không có', async () => {
  const { spawned, spawnImpl } = fakeClaude();
  await createAi({ projectRoot: '/p', spawnImpl, project: async () => project }).run({ prompt: 'x', onEvent: () => {} });
  const a = spawned[0].args;
  assert.deepEqual(a.slice(0, AI_ARGS.length), AI_ARGS);
  assert.equal(a[a.indexOf('--append-system-prompt') + 1], projectBlock(project));
  assert.deepEqual(a.filter((x, i) => a[i - 1] === '--add-dir'), ['/p/backend'], 'đường dẫn tương đối tính theo project');
  await createAi({ projectRoot: '/p', spawnImpl, project: () => ({ sources: [], prompt: '' }) }).run({ prompt: 'x', onEvent: () => {} });
  assert.ok(!spawned[1].args.includes('--append-system-prompt'));
  assert.ok(!spawned[1].args.includes('--add-dir'));
  await createAi({ projectRoot: '/p', spawnImpl }).run({ prompt: 'x', onEvent: () => {} });
  assert.deepEqual(spawned[2].args, AI_ARGS, 'không có project() thì args như cũ');
});

test('ai.run: model / effort đè từng lần gọi, giá trị sai bị bỏ', async () => {
  const { spawned, spawnImpl } = fakeClaude();
  const ai = createAi({ projectRoot: '/p', spawnImpl, settings: () => ({ model: 'sonnet', effort: 'low' }) });
  await ai.run({ prompt: 'x', onEvent: () => {} });
  const a0 = spawned[0].args;
  assert.equal(a0[a0.indexOf('--model') + 1], 'sonnet');
  await ai.run({ prompt: 'x', onEvent: () => {}, model: 'opus', effort: 'max' });
  const a1 = spawned[1].args;
  assert.equal(a1[a1.indexOf('--model') + 1], 'opus');
  assert.equal(a1[a1.indexOf('--effort') + 1], 'max');
  assert.equal(a1.filter((x) => x === '--model').length, 1);
  await ai.run({ prompt: 'x', onEvent: () => {}, model: '--evil', effort: 'turbo' });
  const a2 = spawned[2].args;
  assert.equal(a2[a2.indexOf('--model') + 1], 'sonnet');
  assert.equal(a2[a2.indexOf('--effort') + 1], 'low');
});

test('cacheKey: biến thể model+effort cho khoá khác, không có thì giữ khoá cũ', () => {
  assert.equal(cacheKey('a', 'r', 'x', ''), cacheKey('a', 'r', 'x'));
  assert.notEqual(cacheKey('a', 'r', 'x', 'opus|max'), cacheKey('a', 'r', 'x'));
  assert.notEqual(cacheKey('a', 'r', 'x', 'opus|max'), cacheKey('a', 'r', 'x', 'opus|low'));
});

test('quality-review: bằng chứng có điểm, lý do trừ điểm và đường dẫn file', () => {
  const rows = [{ title: 'Giỏ hàng', file: 'tests/cart.e2e.ts', target: 'web', status: 'passed', score: 60, grade: 'C', checks: [{ id: 'no-assert', penalty: 30, text: 'Không có bước kiểm tra' }, { id: 'slow', penalty: 10, text: 'Chạy 70 giây' }] }];
  const ev = qualityEvidence({ runId: 'r1', rows });
  const p = buildPrompt('quality-review', { evidence: ev });
  assert.match(p, /tests\/cart\.e2e\.ts/);
  assert.match(p, /60/);
  assert.match(p, /Không có bước kiểm tra \(-30\)/);
  assert.match(p, /Chạy 70 giây \(-10\)/);
  assert.match(p, /## Nhận xét từng test/);
  assert.match(p, /## Gợi ý sửa theo thứ tự ưu tiên/);
});

test('POST /api/ai/quality-review: chạy AI với model / effort, cache theo biến thể, refresh bỏ cache', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-b2q-'));
  await archive(root, { source: 'test', report: run({ results: [result({ testId: 'cart' })] }).report });
  const calls = [];
  const ai = { run: async (o) => { calls.push(o); o.onEvent({ type: 'done', result: 'ok' }); } };
  const server = http.createServer(createApp({ projectRoot: root, token: 't', uiDir: fileURLToPath(new URL('../ui', import.meta.url)), live: createLive(), ai }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (body) => (await fetch(`${base}/api/ai/quality-review`, { method: 'POST', headers: { 'x-e2e-dashboard-token': 't', 'content-type': 'application/json' }, body: JSON.stringify(body) })).text();
  try {
    await post({ model: 'opus', effort: 'high' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, 'opus');
    assert.equal(calls[0].effort, 'high');
    assert.match(calls[0].prompt, /file: tests\/example\.e2e\.ts/);
    assert.match(calls[0].prompt, /trừ điểm: .*\(-30\)/);
    assert.match(await post({ model: 'opus', effort: 'high' }), /"cached"/);
    assert.equal(calls.length, 1, 'cùng model + effort: lấy cache');
    await post({ model: 'opus', effort: 'low' });
    assert.equal(calls.length, 2, 'effort khác: khoá cache khác');
    await post({ model: 'opus', effort: 'high', refresh: true });
    assert.equal(calls.length, 3, 'refresh bỏ cache');
  } finally {
    server.close();
  }
});
