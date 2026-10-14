// Đợt 2 (server): tài nguyên máy và tiến trình runner cho trang Live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePs, cpuPercent, machineResources, runnerResources } from '../server/resources.mjs';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';

const UI = fileURLToPath(new URL('../ui', import.meta.url));

test('parsePs: cộng RSS (MB) và %CPU của nhóm tiến trình, bỏ dòng lạ và pgid khác', () => {
  const out = [
    '  100   100  20480  12.5',
    '  101   100  10240   7.5',
    '  102   200  99999  50.0', // nhóm khác
    'rác không phải số',
    '  103   100  abc  1.0', // rss hỏng
    '',
  ].join('\n');
  assert.deepEqual(parsePs(out, 100), { rssMb: 30, cpuPct: 20, count: 2 });
  assert.deepEqual(parsePs('', 100), { rssMb: 0, cpuPct: 0, count: 0 });
});

test('cpuPercent: từ hai mẫu os.cpus()', () => {
  const s = (user, idle) => [{ times: { user, nice: 0, sys: 0, idle, irq: 0 } }, { times: { user, nice: 0, sys: 0, idle, irq: 0 } }];
  assert.equal(cpuPercent(s(100, 100), s(150, 150)), 50);
  assert.equal(cpuPercent(s(0, 0), s(0, 100)), 0);
  assert.equal(cpuPercent(s(0, 0), s(0, 0)), 0, 'không chia cho 0');
});

test('machineResources: đủ khoá', async () => {
  const m = await machineResources(process.cwd(), { sampleMs: 10 });
  for (const k of ['cores', 'cpuModel', 'cpuPct', 'loadavg', 'memTotal', 'memFree', 'diskTotal', 'diskFree']) assert.ok(k in m, k);
  assert.ok(m.cores >= 1);
});

test('runnerResources: không có pid / Windows / thiếu ps → null kèm lý do', async () => {
  assert.equal(await runnerResources(null), null);
  assert.deepEqual(await runnerResources(5, { platform: 'win32' }), { unavailable: 'không đo được' });
  assert.deepEqual(await runnerResources(5, { platform: 'linux', exec: async () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); } }), { unavailable: 'không đo được' });
  assert.deepEqual(await runnerResources(5, { platform: 'linux', exec: async () => '5 5 2048 3.0\n' }), { rssMb: 2, cpuPct: 3, count: 1 });
});

test('GET /api/resources cần token và trả machine + app', async () => {
  const runner = { start: () => ({ ok: false }), stop: () => false, state: () => ({ running: false, pid: null }) };
  const server = http.createServer(createApp({ projectRoot: mkdtempSync(join(tmpdir(), 'e2ed-b2r-')), token: 't', uiDir: UI, live: createLive(), runner }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/resources`)).status, 401);
    const body = await (await fetch(`${base}/api/resources`, { headers: { 'x-e2e-dashboard-token': 't' } })).json();
    assert.ok(body.machine.cores >= 1);
    assert.ok(body.app.dashboard.rssMb > 0);
    assert.ok('cpuPct' in body.app.dashboard);
    assert.equal(body.app.runner, null, 'không có run đang chạy');
    const sys = await (await fetch(`${base}/api/system`, { headers: { 'x-e2e-dashboard-token': 't' } })).json();
    assert.ok(sys.hostname && sys.arch, 'bảng Cấu hình máy cần hostname + arch');
  } finally {
    server.close();
  }
});
