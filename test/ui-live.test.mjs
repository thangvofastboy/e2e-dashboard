import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ganttBlocks, stripAnsi } from '../ui/views/live.js';
import { historyCells } from '../ui/views/tests.js';

test('ganttBlocks places tests on their lane as % of elapsed run time', () => {
  const t0 = Date.parse('2026-07-24T12:00:00Z');
  const snap = {
    startedAt: new Date(t0).toISOString(), finishedAt: null,
    tests: [
      { key: 'a', lane: 0, status: 'passed', title: 'A', startedAt: new Date(t0).toISOString(), finishedAt: new Date(t0 + 5000).toISOString(), durationMs: 5000 },
      { key: 'b', lane: 1, status: 'running', title: 'B', startedAt: new Date(t0 + 5000).toISOString(), finishedAt: null, durationMs: null },
    ],
  };
  const blocks = ganttBlocks(snap, t0 + 10_000);
  assert.deepEqual(blocks.map((b) => [b.key, b.lane, b.left, b.width]), [['a', 0, 0, 50], ['b', 1, 50, 50]]);
  assert.equal(blocks[1].durationMs, 5000);
  assert.deepEqual(ganttBlocks({ startedAt: null, tests: [] }), []);
});

test('stripAnsi drops colour codes and control chars, keeps newlines and tabs', () => {
  assert.equal(stripAnsi('\x1b[1m\x1b[41m FAIL \x1b[49m\x1b[22m web\r\n\tline\x07'), ' FAIL  web\n\tline');
  assert.equal(stripAnsi(undefined), '');
  assert.equal(stripAnsi('see \x1b]8;;https://x.dev/a\x07trace\x1b]8;;\x07 now'), 'see trace now');
  assert.equal(stripAnsi('\x1b]8;;https://x.dev\x1b\\link\x1b]8;;\x1b\\'), 'link');
});

test('historyCells pads to n, oldest first, links each run', () => {
  const html = historyCells([{ runId: 'new', status: 'failed' }, { runId: 'old', status: 'passed' }], 4);
  assert.equal((html.match(/class="cell/g) ?? []).length, 4);
  assert.ok(html.indexOf('#/run/old') < html.indexOf('#/run/new'));
  assert.match(html, /s-failed/);
});

test('testRowHtml escapes the source line from a tampered report', async () => {
  const { testRowHtml } = await import('../ui/views/tests.js');
  const html = testRowHtml({ title: 't', line: '<img src=x onerror=alert(1)>', tags: [], target: 'web', agent: 'default', history: [], avgDurationMs: null });
  assert.doesNotMatch(html, /<img/);
});

test('liveCounts: đếm pass/fail/đang chạy/còn lại; fail gồm timed-out và error', async () => {
  const { liveCounts } = await import('../ui/views/live.js');
  const tests = [{ status: 'passed' }, { status: 'failed' }, { status: 'error' }, { status: 'skipped' }, { status: 'flaky' }, { status: 'running' }, { status: 'running' }];
  const c = liveCounts({ total: 10, done: 5, tests });
  assert.deepEqual(c, { total: 10, done: 5, passed: 1, failed: 2, flaky: 1, skipped: 1, running: 2, remaining: 3, pct: 50 });
  assert.equal(liveCounts({ total: 0, done: 0, tests: [] }).pct, 0);
  assert.equal(liveCounts({ total: 2, done: 2, tests: [{ status: 'running' }] }).remaining, 0); // không âm
});

test('kpiHtml + progressHtml: 4 ô số liệu, thanh chia đoạn theo kết quả', async () => {
  const { liveCounts, kpiHtml, progressHtml } = await import('../ui/views/live.js');
  const c = liveCounts({ total: 10, done: 4, tests: [{ status: 'passed' }, { status: 'passed' }, { status: 'failed' }, { status: 'skipped' }, { status: 'running' }] });
  const k = kpiHtml(c);
  for (const label of ['Pass', 'Fail', 'Đang chạy', 'Còn lại']) assert.match(k, new RegExp(label));
  assert.match(k, /kpi-bad[^]*>1</);
  const p = progressHtml(c, true);
  assert.match(p, /seg-passed" style="width:20%"/);
  assert.match(p, /seg-failed" style="width:10%"/);
  assert.match(p, /seg-running" style="width:10%"/);
  assert.match(p, /4\/10 · 40%/);
  assert.doesNotMatch(p, /seg-flaky/); // đoạn 0% không vẽ
});

test('runningHtml: test đang chạy theo làn, thời gian chạy, việc đang làm; trống thì có câu báo', async () => {
  const { runningHtml } = await import('../ui/views/live.js');
  const now = Date.parse('2026-10-15T10:00:42Z');
  const html = runningHtml([
    { key: 'b', title: 'search', status: 'running', lane: 1, startedAt: '2026-10-15T10:00:30Z', steps: [{ api: 'agent.act', label: 'gõ từ khoá' }] },
    { key: 'a', title: 'checkout', status: 'running', lane: 0, startedAt: '2026-10-15T10:00:00Z', activity: 'agent.act Thanh toán' },
    { key: 'c', title: 'login', status: 'passed', lane: 2 },
  ]);
  assert.ok(html.indexOf('checkout') < html.indexOf('search')); // W1 trước W2
  assert.match(html, /W1/);
  assert.match(html, /data-since="2026-10-15T10:00:00Z"/);
  assert.equal(runningHtml([{ key: 'a', title: 'x', status: 'running', lane: 0, startedAt: '2026-10-15T10:00:00Z' }]), runningHtml([{ key: 'a', title: 'x', status: 'running', lane: 0, startedAt: '2026-10-15T10:00:00Z' }])); // HTML không đổi theo giờ
  const { tickClocks } = await import('../ui/views/live.js');
  const el = (d) => ({ dataset: d, textContent: '' });
  const els = [el({ since: '2026-10-15T10:00:00Z' }), el({ elapsed: '2026-10-15T09:59:00Z', until: '2026-10-15T10:00:05Z' }), el({ since: 'rác' })];
  tickClocks({ querySelectorAll: () => els }, now);
  assert.deepEqual(els.map((e) => e.textContent), ['0:42', '1:05', '']);
  assert.match(html, /agent\.act Thanh toán/);
  assert.match(html, /gõ từ khoá/);
  assert.doesNotMatch(html, /login/);
  assert.match(runningHtml([]), /Không có test nào đang chạy/);
});

test('blockers surfaces failed setups and errors repeated in ≥3 tests', async () => {
  const { blockers } = await import('../ui/views/live.js');
  const f = (key, file, message) => ({ key, file, title: key, status: 'failed', error: { message } });
  const tests = [
    f('setup::a', 'tests/auth.setup.e2e.ts', 'no auth file'),
    ...[1, 2, 3].map((i) => f(`t${i}`, 'x.e2e.ts', 'ENOENT ticket')),
    f('t9', 'y.e2e.ts', 'one-off'),
    { key: 'p', status: 'passed', error: null },
  ];
  const b = blockers(tests);
  assert.deepEqual(b.map((g) => [g.message, g.count, g.setups.length]), [['no auth file', 1, 1], ['ENOENT ticket', 3, 0]]);
  assert.deepEqual(blockers([f('t1', 'x.e2e.ts', 'one-off')]), []);
});

test('axisTicks picks a round step with at most 7 ticks', async () => {
  const { axisTicks } = await import('../ui/views/live.js');
  assert.deepEqual(axisTicks(0), [{ pct: 0, label: '0s' }]);
  const t = axisTicks(25_000);
  assert.deepEqual(t.map((x) => x.pct), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(t.map((x) => x.label), ['0s', '5s', '10s', '15s', '20s', '25s']);
  assert.equal(axisTicks(600_000).at(-1).label, '10m');
  assert.ok(axisTicks(3_600_000 * 5).length <= 7);
});

test('applyLive: full replaces, patch upserts tests in place and appends output (last 50)', async () => {
  const { applyLive } = await import('../ui/api.js');
  let s = applyLive(null, { kind: 'full', status: 'running', done: 0, tests: [{ key: 'a', status: 'running' }], output: [{ text: 'o0' }] });
  s = applyLive(s, { kind: 'patch', status: 'running', done: 1, tests: [{ key: 'a', status: 'passed' }, { key: 'b', status: 'running' }], output: Array.from({ length: 60 }, (_, i) => ({ text: `p${i}` })) });
  assert.deepEqual(s.tests.map((t) => `${t.key}:${t.status}`), ['a:passed', 'b:running']);
  assert.equal(s.done, 1);
  assert.equal(s.output.length, 50);
  assert.equal(s.output.at(-1).text, 'p59');
  const same = applyLive(s, { kind: 'patch', status: 'finished', tests: [], output: [] });
  assert.equal(same.output, s.output);
  assert.equal(same.status, 'finished');
  assert.deepEqual(applyLive(s, { kind: 'full', status: 'running', tests: [], output: [] }).tests, []);
  assert.deepEqual(applyLive(s, { status: 'idle', done: 0 }).tests, []); // lite
});

test('applyLive drops output lines the client already has (full then overlapping patch)', async () => {
  const { applyLive } = await import('../ui/api.js');
  let s = applyLive(null, { kind: 'full', tests: [], output: [{ seq: 1, text: 'a' }, { seq: 2, text: 'b' }] });
  s = applyLive(s, { kind: 'patch', tests: [], output: [{ seq: 2, text: 'b' }, { seq: 3, text: 'c' }] });
  assert.deepEqual(s.output.map((o) => o.text), ['a', 'b', 'c']);
  assert.deepEqual(applyLive(s, { kind: 'patch' }).output.length, 3); // patch thiếu tests / output không lỗi
});

test('failedHtml: run fail hàng loạt chỉ vẽ FAILED_MAX dòng và báo số còn lại', async () => {
  const { failedHtml, FAILED_MAX } = await import('../ui/views/live.js');
  const tests = Array.from({ length: FAILED_MAX + 7 }, (_, i) => ({ key: `k${i}`, title: `t${i}`, status: 'failed', file: 'a.e2e.ts', target: 'web' }));
  const html = failedHtml(tests, { runId: 'r1' });
  assert.equal((html.match(/class="failed-row"/g) ?? []).length, FAILED_MAX);
  assert.match(html, /Còn 7 test fail nữa/);
  assert.match(html, /Test fail <strong>57<\/strong>/);
});
