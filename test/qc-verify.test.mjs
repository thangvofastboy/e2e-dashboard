import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, result, err } from './_history.mjs';
import { setNote, readNotes, readAudit, knownKeys, verifyQueue, waiverActive } from '../server/qc.mjs';
import { testKey } from '../server/analytics.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'e2ed-qcv-'));
const NOW = Date.parse('2026-10-13T10:00:00Z');

test('audit trail records each change of note, known bug and waiver', async () => {
  const root = tmp();
  await setNote(root, 'k', { note: 'staging' }, { now: NOW });
  await setNote(root, 'k', { known: 'LIN-1' }, { now: NOW });
  await setNote(root, 'k', { known: 'LIN-1' }, { now: NOW }); // no change: nothing logged
  await setNote(root, 'k', { known: '' }, { now: NOW });
  const a = await readAudit(root);
  assert.deepEqual(a.map((x) => [x.field, x.from, x.to]), [['note', null, 'staging'], ['known', null, 'LIN-1'], ['known', 'LIN-1', null]]);
});

test('waiver: validated, active through its last day, ignored by the gate once expired', async () => {
  const root = tmp();
  await assert.rejects(setNote(root, 'k', { waiver: { until: '2026-10-12', reason: 'đã qua hạn' } }, { now: NOW }), /ngày hết hạn/);
  await assert.rejects(setNote(root, 'k', { waiver: { until: '2026-10-20', reason: 'x' } }, { now: NOW }), /lý do/);
  await assert.rejects(setNote(root, 'k', { waiver: { until: '2028-01-01', reason: 'quá xa rồi' } }, { now: NOW }), /365/);
  await setNote(root, 'k', { waiver: { until: '2026-10-13', reason: 'chờ dev sửa' } }, { now: NOW });
  const notes = await readNotes(root);
  assert.ok(waiverActive(notes.k.waiver, NOW));
  assert.ok(knownKeys(notes, NOW).has('k'));
  assert.ok(!knownKeys(notes, NOW + 86_400_000).has('k'));
  await setNote(root, 'k', { waiver: null }, { now: NOW });
  assert.deepEqual(await readNotes(root), {});
  assert.equal((await readAudit(root)).at(-1).field, 'waiver');
});

test('verify queue: a known bug that now passes waits for QC; "not fixed" hides that run only', () => {
  const failing = result({ testId: 'a', idSeed: 1, status: 'failed', error: err('ASSERTION_FAILED', 'x') });
  const passing = result({ testId: 'a', idSeed: 2, status: 'passed' });
  const old = run({ results: [failing], startedAt: '2026-10-01T00:00:00Z' });
  const mid = run({ results: [passing], startedAt: '2026-10-02T00:00:00Z' });
  const key = testKey(passing);
  const notes = { [key]: { known: 'LIN-5' }, other: { note: 'no ticket' } };
  assert.deepEqual(verifyQueue([old], notes), []); // still failing
  const q = verifyQueue([mid, old], notes);
  assert.equal(q.length, 1);
  assert.equal(q[0].known, 'LIN-5');
  assert.equal(q[0].runId, mid.meta.runId);
  assert.deepEqual(verifyQueue([mid, old], { [key]: { known: 'LIN-5', ack: mid.meta.runId } }), []);
  const next = run({ results: [passing], startedAt: '2026-10-03T00:00:00Z' });
  assert.equal(verifyQueue([next, mid, old], { [key]: { known: 'LIN-5', ack: mid.meta.runId } }).length, 1);
});
