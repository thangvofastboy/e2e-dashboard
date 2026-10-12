import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fmtDuration, fmtTokens, fmtRelative, escapeHtml, statusBadge } from '../ui/format.js';
import { flattenResults, facets, applyFilters, matrix, stepVideoOffset, isFailure } from '../ui/model.js';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));

test('format helpers', () => {
  assert.equal(fmtDuration(null), '—');
  assert.equal(fmtDuration(850), '850ms');
  assert.equal(fmtDuration(12_340), '12.3s');
  assert.equal(fmtDuration(134_000), '2m14s');
  assert.equal(fmtDuration(3_720_000), '1h02m');
  assert.equal(fmtTokens(950), '950');
  assert.equal(fmtTokens(48_200), '48k');
  assert.equal(fmtTokens(1_250_000), '1.3M');
  const now = Date.parse('2026-07-24T12:00:00Z');
  assert.equal(fmtRelative('2026-07-24T11:59:40Z', now), 'vừa xong');
  assert.equal(fmtRelative('2026-07-24T11:55:00Z', now), '5 phút trước');
  assert.equal(fmtRelative('2026-07-24T09:00:00Z', now), '3 giờ trước');
  assert.equal(fmtRelative('2026-07-22T12:00:00Z', now), '2 ngày trước');
  assert.equal(escapeHtml(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.match(statusBadge('failed'), /class="chip tone-bad".*#i-x/);
  assert.match(statusBadge('<x>'), /&lt;x&gt;/);
});

test('flattenResults maps results with title, line and duration', () => {
  const rows = flattenResults(fixture());
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, 'opens app');
  assert.equal(rows[0].line, 3);
  assert.equal(rows[0].target, 'web');
  assert.equal(rows[0].durationMs, 1000);
});

test('flattenResults rebuilds serial-group attempts from members', () => {
  const r = fixture();
  const res = r.run.results[0];
  res.attempts = [];
  res.serialGroupId = 'g1';
  r.run.serialGroups = [{
    id: 'g1', serialId: 's', declarationIndex: 0, file: res.file, source: res.source, titlePath: ['group'],
    targetId: 'web', platform: 'web', memberTestIds: [res.testId], status: 'failed',
    attempts: [{
      id: 'ga1', index: 0, status: 'failed', startedAt: '2026-07-24T12:00:00.000Z', durationMs: 500,
      artifacts: [{ id: 'v', kind: 'video', mediaType: 'video/webm', path: 'g/video.webm', redaction: 'complete', producer: { kind: 'attempt' } }],
      secondaryErrors: [], cleanup: 'complete',
      members: [{ id: 'm1', index: 0, testId: res.testId, status: 'failed', startedAt: '2026-07-24T12:00:00.000Z', durationMs: 500, steps: [{ id: 's1', label: 'x' }], secondaryErrors: [] }],
    }],
  }];
  const row = flattenResults(r).find((x) => x.id === res.id);
  assert.equal(row.attempts.length, 1);
  assert.equal(row.attempts[0].serial, true);
  assert.equal(row.attempts[0].steps[0].id, 's1');
  assert.equal(row.attempts[0].artifacts[0].path, 'g/video.webm');
  assert.equal(row.durationMs, 500);
});

test('facets, filters and matrix', () => {
  const rows = flattenResults(fixture());
  rows.push({ ...rows[0], id: 'z', target: 'webkit', status: 'failed', tags: [] });
  const f = facets(rows);
  assert.deepEqual(f.targets, ['web', 'webkit']);
  assert.deepEqual(f.tags, ['smoke']);
  assert.equal(applyFilters(rows, {}).length, 3);
  assert.equal(applyFilters(rows, { targets: ['webkit'] }).length, 1);
  assert.equal(applyFilters(rows, { tags: ['smoke'], statuses: ['passed'] }).length, 1);
  const m = matrix(rows);
  assert.deepEqual(m.targets, ['web', 'webkit']);
  const opens = m.rows.find((r) => r.title === 'opens app');
  assert.equal(opens.cells.webkit.status, 'failed');
});

test('isFailure and stepVideoOffset', () => {
  assert.ok(isFailure('timed-out') && isFailure('flaky') && !isFailure('passed') && !isFailure('skipped'));
  const attempt = { startedAt: '2026-07-24T12:00:00.000Z' };
  const video = { startedAt: '2026-07-24T12:00:01.000Z' };
  assert.equal(stepVideoOffset({ startedAt: '2026-07-24T12:00:03.500Z' }, video, attempt), 2.5);
  assert.equal(stepVideoOffset({ startedAt: '2026-07-24T12:00:03.500Z' }, {}, attempt), 3.5);
  assert.equal(stepVideoOffset({ startedAt: '2026-07-24T12:00:00.500Z' }, video, attempt), null);
  assert.equal(stepVideoOffset({}, video, attempt), null);
});

test('filterKnown keeps, hides or ignores tests with a known-bug note', async () => {
  const { filterKnown, knownKey } = await import('../ui/model.js');
  const rows = [{ testId: 't1', target: 'web', agent: 'default' }, { testId: 't2', target: 'web', agent: 'default' }, { testId: 't3', target: 'ios', agent: 'buyer' }];
  const notes = { [knownKey(rows[0])]: { known: 'ENG-7', note: '' }, [knownKey(rows[2])]: { known: null, note: 'only a note' } };
  assert.deepEqual(filterKnown(rows, 'only', notes).map((r) => r.testId), ['t1']);
  assert.deepEqual(filterKnown(rows, 'hide', notes).map((r) => r.testId), ['t2', 't3'], 'a note without a ticket is not a known bug');
  assert.equal(filterKnown(rows, '', notes), rows);
  assert.equal(filterKnown(rows, 'only', undefined).length, 0);
});
