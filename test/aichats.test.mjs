import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendChat, listChats, getChat, deleteChat, validEntry, MAX_CHATS } from '../server/aichats.mjs';

const project = () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-chats-'));
  writeFileSync(join(root, 'e2e.config.ts'), 'export default {};\n');
  return root;
};
const entry = (id, text = 'hỏi', extra = {}) => ({ id, title: `Chat ${id}`, msgs: [{ role: 'user', text }, { role: 'ai', text: `đáp ${text}` }], ...extra });

test('appendChat tạo chat mới, lần sau nối tin vào đúng chat; lưu ở state/ai-chats.json', async () => {
  const root = project();
  await appendChat(root, entry('s-1', 'a', { source: { action: 'analyze-failure', runId: 'bad id/..', resultId: 'r1' } }), 1000);
  await appendChat(root, { id: 's-1', title: 'khác', msgs: [{ role: 'user', text: 'b' }] }, 2000);
  const c = await getChat(root, 's-1');
  assert.equal(c.title, 'Chat s-1'); // tiêu đề giữ của lần đầu
  assert.deepEqual(c.msgs.map((m) => m.text), ['a', 'đáp a', 'b']);
  assert.equal(c.source.action, 'analyze-failure');
  assert.equal(c.source.runId, null); // runId sai dạng bị bỏ
  const disk = JSON.parse(readFileSync(join(root, '.e2e-dashboard', 'state', 'ai-chats.json'), 'utf8'));
  assert.equal(disk.chats.length, 1);
});

test('listChats: mới cập nhật lên đầu, không kèm tin nhắn; giới hạn số chat', async () => {
  const root = project();
  await appendChat(root, entry('a'), 1000);
  await appendChat(root, entry('b'), 2000);
  await appendChat(root, entry('a', 'x'), 3000);
  const list = await listChats(root);
  assert.deepEqual(list.map((c) => [c.id, c.count]), [['a', 4], ['b', 2]]);
  assert.equal(list[0].msgs, undefined);
  for (let i = 0; i < MAX_CHATS + 5; i++) await appendChat(root, entry(`c${i}`), 10_000 + i);
  assert.equal((await listChats(root)).length, MAX_CHATS);
});

test('ghi song song không mất tin (serial)', async () => {
  const root = project();
  await Promise.all(Array.from({ length: 10 }, (_, i) => appendChat(root, { id: 'p', title: 't', msgs: [{ role: 'user', text: String(i) }] })));
  assert.equal((await getChat(root, 'p')).msgs.length, 10);
});

test('validEntry từ chối dữ liệu xấu; deleteChat xoá đúng chat', async () => {
  for (const e of [null, { id: '../x', title: 't', msgs: [{ role: 'user', text: 'a' }] }, { id: 'a', title: '', msgs: [{ role: 'user', text: 'a' }] }, { id: 'a', title: 't', msgs: [] }, { id: 'a', title: 't', msgs: [{ role: 'system', text: 'a' }] }]) {
    assert.throws(() => validEntry(e), (x) => x.status === 400);
  }
  assert.equal(validEntry({ id: 'a', title: 't', msgs: [{ role: 'ai', text: 'x'.repeat(60_000) }] }).msgs[0].text.length, 50_000);
  const root = project();
  await appendChat(root, entry('a'));
  await appendChat(root, entry('b'));
  assert.deepEqual(await deleteChat(root, 'a'), { removed: 1 });
  assert.deepEqual((await listChats(root)).map((c) => c.id), ['b']);
  assert.equal(await getChat(root, '../etc'), null);
});

test('file lịch sử không vượt MAX_FILE_CHARS: bỏ chat cũ nhất, chat mới nhất luôn còn', async () => {
  const { MAX_FILE_CHARS } = await import('../server/aichats.mjs');
  const root = project();
  const big = 'x'.repeat(50_000);
  for (let i = 0; i < 60; i++) await appendChat(root, { id: `b${i}`, title: 't', msgs: [{ role: 'user', text: big }, { role: 'ai', text: big }] }, 1000 + i);
  const list = await listChats(root);
  assert.ok(list.length < 60 && list.length > 10, `còn ${list.length}`);
  assert.equal(list[0].id, 'b59');
  assert.ok(readFileSync(join(root, '.e2e-dashboard', 'state', 'ai-chats.json'), 'utf8').length <= MAX_FILE_CHARS + 100);
});
