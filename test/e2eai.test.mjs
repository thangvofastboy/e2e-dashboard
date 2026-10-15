import './_home.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AI_PROVIDERS, AI_IDS, detectProvider, applyAiProvider, findAgentsBlock, aiStatus, setAiProvider, setEnvKey, oauthLogins, loginArgv } from '../server/e2eai.mjs';

// đúng dạng `e2e init` (e2e 0.21): --gateway vercel và --gateway none
const VERCEL = `import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { gateway } from 'ai';

export default {
  // The Vercel AI Gateway serves the model id and reads AI_GATEWAY_API_KEY, or the OIDC token of a linked Vercel project.
  agents: {
    default: {
      model: gateway('openai/gpt-6-luna-fast'),
      system: 'You are a thorough QA agent. Verify every outcome.',
    },
  },
  targets: [{
    engine: web(),
    app: { url: process.env.APP_URL ?? 'http://localhost:3000' },
  }],
} satisfies E2EConfig;
`;
const NONE = `import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

export default {
  targets: [{ engine: web(), app: { url: 'http://localhost:3000' } }],
} satisfies E2EConfig;
`;
const project = (config, pkg = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-ai-'));
  writeFileSync(join(root, 'e2e.config.ts'), config);
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
  return root;
};

test('detectProvider theo import; không có agents = none; agents lạ = custom', () => {
  assert.equal(detectProvider(VERCEL), 'vercel');
  assert.equal(detectProvider(NONE), 'none');
  assert.equal(detectProvider("import { mistral } from '@ai-sdk/mistral';\nexport default { agents: { default: { model: mistral('x') } } };"), 'custom');
  for (const id of AI_IDS.filter((x) => x !== 'none')) assert.equal(detectProvider(applyAiProvider(NONE, id).source), id, id);
});

test('findAgentsBlock đếm ngoặc, bỏ qua ngoặc trong chuỗi và comment', () => {
  const src = "export default {\n  agents: { default: { model: x('}{'), /* } */ // }\n    system: '{' } },\n  targets: [],\n};\n";
  const b = findAgentsBlock(src);
  assert.equal(src.slice(b.end), '  targets: [],\n};\n');
});

test('applyAiProvider: đổi Vercel → Anthropic thay import, bỏ chú thích Vercel, thêm dòng đọc .env', () => {
  const r = applyAiProvider(VERCEL, 'anthropic');
  assert.ok(r.changed);
  assert.match(r.source, /import \{ anthropic \} from '@ai-sdk\/anthropic';/);
  assert.doesNotMatch(r.source, /from 'ai'/);
  assert.doesNotMatch(r.source, /Vercel AI Gateway serves/);
  assert.match(r.source, /model: anthropic\('claude-sonnet-5-5'\),/);
  assert.match(r.source, /if \(envFileExists\('\.env'\)\) process\.loadEnvFile\('\.env'\);/);
  assert.equal((r.source.match(/agents:/g) ?? []).length, 1);
  assert.equal(applyAiProvider(r.source, 'anthropic').changed, false); // chạy lại không đổi gì
  const sub = applyAiProvider(NONE, 'chatgpt');
  assert.match(sub.source, /import \{ chatgpt \} from 'e2e\/oauth\/chatgpt';/);
  assert.doesNotMatch(sub.source, /loadEnvFile/); // đăng nhập, không cần .env
  const off = applyAiProvider(r.source, 'none');
  assert.doesNotMatch(off.source, /agents|anthropic/);
  const local = applyAiProvider(NONE, 'openai-compatible', { baseURL: 'http://127.0.0.1:1234/v1', modelId: 'qwen3' });
  assert.match(local.source, /baseURL: 'http:\/\/127\.0\.0\.1:1234\/v1',[\s\S]*chatModel\('qwen3'\)/);
  assert.throws(() => applyAiProvider(NONE, 'xyz'));
});

test('aiStatus: gói còn thiếu + lệnh cài, key trong .env, đăng nhập theo oauth.json', async () => {
  const root = project(VERCEL, { devDependencies: { ai: '7' } });
  mkdirSync(join(root, 'node_modules', 'ai'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'ai', 'package.json'), '{}');
  let st = await aiStatus(root, { env: {}, os: 'linux' });
  assert.equal(st.provider, 'vercel');
  assert.deepEqual(st.missing, ['zod']);
  assert.deepEqual(st.install, ['npm', 'install', '-D', 'zod']);
  assert.equal(st.keyState, 'missing');
  await setEnvKey(root, 'AI_GATEWAY_API_KEY', 'vck_123');
  st = await aiStatus(root, { env: {}, os: 'linux' });
  assert.equal(st.keyState, 'set');
  assert.equal(st.keySource, '.env');
  if (process.platform !== 'win32') assert.equal(statSync(join(root, '.env')).mode & 0o777, 0o600);
  await setEnvKey(root, 'AI_GATEWAY_API_KEY', 'vck_456'); // thay dòng cũ, không thêm dòng
  assert.equal(readFileSync(join(root, '.env'), 'utf8'), 'AI_GATEWAY_API_KEY=vck_456\n');
  await assert.rejects(setEnvKey(root, 'X', 'a\nB=1'));
  const home = mkdtempSync(join(tmpdir(), 'e2ed-xdg-'));
  mkdirSync(join(home, 'e2e'));
  writeFileSync(join(home, 'e2e', 'oauth.json'), JSON.stringify({ 'github-copilot': { token: 'x' } }));
  assert.deepEqual(oauthLogins({ XDG_CONFIG_HOME: home }), ['github-copilot']);
  const sub = project(applyAiProvider(NONE, 'copilot').source);
  st = await aiStatus(sub, { env: { XDG_CONFIG_HOME: home }, os: 'linux' });
  assert.equal(st.loggedIn, true);
  assert.deepEqual(loginArgv(sub, 'copilot', 'linux'), ['npx', '--yes', 'e2e', 'login', 'github-copilot']);
});

test('setAiProvider ghi config và API key; từ chối baseURL lạ', async () => {
  const root = project(NONE);
  const r = await setAiProvider(root, 'openrouter', { apiKey: 'sk-or-1' });
  assert.ok(r.changed && r.keySaved);
  assert.equal(r.provider, 'openrouter');
  assert.match(readFileSync(join(root, '.env'), 'utf8'), /^OPENROUTER_API_KEY=sk-or-1$/m);
  await assert.rejects(setAiProvider(root, 'openai-compatible', { baseURL: "x'); evil(" }), (e) => e.status === 400);
});

test('danh sách provider của install.sh / install.ps1 khớp AI_PROVIDERS', () => {
  const sh = readFileSync(join(import.meta.dirname, '..', 'install.sh'), 'utf8');
  assert.deepEqual(/^AI_IDS=\(([^)]*)\)/m.exec(sh)[1].split(/\s+/), AI_IDS);
  const ps = readFileSync(join(import.meta.dirname, '..', 'install.ps1'), 'utf8');
  assert.deepEqual([...ps.matchAll(/^ {2}'([\w-]+)' = @\('(\w+)'/gm)].map((m) => [m[1], m[2]]), AI_IDS.map((id) => [id, AI_PROVIDERS[id].kind]));
});

test('claude-code (thử nghiệm): config import lớp bọc của dashboard, setAiProvider copy file vào project, aiStatus kèm cảnh báo', async () => {
  const r = applyAiProvider(NONE, 'claude-code', { modelId: 'haiku' });
  assert.match(r.source, /import \{ claudeCodeAgent \} from '\.\/e2e-dashboard\.claude-code\.mjs';/);
  assert.match(r.source, /model: claudeCodeAgent\('haiku'\),/);
  assert.doesNotMatch(r.source, /loadEnvFile/); // không cần API key
  assert.equal(detectProvider(r.source), 'claude-code');
  const root = project(NONE);
  const st = await setAiProvider(root, 'claude-code');
  assert.equal(st.kind, 'cli');
  assert.equal(st.experimental, true);
  assert.equal(st.adapterMissing, false);
  assert.ok(st.warning.some((w) => /Điều khoản Anthropic/.test(w)));
  assert.ok(st.packages.includes('ai-sdk-provider-claude-code'));
  assert.equal(readFileSync(join(root, 'e2e-dashboard.claude-code.mjs'), 'utf8'), readFileSync(join(import.meta.dirname, '..', 'reporter', 'e2e-dashboard.claude-code.mjs'), 'utf8'));
});
