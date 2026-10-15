import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatRequest } from '../ui/views/ai-panel.js';

test('chatRequest: câu đầu gọi /api/ai/ask, các câu sau nối tiếp session qua /api/ai/followup', () => {
  assert.deepEqual(chatRequest(null, 'test nào flaky?'), { path: '/api/ai/ask', payload: { runId: null, question: 'test nào flaky?' } });
  assert.deepEqual(chatRequest('s-1', 'vì sao?'), { path: '/api/ai/followup', payload: { runId: null, sessionId: 's-1', question: 'vì sao?' } });
});

test('chatEntry: một lượt hỏi–đáp thành bản ghi lịch sử; không session / không nội dung thì null', async () => {
  const { chatEntry } = await import('../ui/views/ai-panel.js');
  assert.deepEqual(chatEntry({ chatId: null, sessionId: 's1', title: 'Phân tích lỗi · cart', source: { action: 'analyze-failure', runId: 'r', resultId: 'x' }, question: 'Phân tích lỗi · cart', answer: 'do locator' }), {
    id: 's1', sessionId: 's1', title: 'Phân tích lỗi · cart', source: { action: 'analyze-failure', runId: 'r', resultId: 'x' },
    msgs: [{ role: 'user', text: 'Phân tích lỗi · cart' }, { role: 'ai', text: 'do locator' }],
  });
  assert.equal(chatEntry({ chatId: 's1', sessionId: 's2', title: 't', question: 'q', answer: 'a' }).id, 's1'); // hỏi tiếp: giữ chat cũ
  assert.deepEqual(chatEntry({ sessionId: 's1', title: 't', question: 'q', error: 'hết hạn' }).msgs[1], { role: 'ai', text: '', error: 'hết hạn' });
  assert.equal(chatEntry({ sessionId: null, title: 't', question: 'q', answer: 'a' }), null);
  assert.equal(chatEntry({ sessionId: 's', title: 't', question: 'q' }), null);
});

test('historyHtml: mỗi chat một dòng (tiêu đề, loại, số tin), có nút xoá; rỗng thì không hiện', async () => {
  const { historyHtml } = await import('../ui/views/ai-panel.js');
  const html = historyHtml([{ id: 's1', title: 'Phân tích lỗi · <cart>', source: { action: 'analyze-failure' }, count: 4, updatedAt: '2026-10-15T04:00:00Z' }]);
  assert.match(html, /data-chat="s1"/);
  assert.match(html, /data-del-chat="s1"/);
  assert.match(html, /&lt;cart&gt;/);
  assert.match(html, /Phân tích lỗi · 4 tin/);
  assert.equal(historyHtml([]), '');
});

test('typewriter: hiện dần tới hết, đổi văn bản giữa chừng thì giữ phần chung, stop trả toàn văn', async () => {
  const { typewriter } = await import('../ui/views/ai-panel.js');
  const frames = [];
  const tw = typewriter((t, typing) => frames.push([t, typing]), { step: 1, now: false });
  const text = 'x'.repeat(100);
  tw.set(text);
  await tw.finish();
  assert.ok(frames.length > 5, 'nhiều bước, không hiện một lần');
  assert.deepEqual(frames.at(-1), [text, false]);
  assert.ok(frames.every(([t], i) => i === 0 || t.length >= frames[i - 1][0].length)); // chỉ tăng
  frames.length = 0;
  tw.set(`${'x'.repeat(50)}y`); // kết quả cuối khác bản stream: vẽ lại từ phần chung
  await tw.finish();
  assert.equal(frames.at(-1)[0], `${'x'.repeat(50)}y`);
  const tw2 = typewriter(() => {}, { step: 1000, now: false });
  tw2.set('abc');
  const done = tw2.finish();
  assert.equal(tw2.stop(), 'abc');
  await done; // stop giải phóng người đang chờ
  const fast = [];
  const tw3 = typewriter((t) => fast.push(t), { step: 1, now: true }); // giảm chuyển động: hiện ngay
  tw3.set('hello world');
  await tw3.finish();
  assert.deepEqual(fast, ['hello world']);
});

test('thinkingHtml + msgHtml: escape nhãn, avatar + tên Claude, bong bóng người hỏi', async () => {
  const { thinkingHtml, msgHtml } = await import('../ui/views/ai-panel.js');
  const t = thinkingHtml('Read <x>');
  assert.match(t, /class="think"/);
  assert.match(t, /Read &lt;x&gt;/);
  assert.equal((t.match(/<i><\/i>/g) ?? []).length, 3);
  assert.match(msgHtml({ role: 'ai', text: '**hi**' }), /avatar ai-av[^]*msg-name">Claude[^]*<strong>hi<\/strong>/);
  assert.match(msgHtml({ role: 'user', text: '<b>' }), /&lt;b&gt;[^]*avatar me/);
  assert.match(msgHtml({ role: 'ai', text: '', error: 'Đã dừng' }), /class="err">Đã dừng/);
});
