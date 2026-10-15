import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readE2eConfig, patchE2eConfig, parseCommand, e2eInitArgv, e2eConfigStatus, updateE2eConfig } from '../server/e2econfig.mjs';

// đúng dạng `e2e init --gateway none` (e2e 0.21) sinh ra
const INIT = `import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

export default {
  targets: [{
    engine: web(),
    app: {
      url: process.env.APP_URL ?? 'http://localhost:3000',
      // Or let the runner start the dev server:
      // command: { executable: 'npm', args: ['run', 'dev'] },
    },
  }],
} satisfies E2EConfig;
`;

test('readE2eConfig: engine, URL (kèm biến đè), lệnh đang comment = chưa có, model, reporter', () => {
  const c = readE2eConfig(INIT);
  assert.equal(c.engine, 'web');
  assert.equal(c.appUrl, 'http://localhost:3000');
  assert.equal(c.appUrlEnv, 'APP_URL');
  assert.equal(c.command, null);
  assert.equal(c.model, null);
  assert.equal(c.reporter, false);
  const ai = readE2eConfig(`import { gateway } from 'ai';\nexport default { agents: { default: { model: gateway('x') } }, targets: [{ engine: web(), app: { url: 'https://staging.example.com' } }] };`);
  assert.equal(ai.model, 'Vercel AI Gateway');
  assert.equal(ai.appUrl, 'https://staging.example.com');
  assert.equal(ai.appUrlEnv, null);
});

test('patchE2eConfig: đổi URL, bật lệnh khởi động thay dòng comment, rồi bỏ lại', () => {
  const r = patchE2eConfig(INIT, { appUrl: 'http://localhost:5173', command: 'pnpm dev --port 5173' });
  assert.deepEqual(r.changed, ['URL app', 'lệnh khởi động']);
  assert.match(r.source, /url: process\.env\.APP_URL \?\? 'http:\/\/localhost:5173',/);
  assert.match(r.source, /^ {6}command: \{ executable: 'pnpm', args: \['dev', '--port', '5173'\] \},$/m);
  assert.doesNotMatch(r.source, /Or let the runner/);
  assert.equal(readE2eConfig(r.source).command, 'pnpm dev --port 5173');
  const off = patchE2eConfig(r.source, { command: '' });
  assert.deepEqual(off.changed, ['bỏ lệnh khởi động']);
  assert.equal(readE2eConfig(off.source).command, null);
  assert.deepEqual(patchE2eConfig(r.source, { appUrl: 'http://localhost:5173', command: 'pnpm dev --port 5173' }).changed, []); // không đổi gì
});

test('patchE2eConfig: chèn lệnh sau url khi config không có dòng command; URL dạng chuỗi thường', () => {
  const src = "export default {\n  targets: [{ engine: web(), app: {\n    url: 'http://localhost:3000',\n  } }],\n};\n";
  const r = patchE2eConfig(src, { appUrl: 'http://127.0.0.1:8080', command: 'npm start' });
  assert.match(r.source, /url: 'http:\/\/127\.0\.0\.1:8080',\n {4}command: \{ executable: 'npm', args: \['start'\] \},/);
});

test('patchE2eConfig từ chối URL lạ và lệnh có ký tự shell; không đổi file', () => {
  const r = patchE2eConfig(INIT, { appUrl: 'javascript:alert(1)', command: 'npm run dev; rm -rf ~' });
  assert.equal(r.source, INIT);
  assert.equal(r.problems.length, 2);
  assert.throws(() => parseCommand("npm run 'dev'"));
  assert.equal(parseCommand('  '), null);
});

test('e2eInitArgv: không hỏi, skill + MCP cho Claude Code, chưa cài thư viện; theo trình quản lý gói', () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-cfg-'));
  assert.deepEqual(e2eInitArgv(root, { gateway: 'none', os: 'linux' }), ['npx', '--yes', 'e2e', 'init', '--yes', '--engine', 'web', '--gateway', 'none', '--skills', '.claude/skills', '--mcp', '.mcp.json', '--no-install']);
  writeFileSync(join(root, 'pnpm-lock.yaml'), '');
  assert.deepEqual(e2eInitArgv(root, { os: 'linux' }).slice(0, 4), ['pnpm', 'dlx', 'e2e', 'init']);
  assert.throws(() => e2eInitArgv(root, { gateway: 'xyz' }));
});

test('updateE2eConfig ghi file; e2eConfigStatus báo chưa có config', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-cfg-'));
  assert.deepEqual(await e2eConfigStatus(root), { exists: false, path: null });
  await assert.rejects(updateE2eConfig(root, { appUrl: 'http://x.test' }), (e) => e.status === 404);
  writeFileSync(join(root, 'e2e.config.ts'), INIT);
  const r = await updateE2eConfig(root, { appUrl: 'http://localhost:4000' });
  assert.deepEqual(r.changed, ['URL app']);
  assert.equal(r.appUrl, 'http://localhost:4000');
  assert.match(readFileSync(join(root, 'e2e.config.ts'), 'utf8'), /localhost:4000/);
});
