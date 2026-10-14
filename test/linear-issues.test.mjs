// Issue Linear: cài đặt email/status, chuẩn hoá mã, merge refresh, lấy issue từ Linear, lưu và thêm tay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeLinear, readSettings, writeSettings } from '../server/settings.mjs';
import { normalizeIssueId, mergeRefresh } from '../server/linear-issues.mjs';
import { createLinear } from '../server/linear.mjs';

const page = (nodes, next = null) => ({ data: { issues: { nodes, pageInfo: { hasNextPage: !!next, endCursor: next } } } });
const json = (body) => ({ ok: true, status: 200, json: async () => body });

const tmp = () => mkdtempSync(join(tmpdir(), 'e2ed-li-'));

test('normalizeIssueId: nhận ENG-12, chữ thường, và URL Linear; từ chối chuỗi rỗng / sai', () => {
  assert.equal(normalizeIssueId('ENG-12'), 'ENG-12');
  assert.equal(normalizeIssueId(' eng-12 '), 'ENG-12');
  assert.equal(normalizeIssueId('https://linear.app/acme/issue/ENG-99/some-title'), 'ENG-99');
  assert.throws(() => normalizeIssueId(''), (e) => e.status === 400);
  assert.throws(() => normalizeIssueId('không có id'), (e) => e.status === 400);
});

test('mergeRefresh: giữ issue đã phân tích hoặc nhập tay khi không còn khớp; bỏ issue tự động chưa có testcase', () => {
  const current = [
    { identifier: 'ENG-1', source: 'auto', testcases: null, generatedPath: null },
    { identifier: 'ENG-2', source: 'auto', testcases: [{ id: 'tc-1', title: 't', steps: [], expected: '' }], generatedPath: null },
    { identifier: 'ENG-3', source: 'manual', testcases: null, generatedPath: null },
    { identifier: 'ENG-4', source: 'auto', testcases: [], generatedPath: null },
  ];
  const fetched = [{ identifier: 'ENG-5', title: 'mới', source: 'auto' }];
  const ids = mergeRefresh(current, fetched, '2026-10-14T00:00:00Z').map((i) => i.identifier);
  assert.deepEqual(ids.sort(), ['ENG-2', 'ENG-3', 'ENG-5']);
});

test('mergeRefresh: issue vẫn khớp giữ testcase đã lưu, cập nhật tiêu đề và trạng thái', () => {
  const current = [{ identifier: 'ENG-1', title: 'cũ', state: 'Todo', source: 'auto', testcases: [{ id: 'tc-1', title: 'a', steps: [], expected: '' }], analyzedAt: 'T0', generatedPath: null }];
  const [item] = mergeRefresh(current, [{ identifier: 'ENG-1', title: 'mới', state: 'In Progress', assignee: 'a@x.com' }], 'T1');
  assert.equal(item.title, 'mới');
  assert.equal(item.state, 'In Progress');
  assert.equal(item.testcases.length, 1);
  assert.equal(item.analyzedAt, 'T0');
});

test('normalizeLinear: email chuẩn hoá (lowercase, bỏ khoảng trắng, bỏ trùng), status bỏ trống và trùng', () => {
  const out = normalizeLinear({ emails: [' A@X.com ', 'a@x.com', 'b@x.com'], statuses: [' In Progress ', 'In Progress', '', 'Todo'] });
  assert.deepEqual(out.emails, ['a@x.com', 'b@x.com']);
  assert.deepEqual(out.statuses, ['In Progress', 'Todo']);
});

test('normalizeLinear: email sai định dạng, quá 20 mục, hoặc status quá 60 ký tự bị từ chối 400', () => {
  assert.throws(() => normalizeLinear({ emails: ['không-phải-email'], statuses: [] }), (e) => e.status === 400);
  assert.throws(() => normalizeLinear({ emails: Array.from({ length: 21 }, (_, i) => `u${i}@x.com`), statuses: [] }), (e) => e.status === 400);
  assert.throws(() => normalizeLinear({ emails: [], statuses: ['x'.repeat(61)] }), (e) => e.status === 400);
});

test('writeSettings lưu khoá linear; readSettings trả mặc định rỗng khi chưa có', async () => {
  const root = tmp();
  assert.deepEqual((await readSettings(root)).linear, { emails: [], statuses: [] });
  await writeSettings(root, { linear: { emails: ['a@x.com'], statuses: ['Todo'] } });
  assert.deepEqual((await readSettings(root)).linear, { emails: ['a@x.com'], statuses: ['Todo'] });
});

test('listAssigned: gửi filter email và status đúng dạng, đi qua mọi trang', async () => {
  const calls = [];
  const responses = [
    page([{ identifier: 'ENG-1', title: 'a', url: 'https://linear.app/x/1', state: { name: 'Todo' }, assignee: { email: 'a@x.com' } }], 'c1'),
    page([{ identifier: 'ENG-2', title: 'b', url: 'https://linear.app/x/2', state: { name: 'Todo' }, assignee: { email: 'a@x.com' } }]),
  ];
  const fetchImpl = async (_u, init) => { calls.push(JSON.parse(init.body)); return json(responses.shift()); };
  const client = createLinear({ apiKey: 'lin_api_testkey_123456', team: null, fetchImpl });
  const out = await client.listAssigned({ emails: ['a@x.com'], statuses: ['Todo'] });
  assert.deepEqual(out.map((i) => i.identifier), ['ENG-1', 'ENG-2']);
  assert.deepEqual(calls[0].variables.emails, ['a@x.com']);
  assert.deepEqual(calls[0].variables.states, ['Todo']);
  assert.equal(calls[1].variables.after, 'c1');
});

test('listAssigned: bỏ issue có assignee hoặc state là null, không crash', async () => {
  const fetchImpl = async () => json(page([
    { identifier: 'ENG-1', title: 'ok', url: 'https://linear.app/x/1', state: { name: 'Todo' }, assignee: { email: 'a@x.com' } },
    { identifier: 'ENG-2', title: 'không người giao', url: 'https://linear.app/x/2', state: { name: 'Todo' }, assignee: null },
    { identifier: 'ENG-3', title: 'không status', url: 'https://linear.app/x/3', state: null, assignee: { email: 'a@x.com' } },
  ]));
  const client = createLinear({ apiKey: 'lin_api_testkey_123456', team: null, fetchImpl });
  const out = await client.listAssigned({ emails: ['a@x.com'], statuses: ['Todo'] });
  assert.deepEqual(out.map((i) => i.identifier), ['ENG-1']);
});

test('listAssigned: body GraphQL có errors thì ném lỗi Linear, không trả danh sách rỗng', async () => {
  const fetchImpl = async () => json({ errors: [{ message: 'bad filter' }] });
  const client = createLinear({ apiKey: 'lin_api_testkey_123456', team: null, fetchImpl });
  await assert.rejects(client.listAssigned({ emails: ['a@x.com'], statuses: ['Todo'] }), /Linear: bad filter/);
});
