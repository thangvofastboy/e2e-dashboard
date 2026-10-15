// e2e-dashboard (THỬ NGHIỆM): chạy bước agent của e2e bằng Claude Code CLI (đăng nhập Pro/Max của `claude`),
// qua gói cộng đồng ai-sdk-provider-claude-code. File do `/e2e-dashboard ai --provider claude-code` copy vào project.
//
// Vì sao cần lớp bọc: agent của e2e gọi model kèm tool (và bắt buộc gọi tool), còn Claude Code CLI chỉ chạy tool
// của chính nó: gói kia bỏ qua tool của AI SDK, nên agent không bao giờ gọi được complete_step. Lớp bọc này mô tả các
// tool trong prompt, buộc Claude trả JSON theo schema (structured output của Claude Code), rồi đổi JSON đó thành
// tool call cho e2e. Lịch sử tool call / kết quả (kể cả ảnh chụp màn hình) được đổi thành tin nhắn thường.
//
// Lưu ý: không phải cách e2e hỗ trợ chính thức (e2e khuyên dùng API key cho gói Claude); test e2e dùng chung hạn mức
// với Claude Code của bạn; mỗi lượt model khởi động một tiến trình Claude Code nên chậm hơn API key.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// nạp lười: thiếu gói thì báo cách cài thay vì lỗi import khó hiểu khi e2e đọc config
let provider = null;
try {
  provider = await import('ai-sdk-provider-claude-code');
} catch {
  // báo ở claudeCodeAgent()
}

const RULES = [
  'You are driving an end-to-end test through tools. Reply ONLY with JSON matching the response schema: {"toolCalls":[{"toolName": "...", "input": {...}}]}.',
  'Call one or more of the tools listed below; "input" must match that tool\'s JSON schema exactly. Never answer in prose.',
];

const randomId = () => `cc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

function toolsText(tools) {
  return tools
    .filter((t) => t.type === 'function')
    .map((t) => `### ${t.name}\n${t.description ?? ''}\nInput JSON schema: ${JSON.stringify(t.inputSchema ?? { type: 'object' })}`)
    .join('\n\n');
}

function resultParts(output) {
  switch (output?.type) {
    case 'text':
    case 'error-text':
      return [{ type: 'text', text: `${output.type === 'error-text' ? 'ERROR: ' : ''}${output.value}` }];
    case 'json':
    case 'error-json':
      return [{ type: 'text', text: `${output.type === 'error-json' ? 'ERROR: ' : ''}${JSON.stringify(output.value)}` }];
    case 'execution-denied':
      return [{ type: 'text', text: `Execution denied${output.reason ? `: ${output.reason}` : ''}` }];
    case 'content':
      return output.value.flatMap((v) => (v.type === 'text' ? [{ type: 'text', text: v.text }] : v.type === 'file' ? [{ type: 'file', data: v.data, mediaType: v.mediaType }] : []));
    default:
      return [{ type: 'text', text: JSON.stringify(output ?? null) }];
  }
}

// prompt có tool → prompt thường: tool call cũ thành JSON của assistant, kết quả tool thành tin nhắn user (kèm ảnh)
function convertPrompt(prompt, tools, toolChoice) {
  const required = toolChoice?.type === 'tool' ? `\nYou MUST call the tool "${toolChoice.toolName}".` : '';
  const out = [{ role: 'system', content: `${RULES.join('\n')}${required}\n\nAvailable tools:\n\n${toolsText(tools)}` }];
  for (const m of prompt) {
    if (m.role === 'system') out.push(m);
    else if (m.role === 'user') out.push(m);
    else if (m.role === 'assistant') {
      const calls = m.content.filter((p) => p.type === 'tool-call').map((p) => ({ toolName: p.toolName, input: typeof p.input === 'string' ? safeJson(p.input) : p.input, id: p.toolCallId }));
      const text = m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
      const parts = [];
      if (text) parts.push({ type: 'text', text });
      if (calls.length) parts.push({ type: 'text', text: JSON.stringify({ toolCalls: calls.map(({ toolName, input }) => ({ toolName, input })) }) });
      if (parts.length) out.push({ role: 'assistant', content: parts });
      // kết quả tool nằm ngay trong tin assistant (tool do provider chạy): đổi luôn thành tin user
      const inline = m.content.filter((p) => p.type === 'tool-result');
      if (inline.length) out.push({ role: 'user', content: inline.flatMap((p) => [{ type: 'text', text: `Result of ${p.toolName} (${p.toolCallId}):` }, ...resultParts(p.output)]) });
    } else if (m.role === 'tool') {
      const content = m.content.filter((p) => p.type === 'tool-result').flatMap((p) => [{ type: 'text', text: `Result of ${p.toolName} (${p.toolCallId}):` }, ...resultParts(p.output)]);
      if (content.length) out.push({ role: 'user', content });
    }
  }
  return out;
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function responseSchema(tools) {
  const names = tools.filter((t) => t.type === 'function').map((t) => t.name);
  return {
    type: 'object',
    properties: {
      toolCalls: {
        type: 'array',
        minItems: 1,
        items: { type: 'object', properties: { toolName: { type: 'string', enum: names }, input: { type: 'object' } }, required: ['toolName', 'input'] },
      },
    },
    required: ['toolCalls'],
  };
}

// JSON đầu tiên trong câu trả lời (Claude đôi khi bọc trong ```json)
function parseCalls(text, tools) {
  const names = new Set(tools.map((t) => t.name));
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const data = start >= 0 && end > start ? safeJson(text.slice(start, end + 1)) : {};
  const list = Array.isArray(data.toolCalls) ? data.toolCalls : data.toolName ? [data] : [];
  return list.filter((c) => c && names.has(c.toolName)).map((c) => ({ type: 'tool-call', toolCallId: randomId(), toolName: c.toolName, input: JSON.stringify(c.input ?? {}) }));
}

// structured output của Claude Code đi qua một tool nội bộ: gói kia cảnh báo "unknown tool ID" mỗi lượt, bỏ dòng đó
const quietLogger = {
  debug() {},
  info() {},
  warn: (m, ...a) => !/unknown tool ID/i.test(String(m)) && console.warn(m, ...a),
  error: (m, ...a) => console.error(m, ...a),
};

export function claudeCodeAgent(modelId = 'sonnet', settings = {}) {
  if (!provider) throw new Error('Thiếu gói ai-sdk-provider-claude-code: chạy `npm install -D ai-sdk-provider-claude-code` (hoặc /e2e-dashboard ai --provider claude-code)');
  // không cho Claude Code dùng tool riêng (Bash, Read…), không đọc CLAUDE.md: chỉ là một model. Không tắt lưu phiên
  // (persistSession: false làm Claude Code không trả được structured output); thay vào đó chạy trong một thư mục
  // tạm riêng để các phiên này không lẫn vào lịch sử /resume của project
  const cwd = join(tmpdir(), 'e2e-dashboard-claude-code');
  mkdirSync(cwd, { recursive: true });
  return withToolEmulation(provider.claudeCode(modelId, { tools: [], verbatimPrompts: true, logger: quietLogger, cwd, ...settings }), modelId);
}

// Claude Code không nhận giới hạn token: bỏ để khỏi cảnh báo mỗi lượt
const noCap = ({ maxOutputTokens: _cap, ...o }) => o;

// bọc một LanguageModelV4 không biết tool: tool → prompt + JSON schema, JSON trả về → tool call
export function withToolEmulation(inner, modelId = inner.modelId) {
  const withTools = (o) => Array.isArray(o.tools) && o.tools.some((t) => t.type === 'function') && o.toolChoice?.type !== 'none';

  async function generate(options) {
    const { tools, toolChoice, ...rest } = noCap(options);
    const fnTools = tools.filter((t) => t.type === 'function');
    const r = await inner.doGenerate({ ...rest, prompt: convertPrompt(options.prompt, fnTools, toolChoice), responseFormat: { type: 'json', schema: responseSchema(fnTools), name: 'tool_calls' } });
    const text = r.content.filter((p) => p.type === 'text').map((p) => p.text).join('');
    const calls = parseCalls(text, fnTools);
    const content = calls.length ? calls : [{ type: 'text', text }];
    return { ...r, content, finishReason: { unified: calls.length ? 'tool-calls' : 'stop', raw: r.finishReason?.raw } };
  }

  return {
    specificationVersion: inner.specificationVersion,
    provider: 'claude-code',
    modelId: inner.modelId ?? modelId,
    supportedUrls: inner.supportedUrls ?? {},
    doGenerate: (options) => (withTools(options) ? generate(options) : inner.doGenerate(noCap(options))),
    async doStream(options) {
      if (!withTools(options)) return inner.doStream(noCap(options));
      // tool call cần cả JSON mới đọc được: sinh xong rồi phát lại thành stream
      const r = await generate(options);
      const stream = new ReadableStream({
        start(c) {
          c.enqueue({ type: 'stream-start', warnings: r.warnings ?? [] });
          if (r.response) c.enqueue({ type: 'response-metadata', ...r.response });
          for (const part of r.content) {
            if (part.type === 'text') {
              const id = randomId();
              c.enqueue({ type: 'text-start', id });
              c.enqueue({ type: 'text-delta', id, delta: part.text });
              c.enqueue({ type: 'text-end', id });
            } else c.enqueue(part);
          }
          c.enqueue({ type: 'finish', finishReason: r.finishReason, usage: r.usage, providerMetadata: r.providerMetadata });
          c.close();
        },
      });
      return { stream, request: r.request, response: r.response };
    },
  };
}
