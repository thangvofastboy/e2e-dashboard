// Popup 1 click setup: mở dashboard mà project còn thiếu phần cài đặt thì hỏi; đủ rồi thì không.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupNeeds, maybePromptSetup } from '../ui/setup-prompt.js';

const plan = (items, steps) => ({ items, steps, canSudo: false });

test('setupNeeds: bước tự cài theo thứ tự kế hoạch; làm tay chỉ mục bắt buộc (bỏ tuỳ chọn, mục chỉ để hiện)', () => {
  const p = plan([
    { id: 'os', ok: true, info: true },
    { id: 'gh', ok: false, optional: true, manual: true },
    { id: 'node', ok: false, manual: true },
    { id: 'deps', ok: false, cmd: ['npm', 'install'] },
    { id: 'ai-key', ok: false, manual: true, provider: 'vercel', env: 'AI_GATEWAY_API_KEY' },
    { id: 'project', ok: false, internal: true },
    { id: 'claude', ok: true },
  ], ['deps', 'project']);
  const n = setupNeeds(p);
  assert.deepEqual(n.auto.map((x) => x.id), ['deps', 'project']);
  assert.deepEqual(n.manual.map((x) => x.id), ['node', 'ai-key']);
  assert.deepEqual(setupNeeds(plan([{ id: 'git', ok: true }, { id: 'gh', ok: false, optional: true }], [])), { auto: [], manual: [] });
});

test('maybePromptSetup: không có root (bản export / server cũ) thì không hỏi, không gọi server', async () => {
  assert.equal(await maybePromptSetup(null), false);
  assert.equal(await maybePromptSetup({ version: '1' }), false);
});
