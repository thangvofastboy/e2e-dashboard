import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueMeta, metaLine, createLinear } from '../server/linear.mjs';
import { metaLine as uiMetaLine } from '../ui/views/linear.js';

test('issueMeta: Bug needs a related issue id, Task does not, anything else is rejected', () => {
  assert.deepEqual(issueMeta({ type: 'bug', relatedId: ' eng-12 ' }), { type: 'bug', relatedId: 'ENG-12' });
  assert.deepEqual(issueMeta({ type: 'task', relatedId: '' }), { type: 'task', relatedId: null });
  assert.deepEqual(issueMeta({ type: 'task', relatedId: 'ENG-3' }), { type: 'task', relatedId: 'ENG-3' });
  assert.deepEqual(issueMeta({}), { type: null, relatedId: null }, 'no type: old clients and autobug keep working');
  assert.throws(() => issueMeta({ type: 'bug' }), /bắt buộc/);
  assert.throws(() => issueMeta({ type: 'bug', relatedId: '   ' }), /bắt buộc/);
  assert.throws(() => issueMeta({ type: 'task', relatedId: 'không phải mã' }), /không hợp lệ/);
  assert.throws(() => issueMeta({ type: 'epic', relatedId: 'ENG-1' }), /Loại/);
});

test('metaLine: same text on server and in the UI copy for Claude', () => {
  assert.equal(metaLine({ type: 'bug', relatedId: 'ENG-12' }), 'Loại: Bug · Liên quan: ENG-12');
  assert.equal(metaLine({ type: 'task', relatedId: null }), 'Loại: Task');
  assert.equal(metaLine({ type: null, relatedId: null }), '');
  for (const m of [{ type: 'bug', relatedId: 'ENG-1' }, { type: 'task', relatedId: null }, { type: 'task', relatedId: 'A1-9' }]) assert.equal(uiMetaLine(m.type, m.relatedId ?? ''), metaLine(m));
});

const fakeLinear = (labels) => {
  const calls = [];
  const fetchImpl = async (_u, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    if (body.query.includes('teams')) return Response.json({ data: { teams: { nodes: [{ id: 'team-1', key: 'ENG', name: 'Eng' }] } } });
    if (body.query.includes('issueLabels')) return labels instanceof Error ? Response.json({ errors: [{ message: labels.message }] }) : Response.json({ data: { issueLabels: { nodes: labels } } });
    if (body.query.includes('issueCreate')) return Response.json({ data: { issueCreate: { success: true, issue: { id: 'i1', identifier: 'ENG-1' } } } });
    return Response.json({ errors: [{ message: 'unexpected' }] });
  };
  return { calls, client: createLinear({ apiKey: 'lin_api_test123456', team: 'ENG', fetchImpl }) };
};
const createInput = (calls) => calls.find((c) => c.query.includes('issueCreate')).variables.input;

test('create: type Bug attaches the team (or workspace) label named Bug', async () => {
  const { calls, client } = fakeLinear([{ id: 'other-team', team: { id: 'team-9' } }, { id: 'ws-bug', team: null }, { id: 'eng-bug', team: { id: 'team-1' } }]);
  await client.create({ title: 't', description: 'd', type: 'bug' });
  assert.equal(calls.find((c) => c.query.includes('issueLabels')).variables.name, 'Bug');
  assert.deepEqual(createInput(calls).labelIds, ['eng-bug'], 'team label wins over workspace label');
});

test('create: Task falls back to a workspace label; no label or label lookup error still creates the issue', async () => {
  let f = fakeLinear([{ id: 'other-team', team: { id: 'team-9' } }, { id: 'ws-task', team: null }]);
  await f.client.create({ title: 't', description: 'd', type: 'task' });
  assert.equal(f.calls.find((c) => c.query.includes('issueLabels')).variables.name, 'Task');
  assert.deepEqual(createInput(f.calls).labelIds, ['ws-task']);
  f = fakeLinear([{ id: 'other-team', team: { id: 'team-9' } }]);
  await f.client.create({ title: 't', description: 'd', type: 'bug' });
  assert.equal(createInput(f.calls).labelIds, undefined);
  f = fakeLinear(new Error('boom'));
  await f.client.create({ title: 't', description: 'd', type: 'bug' });
  assert.equal(createInput(f.calls).labelIds, undefined);
  f = fakeLinear([{ id: 'ws-bug', team: null }]);
  await f.client.create({ title: 't', description: 'd' });
  assert.equal(f.calls.some((c) => c.query.includes('issueLabels')), false, 'no type: no label lookup');
});
