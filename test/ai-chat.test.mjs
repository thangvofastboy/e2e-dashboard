import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatRequest } from '../ui/views/ai-panel.js';

test('chatRequest: câu đầu gọi /api/ai/ask, các câu sau nối tiếp session qua /api/ai/followup', () => {
  assert.deepEqual(chatRequest(null, 'test nào flaky?'), { path: '/api/ai/ask', payload: { runId: null, question: 'test nào flaky?' } });
  assert.deepEqual(chatRequest('s-1', 'vì sao?'), { path: '/api/ai/followup', payload: { runId: null, sessionId: 's-1', question: 'vì sao?' } });
});
