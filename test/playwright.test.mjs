import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runnerFor, playwrightArgs, playwrightToReport, playwrightJsonPath } from '../server/playwright.mjs';
import { createRunner } from '../server/runner.mjs';
import { createLive } from '../server/live.mjs';
import { finishDashboardRun } from '../server/main.mjs';
import { listRuns, loadHistory } from '../server/store.mjs';

// JSON reporter thu gọn theo JSONReport (@playwright/test 1.61): config ở thư mục con (rootDir sâu hơn project),
// describe lồng nhau, một test retry rồi qua (flaky), một test timedOut, một test skip
const PROJECT = '/p';
const pwJson = (root = PROJECT) => ({
  config: { rootDir: join(root, 'e2e'), version: '1.61.0' },
  suites: [{
    title: 'login.spec.ts', file: 'login.spec.ts', line: 0, column: 0, specs: [],
    suites: [{
      title: 'Đăng nhập', file: 'login.spec.ts', line: 3, column: 1, specs: [
        { title: 'đúng mật khẩu', file: 'login.spec.ts', line: 4, column: 3, tags: ['@smoke'], tests: [{ projectName: 'chromium', status: 'flaky', annotations: [], results: [
          { status: 'failed', duration: 1200, startTime: '2026-10-16T03:00:00.000Z', error: { message: '\x1b[31mexpect(locator).toBeVisible() failed\x1b[39m', stack: 'Error: …' }, errors: [], steps: [{ title: 'page.goto', duration: 300 }] },
          { status: 'passed', duration: 900, startTime: '2026-10-16T03:00:02.000Z', errors: [], steps: [{ title: 'page.goto', duration: 200, steps: [{ title: 'route', duration: 5 }] }] },
        ] }] },
        { title: 'sai mật khẩu', file: 'login.spec.ts', line: 9, column: 3, tags: [], tests: [{ projectName: 'chromium', status: 'unexpected', annotations: [], results: [
          { status: 'timedOut', duration: 30000, startTime: '2026-10-16T03:00:05.000Z', error: { message: 'Test timeout of 30000ms exceeded.' }, errors: [], steps: [] },
        ] }] },
      ],
      suites: [{ title: 'Quên mật khẩu', file: 'login.spec.ts', line: 14, column: 3, specs: [
        { title: 'gửi mail', file: 'login.spec.ts', line: 15, column: 5, tags: [], tests: [{ projectName: '', status: 'skipped', annotations: [{ type: 'skip', description: 'chưa có MailCrab' }], results: [{ status: 'skipped', duration: 0, startTime: '2026-10-16T03:00:40.000Z', errors: [], steps: [] }] }] },
      ] }],
    }],
  }],
  errors: [],
  stats: { startTime: '2026-10-16T03:00:00.000Z', duration: 41000, expected: 0, unexpected: 1, flaky: 1, skipped: 1 },
});

test('runnerFor: toàn file không phải *.e2e.ts → playwright; trộn → mixed; trống / toàn e2e → e2e', async () => {
  assert.equal(runnerFor(['TestCases/a.spec.ts', 'b.spec.ts:12']), 'playwright');
  assert.equal(runnerFor(['a.spec.ts', 'b.e2e.ts']), 'mixed');
  assert.equal(runnerFor(['b.e2e.ts:3']), 'e2e');
  assert.equal(runnerFor(undefined), 'e2e');
  assert.equal(runnerFor(['tests/smoke', 'TestCases/05_Billing']), 'e2e'); // thư mục: vẫn e2e như trước
  // target → --project (bỏ 'web' = test không thuộc project); cách ly: một --grep-invert kèm tên file
  const { quarantineFlags } = await import('../server/quarantine.mjs');
  const until = new Date(Date.now() + 86_400_000).toISOString();
  const q = quarantineFlags([{ key: 'k1|chromium|default', title: 'works', file: 'tests/a.spec.ts', until }, { key: 'k2|web|default', title: 'Đăng nhập › đúng (x)', file: 'e2e/login.spec.ts', until }]);
  const a = playwrightArgs({ tests: ['a.spec.ts'], targets: ['firefox', 'web'], grepInvertPw: q.pw });
  assert.deepEqual(a.slice(0, 5), ['test', 'a.spec.ts', '--reporter=line,json', '--project', 'firefox']);
  const re = new RegExp(a[a.indexOf('--grep-invert') + 1]);
  assert.ok(re.test(' chromium a.spec.ts works'));
  assert.ok(re.test(' chromium tests/a.spec.ts works @smoke'));
  assert.ok(!re.test(' chromium b.spec.ts Login works')); // cùng tên test, file khác: không bị cách ly
  assert.ok(re.test(' webkit login.spec.ts Đăng nhập đúng (x)'));
  assert.ok(!re.test(' webkit login.spec.ts Đăng nhập đúng (x) 2'));
  assert.equal(playwrightArgs({ tests: ['a.spec.ts'] }).includes('--grep-invert'), false);
  assert.deepEqual(playwrightArgs({ tests: ['a.spec.ts'], retries: 1, workers: 2, headed: true }), ['test', 'a.spec.ts', '--reporter=line,json', '--retries', '1', '--workers', '2', '--headed']);
});

test('playwrightToReport: mỗi test case một result, đường dẫn tương đối project, testId giống junit, trạng thái + lỗi', () => {
  const r = playwrightToReport(pwJson(), PROJECT);
  assert.equal(r.schemaVersion, 'report-1');
  assert.match(r.run.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(playwrightToReport(pwJson(), PROJECT).run.id, r.run.id); // cùng JSON vẫn là run khác
  const [a, b, c] = r.run.results;
  assert.equal(a.file, 'e2e/login.spec.ts');
  assert.deepEqual(a.titlePath, ['Đăng nhập', 'đúng mật khẩu']);
  assert.equal(a.testId, `e2e/login.spec.ts::${encodeURIComponent('Đăng nhập > đúng mật khẩu')}`);
  assert.match(a.id, /^[0-9a-f]{64}$/);
  assert.deepEqual([a.status, b.status, c.status], ['flaky', 'failed', 'skipped']);
  assert.deepEqual(a.tags, ['smoke']);
  assert.equal(a.targetId, 'chromium');
  assert.equal(c.targetId, 'web');
  assert.equal(a.attempts.length, 2);
  assert.equal(a.attempts[0].error.message, 'expect(locator).toBeVisible() failed'); // bỏ mã màu
  assert.deepEqual(a.attempts[1].steps.map((s) => s.label), ['page.goto', 'route']);
  assert.equal(b.attempts[0].error.code, 'TIMEOUT');
  assert.deepEqual(c.titlePath, ['Đăng nhập', 'Quên mật khẩu', 'gửi mail']);
  assert.equal(c.attempts[0].skip.reason, 'chưa có MailCrab');
  assert.deepEqual(r.run.summary, { discovered: 3, selected: 3, executed: 2, passed: 0, failed: 1, interrupted: 0, flaky: 1, skipped: 1 });
  assert.equal(r.run.status, 'failed');
  assert.equal(r.run.finishedAt, '2026-10-16T03:00:41.000Z');
  assert.throws(() => playwrightToReport({ suites: [], errors: [] }, PROJECT), /không chạy test nào/);
});

function fakeSpawn() {
  const calls = [];
  const spawnImpl = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 4243;
    calls.push({ cmd, args, opts, child });
    return child;
  };
  return { calls, spawnImpl };
}

test('runner: file *.spec.ts chạy bằng Playwright của project (JSON ra file); trộn với *.e2e.ts thì từ chối; thiếu @playwright/test thì báo', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-pw-'));
  const { calls, spawnImpl } = fakeSpawn();
  const exits = [];
  const runner = createRunner({ projectRoot: root, live: createLive({ throttleMs: 1 }), spawnImpl, onExit: (r) => exits.push(r), resolveBin: () => 'E2E', resolvePwBin: () => 'PW' });
  assert.deepEqual(runner.start({ tests: ['a.spec.ts', 'b.e2e.ts'] }), { ok: false, error: 'mixed-runners' });
  assert.equal(runner.start({ tests: ['TestCases/a.spec.ts'], retries: 1 }).ok, true);
  const c = calls[0];
  assert.deepEqual(c.args, ['PW', 'test', 'TestCases/a.spec.ts', '--reporter=line,json', '--retries', '1']);
  assert.equal(c.opts.env.PLAYWRIGHT_JSON_OUTPUT_FILE, playwrightJsonPath(root));
  c.child.emit('close', 1);
  assert.equal(exits[0].playwrightJson, playwrightJsonPath(root));
  const none = createRunner({ projectRoot: root, live: createLive({ throttleMs: 1 }), spawnImpl, resolvePwBin: () => null });
  assert.deepEqual(none.start({ tests: ['a.spec.ts'] }), { ok: false, error: 'playwright-missing' });
});

test('finishDashboardRun: JSON Playwright thành run trong lịch sử, gắn launchedBy; không có JSON thì không lưu gì', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-pw-fin-'));
  const json = playwrightJsonPath(root);
  assert.equal(await finishDashboardRun({ projectRoot: root, playwrightJson: json }), null);
  mkdirSync(join(root, '.e2e-dashboard', 'runtime'), { recursive: true });
  writeFileSync(json, JSON.stringify(pwJson(root)));
  const archived = [];
  const id = await finishDashboardRun({ projectRoot: root, playwrightJson: json, onArchived: (r) => archived.push(r) });
  assert.ok(id);
  assert.equal(archived[0].status, 'archived');
  const [meta] = await listRuns(root);
  assert.equal(meta.runId, id);
  assert.equal(meta.launchedBy, 'dashboard');
  assert.deepEqual([meta.summary.failed, meta.summary.flaky, meta.summary.skipped], [1, 1, 1]);
  const [h] = await loadHistory(root, 1);
  assert.equal(h.report.run.results[0].file, 'e2e/login.spec.ts');
  assert.ok(existsSync(json) && readFileSync(json, 'utf8').length);
});
