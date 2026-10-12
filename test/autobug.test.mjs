import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { run, result, err } from './_history.mjs';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { autoLogBugs, bugCandidates } from '../server/autobug.mjs';
import { readIssueLinks } from '../server/linear.mjs';
import { readNotes } from '../server/qc.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'e2ed-autobug-'));
const failing = (id, code, category) => {
  const r = result({ testId: id, idSeed: id === 'a' ? 1 : id === 'b' ? 2 : 3, status: 'failed', error: { ...err(code, `${code} happened`), category } });
  return r;
};

// a run with one app bug (a), one infrastructure failure (b) and one passing test (c)
function report() {
  return run({ results: [failing('a', 'ASSERTION_FAILED', 'test'), failing('b', 'MODEL_PROVIDER_FAILED', 'infrastructure'), result({ testId: 'c', idSeed: 3 })], startedAt: '2026-10-07T00:00:00Z' });
}

function fakeLinear({ open = {}, failCreate = false } = {}) {
  const created = [];
  return {
    created,
    find: async (fp) => ({ open: open[fp] ?? null, closed: [] }),
    create: async (d) => {
      if (failCreate) throw new Error('Linear 500');
      created.push(d);
      return { id: `id-${created.length}`, identifier: `ENG-${created.length}`, url: `https://linear.app/x/ENG-${created.length}` };
    },
  };
}

const fakeAi = (text) => ({ run: async ({ onEvent }) => { if (text === null) throw new Error('claude không chạy'); onEvent({ type: 'done', result: text }); } });

test('only test failures are candidates: infrastructure errors and passes are left out', () => {
  const ids = bugCandidates(report().report).map((r) => r.testId);
  assert.deepEqual(ids, ['tests/a.e2e.ts::a']);
});

test('creates one issue per app failure, with the AI text and the draft fingerprint kept', async () => {
  const root = tmp();
  const { meta, report: rep } = report();
  await archive(root, { source: 'hook', report: rep });
  const linear = fakeLinear();
  const r = await autoLogBugs({ projectRoot: root, runId: meta.runId, ai: fakeAi('## Tóm tắt\nNút không phản hồi'), linear });
  assert.equal(r.status, 'done');
  assert.deepEqual(r.rows.map((x) => [x.status, x.issue, x.aiUsed]), [['created', 'ENG-1', true]]);
  assert.equal(linear.created.length, 1);
  assert.match(linear.created[0].description, /## Tóm tắt\nNút không phản hồi/);
  assert.match(linear.created[0].description, /fingerprint: `[^`]+`/);
  const links = await readIssueLinks(root);
  assert.equal(Object.values(links)[0].identifier, 'ENG-1');
  const notes = await readNotes(root);
  assert.deepEqual(Object.values(notes).map((n) => n.known), ['ENG-1'], 'the filed test is marked as a known bug');
});

test('an open issue with the same fingerprint is not created twice', async () => {
  const a = tmp();
  const { meta, report: rep } = report();
  await archive(a, { source: 'hook', report: rep });
  const first = fakeLinear();
  await autoLogBugs({ projectRoot: a, runId: meta.runId, ai: fakeAi('Tóm tắt'), linear: first });
  const fingerprint = first.created[0].fingerprint;
  assert.ok(fingerprint, 'the draft carries its fingerprint');
  // another checkout of the project (no QC notes yet) whose failure already has an open issue in Linear
  const b = tmp();
  await archive(b, { source: 'hook', report: rep });
  const again = fakeLinear({ open: { [fingerprint]: { id: 'z', identifier: 'ENG-9' } } });
  const r = await autoLogBugs({ projectRoot: b, runId: meta.runId, ai: fakeAi('Tóm tắt'), linear: again });
  assert.deepEqual(r.rows.map((x) => [x.status, x.issue]), [['duplicate', 'ENG-9']]);
  assert.equal(again.created.length, 0);
  assert.deepEqual(Object.values(await readNotes(b)).map((n) => n.known), ['ENG-9'], 'an already-open issue links the test too');
});

test('a known test that fails the same way in a later run is neither filed nor commented', async () => {
  const root = tmp();
  const first = report();
  await archive(root, { source: 'hook', report: first.report });
  await autoLogBugs({ projectRoot: root, runId: first.meta.runId, ai: fakeAi('Tóm tắt'), linear: fakeLinear() });
  const later = report(); // another run, the same failure
  await archive(root, { source: 'hook', report: later.report });
  const linear = fakeLinear();
  const k = await autoLogBugs({ projectRoot: root, runId: later.meta.runId, ai: fakeAi('Tóm tắt'), linear });
  assert.deepEqual(k.rows.map((x) => [x.status, x.issue]), [['known', 'ENG-1']]);
  assert.equal(linear.created.length, 0);
  assert.equal(linear.comments?.length ?? 0, 0);
});

test('without AI the deterministic draft is filed; a failing AI call does not block the issue', async () => {
  const root = tmp();
  const { meta, report: rep } = report();
  await archive(root, { source: 'hook', report: rep });
  const linear = fakeLinear();
  const r = await autoLogBugs({ projectRoot: root, runId: meta.runId, ai: fakeAi(null), linear });
  assert.equal(r.rows[0].status, 'created');
  assert.equal(r.rows[0].aiUsed, false);
  assert.match(linear.created[0].description, /fingerprint: `/);
});

test('a Linear error is reported on its row, not thrown', async () => {
  const root = tmp();
  const { meta, report: rep } = report();
  await archive(root, { source: 'hook', report: rep });
  const r = await autoLogBugs({ projectRoot: root, runId: meta.runId, linear: fakeLinear({ failCreate: true }) });
  assert.deepEqual(r.rows.map((x) => [x.status, x.error]), [['error', 'Linear 500']]);
});

test('no Linear key and no injected client: nothing is attempted', async () => {
  const root = tmp();
  const { meta, report: rep } = report();
  await archive(root, { source: 'hook', report: rep });
  const r = await autoLogBugs({ projectRoot: root, runId: meta.runId, env: {}, cfg: {} });
  assert.equal(r.status, 'no-key');
  assert.deepEqual(r.rows, []);
});

test('the same run is looked at once even if it is archived twice', async () => {
  const root = tmp();
  const { meta, report: rep } = report();
  await archive(root, { source: 'hook', report: rep });
  const linear = fakeLinear();
  assert.equal((await autoLogBugs({ projectRoot: root, runId: meta.runId, linear })).status, 'done');
  const again = await autoLogBugs({ projectRoot: root, runId: meta.runId, linear });
  assert.equal(again.status, 'already-handled');
  assert.equal(linear.created.length, 1);
});
