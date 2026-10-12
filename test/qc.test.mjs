import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, result, err } from './_history.mjs';
import { readNotes, setNote, knownKeys, readManual, saveManual, manualSummary, bugReport, buildMatrix, bugRows, bugsCsv } from '../server/qc.mjs';
import { qualityGate } from '../server/insights.mjs';
import { compareRuns } from '../server/analytics.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'e2ed-qc-'));

test('notes: save, merge, known-ticket validation, removal', async () => {
  const root = tmp();
  await setNote(root, 'a|web|default', { note: 'lỗi do data staging' });
  await setNote(root, 'a|web|default', { known: 'LIN-42' });
  assert.deepEqual((await readNotes(root))['a|web|default'].known, 'LIN-42');
  assert.equal((await readNotes(root))['a|web|default'].note, 'lỗi do data staging');
  await assert.rejects(setNote(root, 'b', { known: 'x y' }), /mã ticket/);
  await assert.rejects(setNote(root, '', { note: 'x' }), /key/);
  await setNote(root, 'a|web|default', { note: '', known: '' });
  assert.deepEqual(await readNotes(root), {});
});

test('a known bug keeps its test out of the new-failure check', async () => {
  const root = tmp();
  const mk = (status) => [result({ testId: 'a', idSeed: 1, status }), result({ testId: 'b', idSeed: 2, status })];
  const base = run({ results: mk('passed'), startedAt: '2026-10-01T00:00:00Z' });
  const head = run({ results: [result({ testId: 'a', idSeed: 1, status: 'failed', error: err('ASSERTION_FAILED', 'x') }), result({ testId: 'b', idSeed: 2, status: 'passed' })], startedAt: '2026-10-02T00:00:00Z' });
  const history = [head, base];
  assert.equal(qualityGate({ history, compare: compareRuns }).pass, false);
  await setNote(root, head.report.run.results[0].testId + '|web|default', { known: 'LIN-1' });
  const known = knownKeys(await readNotes(root));
  const g = qualityGate({ history, compare: compareRuns, known });
  assert.equal(g.pass, true);
  assert.match(g.checks[0].detail, /bỏ qua 1 test có known bug/);
});

test('manual cases: add, change status with history, validate, delete, summary', async () => {
  const root = tmp();
  const a = (await saveManual(root, { title: 'Đăng nhập sai mật khẩu', module: 'Auth', owner: 'lan' })).item;
  assert.equal(a.status, 'not-run');
  await assert.rejects(saveManual(root, { title: '' }), /tiêu đề/);
  await assert.rejects(saveManual(root, { id: a.id, status: 'done' }), /trạng thái/);
  const b = (await saveManual(root, { id: a.id, status: 'fail', note: 'toast không hiện' })).item;
  assert.deepEqual(b.history.map((h) => h.status), ["not-run", "fail"]); // creation counts as the first state
  assert.equal(b.title, 'Đăng nhập sai mật khẩu');
  await saveManual(root, { title: 'Giỏ hàng trống', status: 'pass' });
  const items = await readManual(root);
  assert.deepEqual(manualSummary(items), { total: 2, 'not-run': 0, pass: 1, fail: 1, blocked: 0, passRate: 0.5 });
  const left = (await saveManual(root, { delete: a.id })).items;
  assert.equal(left.length, 1);
});

test('bug report: steps, error, build, QC note and known bug', () => {
  const r = result({ testId: 'tests/x.e2e.ts::pay', title: 'thanh toán', idSeed: 7, status: 'failed', error: err('ASSERTION_FAILED', 'expected "3"') });
  const h = run({ results: [r], startedAt: '2026-10-03T00:00:00Z' });
  const md = bugReport({ meta: h.meta, report: h.report, resultId: r.id, note: 'đã báo dev', known: 'LIN-9' });
  assert.match(md, /^## \[QC\] thanh toán/m);
  assert.match(md, /\*\*Build:\*\* main@aaaaaaa/);
  assert.match(md, /`ASSERTION_FAILED`: expected "3"/);
  assert.match(md, /### Ghi chú QC\nđã báo dev/);
  assert.match(md, /Known bug:\*\* LIN-9/);
  assert.equal(bugReport({ meta: h.meta, report: h.report, resultId: 'nope' }), null);
});

test('build matrix: one column per build, changed rows first', () => {
  const t = (id, status) => result({ testId: id, idSeed: id === 'a' ? 1 : 2, status });
  const newest = run({ results: [t('a', 'failed'), t('b', 'passed')], branch: 'main', commit: 'c'.repeat(40), startedAt: '2026-10-05T00:00:00Z' });
  const older = run({ results: [t('a', 'passed'), t('b', 'passed')], branch: 'main', commit: 'd'.repeat(40), startedAt: '2026-10-04T00:00:00Z' });
  const m = buildMatrix([newest, older]);
  assert.deepEqual(m.builds.map((b) => b.key), ['main@ddddddd', 'main@ccccccc']); // oldest column first
  assert.equal(m.rows[0].title, 'a');
  assert.equal(m.rows[0].changed, true);
  assert.deepEqual(m.rows[0].cells, ['passed', 'failed']);
});

test('bug CSV: failing rows of the newest run, quoted, formula-safe', () => {
  const r1 = result({ testId: 'a', title: '=HYPERLINK("x")', idSeed: 3, status: 'failed', error: err('X', 'say "hi"\n-cmd') });
  const h = run({ results: [r1, result({ testId: 'b', idSeed: 4 })], startedAt: '2026-10-06T00:00:00Z' });
  const rows = bugRows(h, {});
  assert.equal(rows.length, 1);
  const csv = bugsCsv(rows);
  assert.ok(csv.startsWith('﻿'));
  assert.match(csv, /'=HYPERLINK\(""x""\)/);
  assert.match(csv, /"say ""hi""\n-cmd"/);
  assert.equal(bugsCsv([]).split('\r\n')[0].split(',').length, 12);
});
