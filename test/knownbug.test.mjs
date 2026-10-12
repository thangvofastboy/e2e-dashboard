import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, result, err } from './_history.mjs';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { autoLogBugs } from '../server/autobug.mjs';
import { commentIfNewBug, signatureOf } from '../server/knownbug.mjs';
import { readNotes, setNote, markKnown } from '../server/qc.mjs';
import { testKey } from '../server/analytics.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'e2ed-known-'));
const failed = (code, message) => result({ testId: 'a', idSeed: 1, status: 'failed', error: { ...err(code, message), category: 'test' } });
const mkRun = (r, at) => run({ results: [r], startedAt: at });

function fakeLinear(state = { name: 'In Progress', type: 'started' }) {
  const comments = [];
  const created = [];
  return {
    comments, created,
    get: async (id) => (id === 'ENG-7' ? { id: 'uuid-7', identifier: 'ENG-7', state } : null),
    comment: async (id, body) => { comments.push({ id, body }); return true; },
    find: async () => ({ open: null, closed: [] }),
    create: async (d) => { created.push(d); return { id: 'n', identifier: 'ENG-99' }; },
  };
}

async function setup(sameError) {
  const root = tmp();
  const first = mkRun(failed('ASSERTION_FAILED', 'expected "3" got "2"'), '2026-10-09T00:00:00Z');
  await archive(root, { source: 'hook', report: first.report });
  const r1 = first.report.run.results[0];
  await markKnown(root, r1, { identifier: 'ENG-7' }, signatureOf(first.report, r1));
  const second = mkRun(sameError ? failed('ASSERTION_FAILED', 'expected "5" got "4"') : failed('LOCATOR_NOT_FOUND', 'no button "Pay"'), '2026-10-10T00:00:00Z');
  await archive(root, { source: 'hook', report: second.report });
  return { root, second };
}

test('markKnown remembers the error shape it was filed with', async () => {
  const { root, second } = await setup(true);
  const n = (await readNotes(root))[testKey(second.report.run.results[0])];
  assert.equal(n.known, 'ENG-7');
  assert.equal(n.seen.length, 1);
});

test('the same error again is the same bug: no comment', async () => {
  const { root, second } = await setup(true); // only the numbers differ: the message normalises to the same shape
  const linear = fakeLinear();
  const c = await commentIfNewBug({ projectRoot: root, run: { meta: second.meta, report: second.report }, result: second.report.run.results[0], linear, notes: await readNotes(root) });
  assert.equal(c.status, 'same-bug');
  assert.equal(linear.comments.length, 0);
});

test('a different error on a known bug is commented on its issue, once', async () => {
  const { root, second } = await setup(false);
  const linear = fakeLinear();
  const input = { projectRoot: root, run: { meta: second.meta, report: second.report }, result: second.report.run.results[0], linear };
  const c = await commentIfNewBug({ ...input, notes: await readNotes(root) });
  assert.deepEqual([c.status, c.issue], ['commented', 'ENG-7']);
  assert.equal(linear.comments[0].id, 'uuid-7', 'the comment goes to the issue, by its internal id');
  assert.match(linear.comments[0].body, /Lỗi mới khi chạy lại test này/);
  assert.match(linear.comments[0].body, /LOCATOR_NOT_FOUND/);
  assert.match(linear.comments[0].body, new RegExp(second.meta.runId));
  const again = await commentIfNewBug({ ...input, notes: await readNotes(root) });
  assert.equal(again.status, 'same-bug', 'the new shape is remembered');
  assert.equal(linear.comments.length, 1);
});

test('a closed or missing known issue is not commented on', async () => {
  const { root, second } = await setup(false);
  const input = { projectRoot: root, run: { meta: second.meta, report: second.report }, result: second.report.run.results[0], notes: await readNotes(root) };
  const closed = fakeLinear({ name: 'Done', type: 'completed' });
  assert.equal((await commentIfNewBug({ ...input, linear: closed })).status, 'issue-closed');
  assert.equal(closed.comments.length, 0);
  await setNote(root, testKey(second.report.run.results[0]), { known: 'ENG-1' });
  assert.equal((await commentIfNewBug({ ...input, linear: fakeLinear(), notes: await readNotes(root) })).status, 'issue-missing');
});

test('a test that is not known is left alone', async () => {
  const root = tmp();
  const r = mkRun(failed('X', 'y'), '2026-10-11T00:00:00Z');
  await archive(root, { source: 'hook', report: r.report });
  const c = await commentIfNewBug({ projectRoot: root, run: { meta: r.meta, report: r.report }, result: r.report.run.results[0], linear: fakeLinear(), notes: {} });
  assert.equal(c.status, 'not-known');
});

test('auto log: a new bug on a known test is a comment, not a second issue', async () => {
  const { root, second } = await setup(false);
  const linear = fakeLinear();
  const r = await autoLogBugs({ projectRoot: root, runId: second.meta.runId, linear });
  assert.deepEqual(r.rows.map((x) => [x.status, x.issue]), [['commented', 'ENG-7']]);
  assert.equal(linear.created.length, 0);
  assert.equal(linear.comments.length, 1);
});

test('typing a ticket by hand for a failing test also records its current error as known', async () => {
  const root = tmp();
  const r = mkRun(failed('ASSERTION_FAILED', 'x'), '2026-10-12T00:00:00Z');
  const res = r.report.run.results[0];
  await setNote(root, testKey(res), { known: 'ENG-7', seen: [signatureOf(r.report, res)] });
  const n = (await readNotes(root))[testKey(res)];
  assert.deepEqual(n.seen, [signatureOf(r.report, res)]);
  await setNote(root, testKey(res), { note: 'only a note' });
  assert.equal((await readNotes(root))[testKey(res)].seen.length, 1, 'a note-only edit keeps what is known');
  await setNote(root, testKey(res), { known: 'ENG-8' });
  assert.equal((await readNotes(root))[testKey(res)].seen, undefined, 'another ticket starts with nothing known');
});
