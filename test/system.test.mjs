import './_home.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseEnv, valueState, envSummary, readEnvFile, writeEnvFile, writeUser, userSummary } from '../server/system.mjs';

const project = () => {
  const root = mkdtempSync(join(tmpdir(), 'sys-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
};

test('parseEnv reads dotenv and "key":"value" pairs, skips comments', () => {
  const m = parseEnv('# c\nexport A=1\nB="two words"\n"c_key":"x" "d":"<y>"\n');
  assert.deepEqual(Object.fromEntries(m), { A: '1', B: 'two words', c_key: 'x', d: '<y>' });
  assert.deepEqual(['x', '<token>', '', undefined].map(valueState), ['set', 'placeholder', 'empty', 'missing']);
});

test('envSummary: .env.local wins over .env, keys from .env.example listed, no values returned', async () => {
  const root = project();
  writeFileSync(join(root, '.env.example'), 'A=<a>\nB=<b>\nC=<c>\n');
  writeFileSync(join(root, '.env'), 'A=real\nB=<b>\n');
  writeFileSync(join(root, '.env.local'), 'B=local-secret\n');
  const s = await envSummary(root);
  assert.deepEqual(s.keys.map((k) => [k.key, k.state, k.from]), [['A', 'set', '.env'], ['B', 'set', '.env.local'], ['C', 'missing', null]]);
  assert.doesNotMatch(JSON.stringify(s), /real|local-secret/);
});

test('env files: only the three names, saved 0600 and git-ignored, symlinks refused', async () => {
  const root = project();
  await assert.rejects(readEnvFile(root, '../etc/passwd'), /Chỉ đọc/);
  await assert.rejects(writeEnvFile(root, 'package.json', '{}'), /Chỉ đọc/);
  const r = await writeEnvFile(root, '.env', 'A=1');
  assert.equal(r.addedToGitignore, true);
  assert.equal(readFileSync(join(root, '.env'), 'utf8'), 'A=1\n');
  assert.equal(statSync(join(root, '.env')).mode & 0o777, 0o600);
  assert.match(readFileSync(join(root, '.gitignore'), 'utf8'), /^\.env$/m);
  assert.equal((await readEnvFile(root, '.env')).content, 'A=1\n');
  symlinkSync('/etc/hostname', join(root, '.env.local'));
  await assert.rejects(writeEnvFile(root, '.env.local', 'x'), /symlink/);
  await assert.rejects(readEnvFile(root, '.env.local'), /symlink/);
});

test('user config: Linear key stored but only its last 4 chars come back; webhooks https only', async () => {
  const env = { E2E_DASHBOARD_HOME: mkdtempSync(join(tmpdir(), 'home-')) };
  const s = await writeUser(env, { linearApiKey: 'lin_api_abcdef123456', linearTeam: 'ENG' });
  assert.equal(s.linear.apiKey, '••••3456');
  assert.equal(s.linear.team, 'ENG');
  await assert.rejects(writeUser(env, { addWebhook: { url: 'http://x.dev/h' } }), /https/);
  const w = await writeUser(env, { addWebhook: { url: 'https://hooks.slack.com/a', events: ['digest', 'bogus'] } });
  assert.deepEqual(w.webhooks, [{ host: 'hooks.slack.com', events: ['digest'] }]);
  assert.deepEqual((await writeUser(env, { removeWebhook: 0, linearApiKey: null })).webhooks, []);
  assert.equal((await userSummary(env)).linear.apiKey, null);
  assert.equal(statSync(join(env.E2E_DASHBOARD_HOME, 'config.json')).mode & 0o777, 0o600);
});

test('AI model / effort: validated, stored per user, user choice beats project ai.model', async () => {
  const { aiPrefs } = await import('../server/system.mjs');
  const env = { E2E_DASHBOARD_HOME: mkdtempSync(join(tmpdir(), 'home-')) };
  assert.deepEqual(aiPrefs(env, { ai: { model: 'sonnet' } }), { model: 'sonnet', effort: undefined });
  await assert.rejects(writeUser(env, { aiModel: 'opus; echo pwned' }), /model/);
  await assert.rejects(writeUser(env, { aiEffort: 'turbo' }), /Effort/);
  const s = await writeUser(env, { aiModel: 'opus', aiEffort: 'high' });
  assert.equal(s.ai.model, 'opus');
  assert.equal(s.ai.effort, 'high');
  assert.deepEqual(aiPrefs(env, { ai: { model: 'sonnet' } }), { model: 'opus', effort: 'high' });
  await writeUser(env, { aiModel: '', aiEffort: '' });
  assert.deepEqual(aiPrefs(env), { model: undefined, effort: undefined });
});

test('createAi passes --model / --effort from settings on every run', async () => {
  const { createAi } = await import('../server/ai.mjs');
  const { EventEmitter } = await import('node:events');
  const seen = [];
  let prefs = { model: 'opus', effort: 'low' };
  const spawnImpl = (cmd, args) => {
    seen.push(args);
    const c = new EventEmitter();
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    c.stdin = { end: () => setImmediate(() => c.emit('close', 0)), on() {} };
    c.kill = () => {};
    return c;
  };
  const ai = createAi({ projectRoot: '/tmp', spawnImpl, settings: () => prefs });
  await ai.run({ prompt: 'x', onEvent() {} });
  prefs = { model: 'bad model!', effort: 'nope' };
  await ai.run({ prompt: 'x', onEvent() {} });
  assert.deepEqual(seen[0].slice(-4), ['--model', 'opus', '--effort', 'low']);
  assert.ok(!seen[1].includes('--model') && !seen[1].includes('--effort'));
});

test('a committed .env is flagged even after it is added to .gitignore', async () => {
  const { execFileSync: x } = await import('node:child_process');
  const root = project();
  writeFileSync(join(root, '.env'), 'A=1\n');
  x('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.env'], { cwd: root });
  x('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'oops'], { cwd: root });
  await writeEnvFile(root, '.env', 'A=2');
  await writeEnvFile(root, '.env', 'A=3');
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8').split('\n').filter((l) => l === '.env').length, 1); // không nhân đôi
  const f = (await envSummary(root)).files.find((y) => y.name === '.env');
  assert.equal(f.tracked, true);
});
