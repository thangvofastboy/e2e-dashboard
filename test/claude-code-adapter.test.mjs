// Lớp bọc claude-code (thử nghiệm): tool của AI SDK → prompt + JSON schema → tool call. Model giả, không gọi Claude thật.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withToolEmulation, claudeCodeAgent } from '../reporter/e2e-dashboard.claude-code.mjs';

const TOOLS = [
  { type: 'function', name: 'click', description: 'Click an element', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { type: 'function', name: 'complete_step', description: 'Finish', inputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } } },
];
const fake = (reply) => {
  const calls = [];
  return {
    calls,
    model: {
      specificationVersion: 'v4', provider: 'claude-code', modelId: 'haiku', supportedUrls: {},
      async doGenerate(o) {
        calls.push(o);
        return { content: [{ type: 'text', text: reply }], finishReason: { unified: 'stop', raw: 'end_turn' }, usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } }, warnings: [] };
      },
      async doStream(o) {
        calls.push(o);
        return { stream: new ReadableStream({ start: (c) => c.close() }) };
      },
    },
  };
};

test('có tool: gửi schema JSON thay cho tool, đổi JSON trả về thành tool call', async () => {
  const f = fake('```json\n{"toolCalls":[{"toolName":"click","input":{"id":"b1"}},{"toolName":"khong-co","input":{}}]}\n```');
  const m = withToolEmulation(f.model);
  const r = await m.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'Click Finish' }] }], tools: TOOLS, toolChoice: { type: 'required' }, maxOutputTokens: 100 });
  const sent = f.calls[0];
  assert.equal(sent.tools, undefined);
  assert.equal(sent.toolChoice, undefined);
  assert.equal(sent.maxOutputTokens, undefined);
  assert.equal(sent.responseFormat.type, 'json');
  assert.deepEqual(sent.responseFormat.schema.properties.toolCalls.items.properties.toolName.enum, ['click', 'complete_step']);
  assert.match(sent.prompt[0].content, /### click[\s\S]*### complete_step/);
  assert.equal(r.content.length, 1); // tool lạ bị bỏ
  assert.equal(r.content[0].type, 'tool-call');
  assert.equal(r.content[0].toolName, 'click');
  assert.equal(r.content[0].input, '{"id":"b1"}');
  assert.equal(r.finishReason.unified, 'tool-calls');
});

test('lịch sử: tool call cũ thành JSON của assistant, kết quả tool (kể cả ảnh) thành tin user', async () => {
  const f = fake('{"toolCalls":[{"toolName":"complete_step","input":{"ok":true}}]}');
  const m = withToolEmulation(f.model);
  const img = { type: 'file', data: { type: 'data', data: 'iVBOR' }, mediaType: 'image/png' };
  await m.doGenerate({
    tools: TOOLS,
    prompt: [
      { role: 'system', content: 'You are QA' },
      { role: 'user', content: [{ type: 'text', text: 'Click Finish' }] },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 't1', toolName: 'click', input: '{"id":"b1"}' }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 't1', toolName: 'click', output: { type: 'content', value: [{ type: 'text', text: 'Clicked' }, img] } }] },
    ],
  });
  const p = f.calls[0].prompt;
  assert.equal(p[1].content, 'You are QA');
  assert.deepEqual(JSON.parse(p[3].content[0].text), { toolCalls: [{ toolName: 'click', input: { id: 'b1' } }] });
  assert.equal(p[4].role, 'user');
  assert.match(p[4].content[0].text, /Result of click \(t1\)/);
  assert.equal(p[4].content[1].text, 'Clicked');
  assert.deepEqual(p[4].content[2], img);
});

test('stream có tool: phát lại thành stream-start, tool-call, finish', async () => {
  const f = fake('{"toolCalls":[{"toolName":"complete_step","input":{}}]}');
  const { stream } = await withToolEmulation(f.model).doStream({ prompt: [], tools: TOOLS });
  const parts = [];
  for await (const p of stream) parts.push(p);
  assert.deepEqual(parts.map((p) => p.type), ['stream-start', 'tool-call', 'finish']);
  assert.equal(parts[2].finishReason.unified, 'tool-calls');
});

test('không có tool: chuyển thẳng cho model; thiếu gói thì báo cách cài', async () => {
  const f = fake('hello');
  const r = await withToolEmulation(f.model).doGenerate({ prompt: [], maxOutputTokens: 50 });
  assert.equal(f.calls[0].maxOutputTokens, undefined);
  assert.equal(r.content[0].text, 'hello');
  assert.equal(f.calls[0].responseFormat, undefined);
  assert.throws(() => claudeCodeAgent('haiku'), /npm install -D ai-sdk-provider-claude-code/); // repo không cài gói này
});
