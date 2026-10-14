import './_home.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';
import { startServer } from '../server/main.mjs';
import { sharePush } from '../server/share.mjs';
import { listRuns } from '../server/store.mjs';

const TOKEN = 'tok-123';
const UI = fileURLToPath(new URL('../ui', import.meta.url));
const BASE = JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));
const auth = { 'x-e2e-dashboard-token': TOKEN, 'content-type': 'application/json' };
let server, base, root, runIds;

function put(r, rel, content) {
  mkdirSync(dirname(join(r, rel)), { recursive: true });
  writeFileSync(join(r, rel), content);
}

async function archiveRun(r, n) {
  const report = structuredClone(BASE);
  report.run.id = `018f0f5c-7b2a-7abc-8abc-${String(n).padStart(12, '0')}`;
  report.run.startedAt = new Date(Date.parse('2026-10-01T00:00:00Z') + n * 3600_000).toISOString();
  report.run.vcs = { commit: String(n).repeat(40).slice(0, 40), branch: 'main' };
  put(r, '.e2e/report.json', JSON.stringify(report));
  await archive(r, { source: 'hook' });
  return report.run.id;
}

const fakeAi = { run: async ({ onEvent }) => onEvent({ type: 'done', result: 'ok' }) };

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  runIds = [await archiveRun(root, 1), await archiveRun(root, 2)];
  server = http.createServer(createApp({ projectRoot: root, token: TOKEN, uiDir: UI, live: createLive({ throttleMs: 1 }), ai: fakeAi }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('token có ký tự ngoài ASCII cùng độ dài: 401, không phải 500', async () => {
  const res = await fetch(`${base}/?token=tok-12%C3%A9`, { redirect: 'manual' });
  assert.equal(res.status, 401);
  const h = await new Promise((ok) => http.get(`${base}/api/runs`, { headers: { 'x-e2e-dashboard-token': 'tok-12é' } }, (r) => ok(r.statusCode)));
  assert.equal(h, 401);
});

test('body JSON không phải object (null, số, chuỗi): 400, không phải TypeError 500', async () => {
  for (const body of ['null', '42', '"x"']) {
    for (const p of ['/api/timeline', '/api/reports/send', '/api/qc/notes']) {
      const res = await fetch(`${base}${p}`, { method: 'POST', headers: auth, body });
      assert.equal(res.status, 400, `${p} ${body}`);
    }
  }
});

test('AI run-summary với resultId không có trong run: không crash ở commitsFor', async () => {
  const res = await fetch(`${base}/api/ai/run-summary`, { method: 'POST', headers: auth, body: JSON.stringify({ runId: runIds[1], resultId: 'f'.repeat(64), refresh: true }) });
  const text = await res.text();
  assert.notEqual(res.status, 500, text);
  assert.doesNotMatch(text, /Cannot read properties of undefined/);
});

test('startServer không ghi xuyên qua symlink server.json cài sẵn trong repo', async () => {
  const r = mkdtempSync(join(tmpdir(), 'e2ed-'));
  const victim = join(mkdtempSync(join(tmpdir(), 'e2ed-victim-')), 'victim.txt');
  writeFileSync(victim, 'keep me');
  mkdirSync(join(r, '.e2e-dashboard'), { recursive: true });
  symlinkSync(victim, join(r, '.e2e-dashboard', 'server.json'));
  const s = await startServer({ projectRoot: r, port: 0, register: false });
  try {
    assert.equal(readFileSync(victim, 'utf8'), 'keep me');
    assert.equal(lstatSync(join(r, '.e2e-dashboard', 'server.json')).isSymbolicLink(), false);
    assert.equal(JSON.parse(readFileSync(join(r, '.e2e-dashboard', 'server.json'), 'utf8')).token, s.token);
  } finally {
    await s.close();
  }
});

test('startServer từ chối thư mục dữ liệu là symlink', async () => {
  const r = mkdtempSync(join(tmpdir(), 'e2ed-'));
  const elsewhere = mkdtempSync(join(tmpdir(), 'e2ed-else-'));
  symlinkSync(elsewhere, join(r, '.e2e-dashboard'));
  await assert.rejects(startServer({ projectRoot: r, port: 0, register: false }), /unsafe data dir/);
});

test('sharePush: một meta.json hỏng không làm dừng cả lần push', async () => {
  const r = mkdtempSync(join(tmpdir(), 'e2ed-'));
  await archiveRun(r, 3);
  await archiveRun(r, 4);
  const [newest] = await listRuns(r);
  writeFileSync(join(r, '.e2e-dashboard', 'runs', newest.dir, 'meta.json'), '{ hỏng');
  const team = mkdtempSync(join(tmpdir(), 'e2ed-team-'));
  const out = await sharePush(r, team);
  assert.equal(out.pushed, 1);
});
