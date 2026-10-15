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
