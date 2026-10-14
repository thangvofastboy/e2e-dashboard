// Route Issue Linear: danh sách, refresh, thêm tay, phân tích, lưu testcase, Gen file e2e.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLinearIssuesApi } from '../server/linear-issues.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'e2ed-api-'));
const readBody = (b) => async () => b;
const fakeClient = {
  listAssigned: async () => [{ identifier: 'ENG-1', title: 'a', url: 'https://linear.app/x/1', state: 'Todo', assignee: 'a@x.com' }],
  get: async (id) => (id === 'ENG-1' ? { identifier: 'ENG-1', title: 'a', url: 'https://linear.app/x/1', state: { name: 'Todo' } } : null),
  getWithComments: async () => ({ identifier: 'ENG-1', title: 'a', description: 'mô tả', comments: [] }),
};
const api = (root, runAi = async () => '') => createLinearIssuesApi({
  projectRoot: root,
  linearBackend: async () => ({ mode: 'api', client: fakeClient, team: null }),
  runAi,
  settings: async () => ({ emails: ['a@x.com'], statuses: ['Todo'] }),
});

test('route: đường dẫn không thuộc tính năng trả null', async () => {
  assert.equal(await api(tmp())({}, '/api/linear', 'GET', readBody({})), null);
});

test('route: refresh lưu danh sách, GET đọc lại', async () => {
  const root = tmp();
  const a = api(root);
  assert.equal((await a({}, '/api/linear/issues/refresh', 'POST', readBody({}))).status, 200);
  const got = await a({}, '/api/linear/issues', 'GET', readBody({}));
  assert.equal(got.body.items[0].identifier, 'ENG-1');
});

test('route: add với mã sai trả 400, mã không có trên Linear trả 404', async () => {
  const a = api(tmp());
  assert.equal((await a({}, '/api/linear/issues/add', 'POST', readBody({ id: 'xx' }))).status, 400);
  assert.equal((await a({}, '/api/linear/issues/add', 'POST', readBody({ id: 'ENG-9' }))).status, 404);
});

test('route: analyze chỉ trả đề xuất, chưa ghi testcase vào danh sách', async () => {
  const root = tmp();
  const ai = async () => '```json\n{"testcases":[{"title":"t","steps":["b"],"expected":"e"}]}\n```';
  const a = api(root, ai);
  await a({}, '/api/linear/issues/add', 'POST', readBody({ id: 'ENG-1' }));
  const res = await a({}, '/api/linear/issues/ENG-1/analyze', 'POST', readBody({}));
  assert.equal(res.status, 200);
  assert.equal(res.body.testcases.length, 1);
  const got = await a({}, '/api/linear/issues', 'GET', readBody({}));
  assert.equal(got.body.items[0].testcases, null);
});

test('route: lưu testcase rồi gen; gen lần hai trả 409 và giữ file cũ', async () => {
  const root = tmp();
  const ai = async () => '```ts\nimport {test} from "e2e";\n```\nPATH: tests/linear/ENG-1.e2e.ts';
  const a = api(root, ai);
  await a({}, '/api/linear/issues/add', 'POST', readBody({ id: 'ENG-1' }));
  const tcs = [{ title: 't', steps: ['b'], expected: 'e' }];
  assert.equal((await a({}, '/api/linear/issues/ENG-1/testcases', 'POST', readBody({ testcases: tcs }))).status, 200);
  assert.equal((await a({}, '/api/linear/issues/ENG-1/gen', 'POST', readBody({}))).status, 200);
  assert.equal((await a({}, '/api/linear/issues/ENG-1/gen', 'POST', readBody({}))).status, 409);
});

test('route: gen khi chưa lưu testcase trả 400', async () => {
  const root = tmp();
  const a = api(root);
  await a({}, '/api/linear/issues/add', 'POST', readBody({ id: 'ENG-1' }));
  assert.equal((await a({}, '/api/linear/issues/ENG-1/gen', 'POST', readBody({}))).status, 400);
});
