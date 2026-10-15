// AI cho bước agent của e2e: chọn nhà cung cấp model, gói npm cần cài, API key trong .env hoặc đăng nhập subscription.
// Đoạn import / model giống hệt `e2e init --gateway <id>` (e2e 0.21) sinh ra, thêm Anthropic (Claude API key).
// e2e không tự đọc .env: provider dùng API key thì config được thêm một dòng process.loadEnvFile('.env').
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile, lstat, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findConfig } from '../bin/project.mjs';
import { jsPm } from './quicksetup.mjs';
import { parseEnv, valueState, readEnvFile, writeEnvFile, tools } from './system.mjs';

// claude-code (thử nghiệm): lớp bọc giả lập tool call, copy vào project như reporter
export const CLAUDE_CODE_ADAPTER = 'e2e-dashboard.claude-code.mjs';
const ADAPTER_SRC = fileURLToPath(new URL(`../reporter/${CLAUDE_CODE_ADAPTER}`, import.meta.url));
export const CLAUDE_CODE_WARNING = [
  'THỬ NGHIỆM: e2e không hỗ trợ chính thức (e2e khuyên dùng API key cho gói Claude: chọn anthropic).',
  'Điều khoản Anthropic không cho sản phẩm bên thứ ba dùng đăng nhập claude.ai nếu chưa được duyệt: chỉ nên tự dùng trên máy mình, không bật cho cả team.',
  'Test e2e ăn chung hạn mức với Claude Code của bạn; mỗi lượt model khởi động một tiến trình Claude Code nên chậm hơn API key.',
];

const SYSTEM = "system: 'You are a thorough QA agent. Verify every outcome.',";
const BASE = ['ai', 'zod'];

// thứ tự = thứ tự trong menu chọn
export const AI_PROVIDERS = {
  vercel: { label: 'Vercel AI Gateway (một key, nhiều model)', kind: 'key', env: 'AI_GATEWAY_API_KEY', keyUrl: 'https://vercel.com/ai-gateway', packages: [...BASE], from: 'ai', ident: 'gateway', model: () => "gateway('openai/gpt-6-luna-fast')" },
  anthropic: { label: 'Anthropic Claude (API key, kể cả credit API của gói Max/Team)', kind: 'key', env: 'ANTHROPIC_API_KEY', keyUrl: 'https://console.anthropic.com/settings/keys', packages: [...BASE, '@ai-sdk/anthropic'], from: '@ai-sdk/anthropic', ident: 'anthropic', model: () => "anthropic('claude-sonnet-5-5')" },
  openrouter: { label: 'OpenRouter (API key)', kind: 'key', env: 'OPENROUTER_API_KEY', keyUrl: 'https://openrouter.ai/keys', packages: [...BASE, '@openrouter/ai-sdk-provider'], from: '@openrouter/ai-sdk-provider', ident: 'openrouter', model: () => "openrouter('openai/gpt-6-luna-fast')" },
  openai: { label: 'OpenAI (API key)', kind: 'key', env: 'OPENAI_API_KEY', keyUrl: 'https://platform.openai.com/api-keys', packages: [...BASE, '@ai-sdk/openai'], from: '@ai-sdk/openai', ident: 'openai', model: () => "openai('gpt-6-luna')" },
  chatgpt: { label: 'Gói ChatGPT Plus / Pro (đăng nhập)', kind: 'login', login: 'openai', packages: [...BASE, '@ai-sdk/openai'], from: 'e2e/oauth/chatgpt', ident: 'chatgpt', model: () => "chatgpt('gpt-6-luna')" },
  copilot: { label: 'GitHub Copilot (đăng nhập)', kind: 'login', login: 'github-copilot', packages: [...BASE, '@ai-sdk/openai-compatible', '@ai-sdk/openai'], from: 'e2e/oauth/copilot', ident: 'copilot', model: () => "copilot('claude-sonnet-5')" },
  'opencode-console': { label: 'OpenCode Console (đăng nhập)', kind: 'login', login: 'opencode-console', packages: [...BASE, '@ai-sdk/openai-compatible', '@ai-sdk/openai', '@ai-sdk/anthropic', '@ai-sdk/google'], from: 'e2e/oauth/opencode-console', ident: 'opencodeConsole', model: () => "opencodeConsole('deepseek-v4.1-flash')" },
  grok: { label: 'SuperGrok / X Premium+ (đăng nhập)', kind: 'login', login: 'spacexai', packages: [...BASE, '@ai-sdk/xai'], from: 'e2e/oauth/grok', ident: 'grok', model: () => "grok('grok-4')" },
  'claude-code': { label: 'Claude Code CLI: đăng nhập Pro/Max của `claude` (THỬ NGHIỆM)', kind: 'cli', experimental: true, packages: [...BASE, 'ai-sdk-provider-claude-code'], from: `./${CLAUDE_CODE_ADAPTER}`, ident: 'claudeCodeAgent', model: ({ modelId = 'sonnet' } = {}) => `claudeCodeAgent(${q(modelId)})` },
  'openai-compatible': {
    label: 'Model local / OpenAI-compatible (Ollama, LM Studio…)', kind: 'local', env: 'LLM_API_KEY', packages: [...BASE, '@ai-sdk/openai-compatible'], from: '@ai-sdk/openai-compatible', ident: 'createOpenAICompatible',
    model: ({ baseURL = 'http://127.0.0.1:11434/v1', modelId = 'gpt-6-luna' } = {}) => `createOpenAICompatible({\n        name: 'openai-compatible',\n        baseURL: ${q(baseURL)},\n        supportsStructuredOutputs: true,\n        apiKey: process.env.LLM_API_KEY,\n      }).chatModel(${q(modelId)})`,
  },
  none: { label: 'Không dùng AI (chỉ test bằng locator)', kind: 'none', packages: [] },
};
export const AI_IDS = Object.keys(AI_PROVIDERS);

function q(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
const importLine = (p) => `import { ${p.ident} } from '${p.from}';`;
const importRe = (p) => new RegExp(`^import\\s*\\{\\s*${p.ident}\\s*\\}\\s*from\\s*['"]${p.from.replace(/[/.]/g, '\\$&')}['"];?[ \\t]*\\n`, 'm');

// provider đang dùng trong config: theo import; có agents mà không nhận ra → custom
export function detectProvider(source) {
  if (!/\bagents\s*:/.test(source)) return 'none';
  for (const [id, p] of Object.entries(AI_PROVIDERS)) if (p.from && importRe(p).test(source)) return id;
  return 'custom';
}

// khối `agents: { … },` (kể cả dấu phẩy và xuống dòng sau nó): đếm ngoặc, bỏ qua chuỗi và comment
export function findAgentsBlock(source) {
  const m = /^([ \t]*)agents\s*:\s*\{/m.exec(source);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < source.length && depth) {
    const c = source[i];
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < source.length && source[i] !== c; i++) if (source[i] === '\\') i++;
    } else if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
    } else if (c === '/' && source[i + 1] === '*') {
      i = source.indexOf('*/', i + 2) + 1 || source.length;
    } else if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  if (depth) return null;
  const tail = /^[ \t]*,?[ \t]*\n?/.exec(source.slice(i))[0];
  return { start: m.index, end: i + tail.length, indent: m[1] };
}

const ENV_LOADER = "if (envFileExists('.env')) process.loadEnvFile('.env'); // e2e không tự đọc .env (API key của model)";
const ENV_IMPORT = "import { existsSync as envFileExists } from 'node:fs';";

function addImport(source, line) {
  if (source.includes(line)) return source;
  const imports = [...source.matchAll(/^import\b[^\n]*\n/gm)];
  if (!imports.length) return `${line}\n${source}`;
  const last = imports.at(-1);
  const at = last.index + last[0].length;
  return source.slice(0, at) + line + '\n' + source.slice(at);
}

// đổi provider trong source. opts: baseURL, modelId (openai-compatible)
export function applyAiProvider(source, id, opts = {}) {
  const p = AI_PROVIDERS[id];
  if (!p) throw Object.assign(new Error(`Provider phải là một trong: ${AI_IDS.join(', ')}`), { status: 400 });
  let out = source;
  const block = findAgentsBlock(out);
  const indent = block?.indent ?? '  ';
  const fresh = id === 'none' ? '' : `${indent}agents: {\n${indent}  default: {\n${indent}    model: ${p.model(opts)},\n${indent}    ${SYSTEM}\n${indent}  },\n${indent}},\n`;
  if (block) out = out.slice(0, block.start) + fresh + out.slice(block.end);
  else if (fresh) {
    const head = /export\s+default\s+(defineConfig\s*\(\s*)?\{[ \t]*\n/.exec(out);
    if (!head) return { source, changed: false, problem: 'Không thấy `export default {` trong config: thêm agents tay' };
    out = out.slice(0, head.index + head[0].length) + fresh + out.slice(head.index + head[0].length);
  }
  // chú thích `e2e init` viết riêng cho Vercel AI Gateway
  if (id !== 'vercel') out = out.replace(/^[ \t]*\/\/ The Vercel AI Gateway serves[^\n]*\n/m, '');
  // bỏ import của provider cũ không còn dùng
  for (const other of Object.values(AI_PROVIDERS)) {
    if (!other.from || other === p) continue;
    const re = importRe(other);
    if (re.test(out) && !new RegExp(`\\b${other.ident}\\b`).test(out.replace(re, ''))) out = out.replace(re, '');
  }
  if (p.from) out = addImport(out, importLine(p));
  if ((p.kind === 'key' || p.kind === 'local') && !/loadEnvFile/.test(out)) {
    out = addImport(out, ENV_IMPORT);
    const imports = [...out.matchAll(/^import\b[^\n]*\n/gm)];
    const at = imports.at(-1).index + imports.at(-1)[0].length;
    out = `${out.slice(0, at)}\n${ENV_LOADER}\n${out.slice(at)}`;
  }
  return { source: out, changed: out !== source };
}

// đăng nhập subscription của e2e: ~/.config/e2e/oauth.json (hoặc E2E_OAUTH_CREDENTIALS), khoá theo provider. Chỉ đọc tên khoá
export function oauthLogins(env = process.env) {
  try {
    const raw = env.E2E_OAUTH_CREDENTIALS || readFileSync(join(env.XDG_CONFIG_HOME || join(env.HOME || env.USERPROFILE || homedir(), '.config'), 'e2e', 'oauth.json'), 'utf8');
    return Object.keys(JSON.parse(raw) ?? {});
  } catch {
    return [];
  }
}

const installed = (root, name) => existsSync(join(root, 'node_modules', ...name.split('/'), 'package.json'));
const readPkg = (root) => {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
};

export function loginArgv(root, id, os = process.platform) {
  const p = AI_PROVIDERS[id];
  if (p?.kind !== 'login') return null;
  const local = join(root, 'node_modules', 'e2e', 'package.json');
  const ext = os === 'win32' ? '.cmd' : '';
  return existsSync(local) ? [`npx${ext}`, 'e2e', 'login', p.login] : [`npx${ext}`, '--yes', 'e2e', 'login', p.login];
}

// trạng thái AI của project: provider, gói còn thiếu (+ lệnh cài), key trong .env / env, đăng nhập
export async function aiStatus(root, { env = process.env, os = process.platform } = {}) {
  const path = findConfig(root);
  const source = path ? await readFile(path, 'utf8') : '';
  const id = path ? detectProvider(source) : 'none';
  const p = AI_PROVIDERS[id];
  const pkg = readPkg(root);
  const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const js = jsPm(root, os);
  const missing = (p?.packages ?? []).filter((n) => !declared[n] || (!js.pnp && !installed(root, n)));
  const out = { config: Boolean(path), provider: id, label: p?.label ?? 'Model tuỳ chỉnh (không nhận ra provider)', kind: p?.kind ?? 'custom', packages: p?.packages ?? [], missing, install: missing.length ? [js.bin, ...js.add, ...missing] : null, installDisplay: missing.length ? [js.name, ...js.add, ...missing].join(' ') : null };
  if (p?.env) {
    const dot = existsSync(join(root, '.env')) ? parseEnv(readFileSync(join(root, '.env'), 'utf8')).get(p.env) : undefined;
    out.env = p.env;
    out.keyUrl = p.keyUrl ?? null;
    out.keyState = valueState(dot ?? env[p.env]);
    out.keySource = dot != null ? '.env' : env[p.env] != null ? 'biến môi trường' : null;
    out.loadsEnv = /loadEnvFile/.test(source);
  }
  if (p?.kind === 'cli') {
    out.experimental = true;
    out.warning = CLAUDE_CODE_WARNING;
    out.claude = Boolean(tools().claude);
    out.adapterMissing = !existsSync(join(root, CLAUDE_CODE_ADAPTER));
  }
  if (p?.kind === 'login') {
    out.login = p.login;
    out.loggedIn = oauthLogins(env).includes(p.login);
    out.loginDisplay = loginArgv(root, id, os).join(' ').replace(/\.cmd\b/, '');
  }
  return out;
}

// ghi / thay KEY=value trong .env (0600, tự vào .gitignore qua writeEnvFile)
export async function setEnvKey(root, name, value) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw Object.assign(new Error('Tên biến không hợp lệ'), { status: 400 });
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) throw Object.assign(new Error('Giá trị key không hợp lệ'), { status: 400 });
  const cur = (await readEnvFile(root, '.env')).content;
  const line = `${name}=${value.trim()}`;
  const re = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=.*$`, 'm');
  const next = re.test(cur) ? cur.replace(re, line) : `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${line}\n`;
  return writeEnvFile(root, '.env', next);
}

// đổi provider trong e2e.config.* (ghi file) và tuỳ chọn ghi API key vào .env
export async function setAiProvider(root, id, { apiKey, baseURL, modelId } = {}) {
  const path = findConfig(root);
  if (!path) throw Object.assign(new Error('Project chưa có e2e.config.*'), { status: 404 });
  if ((await lstat(path)).isSymbolicLink()) throw new Error(`Từ chối ghi qua symlink: ${path}`);
  if (baseURL !== undefined && !/^https?:\/\/[^\s'"]+$/.test(baseURL)) throw Object.assign(new Error('baseURL phải là http(s)://…'), { status: 400 });
  if (modelId !== undefined && !/^[\w.:/@-]{1,100}$/.test(modelId)) throw Object.assign(new Error('Model id không hợp lệ'), { status: 400 });
  const r = applyAiProvider(await readFile(path, 'utf8'), id, { baseURL, modelId });
  if (r.problem) throw Object.assign(new Error(r.problem), { status: 422 });
  if (id === 'claude-code') await copyAdapter(root);
  if (r.changed) await writeFile(path, r.source);
  const env = AI_PROVIDERS[id].env;
  if (apiKey && env) await setEnvKey(root, env, apiKey);
  return { changed: r.changed, keySaved: Boolean(apiKey && env), ...(await aiStatus(root)) };
}

// copy (hoặc làm mới) lớp bọc claude-code vào project; không ghi qua symlink
export async function copyAdapter(root) {
  const dest = join(root, CLAUDE_CODE_ADAPTER);
  if (existsSync(dest) && (await lstat(dest)).isSymbolicLink()) throw new Error(`Từ chối ghi qua symlink: ${dest}`);
  await copyFile(ADAPTER_SRC, dest);
  return dest;
}
