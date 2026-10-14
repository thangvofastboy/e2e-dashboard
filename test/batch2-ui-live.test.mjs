import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failedRows, matchResultId, failedHtml, formatResources, runsHref } from '../ui/views/live.js';

const live = (o) => ({ key: `${o.testId}|${o.target}|${o.agent ?? 'default'}|${o.repeat ?? 0}`, agent: 'default', repeat: 0, file: 'a.e2e.ts', title: o.testId, ...o });
const report = {
  run: {
    results: [
      { id: 'r1', testId: 'login', targetId: 'web', agent: 'default', repeat: 0, source: { file: 'a.e2e.ts', line: 3 } },
      { id: 'r2', testId: 'login', targetId: 'web', agent: 'default', repeat: 1, source: { file: 'a.e2e.ts', line: 3 } },
      { id: 'r3', testId: 'login', targetId: 'mobile', agent: 'default', repeat: 0 },
    ],
  },
};

test('failedRows chỉ lấy test failed/error, giữ thứ tự', () => {
  const rows = failedRows([live({ testId: 'a', target: 'web', status: 'passed' }), live({ testId: 'b', target: 'web', status: 'failed' }), live({ testId: 'c', target: 'web', status: 'error' }), live({ testId: 'd', target: 'web', status: 'running' })]);
  assert.deepEqual(rows.map((t) => t.testId), ['b', 'c']);
  assert.deepEqual(failedRows(undefined), []);
});

test('matchResultId khớp theo testId|target|agent|repeat (lặp repeat, nhiều target)', () => {
  assert.equal(matchResultId(live({ testId: 'login', target: 'web', repeat: 1 }), report)?.id, 'r2');
  assert.equal(matchResultId(live({ testId: 'login', target: 'web', repeat: 0 }), report)?.id, 'r1');
  assert.equal(matchResultId(live({ testId: 'login', target: 'mobile' }), report)?.id, 'r3');
  assert.equal(matchResultId(live({ testId: 'login', target: 'web', agent: 'other' }), report), null);
  assert.equal(matchResultId(live({ testId: 'x', target: 'web' }), null), null);
});

test('failedHtml escape lỗi và chỉ hiện dòng đầu, có Xem bước / Chạy lại', () => {
  const t = live({ testId: 'b', target: 'web', status: 'failed', title: '<b>t</b>', error: { message: '<img src=x onerror=alert(1)>\nstack dòng 2' } });
  const html = failedHtml([t], { runId: null, finished: true, results: {} });
  assert.doesNotMatch(html, /<img|<b>t/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /stack dòng 2/);
  assert.match(html, /data-view-steps/);
  assert.match(html, /data-rerun-one/);
  assert.match(html, /chưa có báo cáo để phân tích/);
  assert.doesNotMatch(html, /data-live-ai|data-live-linear/);
  assert.equal(failedHtml([], {}), '');
});

test('failedHtml có runId + resultId: thêm nút như run detail và file:line từ báo cáo', () => {
  const t = live({ testId: 'login', target: 'web', status: 'failed', error: { message: 'boom' } });
  const html = failedHtml([t], { runId: 'run-1', finished: true, results: { [t.key]: { id: 'r1', file: 'a.e2e.ts', line: 3 } } });
  for (const a of ['data-live-ai="analyze-failure"', 'data-live-linear="r1"', 'data-live-bisect="r1"', 'data-live-fix="r1"']) assert.ok(html.includes(a), a);
  assert.match(html, /a\.e2e\.ts:3/);
  assert.doesNotMatch(html, /chưa có báo cáo/);
});

test('runsHref trỏ thẳng run khi có runId', () => {
  assert.equal(runsHref('a b'), '#/run/a%20b');
  assert.equal(runsHref(null), '#/runs');
});

test('formatResources: máy + app, runner null thì bỏ phần app', () => {
  const res = { machine: { cores: 8, cpuPct: 42.4, memTotalMb: 16384, memFreeMb: 4096, diskTotalGb: 500, diskFreeGb: 120.5 }, app: { dashboard: { rssMb: 80, cpuPct: 1 }, runner: { rssMb: 1200.4, cpuPct: 150.2, procs: 7 } } };
  const html = formatResources(res);
  assert.match(html, /CPU máy 42%/);
  assert.match(html, /RAM 12\.0\/16\.0 GB/);
  assert.match(html, /Disk trống 121 GB/);
  assert.match(html, /App: 1200 MB · 150% CPU · 7 tiến trình/);
  assert.doesNotMatch(formatResources({ ...res, app: { dashboard: res.app.dashboard, runner: null } }), /App:/);
  assert.equal(formatResources(null), '');
});
