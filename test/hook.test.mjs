import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleHook, outputFlag, E2E_COMMAND } from '../bin/archive.mjs';
import { findProjectRoot } from '../bin/project.mjs';

const fixture = readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8');
const SCRIPT = fileURLToPath(new URL('../bin/archive.mjs', import.meta.url));

function project(output = '.e2e') {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  writeFileSync(join(root, 'e2e.config.ts'), 'export default {}');
  mkdirSync(join(root, output), { recursive: true });
  writeFileSync(join(root, output, 'report.json'), fixture);
  mkdirSync(join(root, 'tests/sub'), { recursive: true });
  return root;
}

test('matches e2e run/explore commands only', () => {
  for (const c of ['npx e2e run', 'pnpm exec e2e run tests/a.e2e.ts', "bunx e2e explore 'checkout'", 'cd app && npx e2e run --retries 2'])
    assert.ok(E2E_COMMAND.test(c), c);
  for (const c of ['npx e2e init', 'ls e2e', 'npx e2e-dashboard run', 'echo e2e'])
    assert.ok(!E2E_COMMAND.test(c), c);
});

test('reads --output from the command', () => {
  assert.equal(outputFlag('npx e2e run --output out'), 'out');
  assert.equal(outputFlag('npx e2e run --output=out/x'), 'out/x');
  assert.equal(outputFlag('npx e2e run'), undefined);
});

test('finds the project root from a nested cwd', () => {
  const root = project();
  assert.equal(findProjectRoot(join(root, 'tests/sub')), root);
  assert.equal(findProjectRoot(tmpdir()), null);
});

test('archives after an e2e run, honouring --output', async () => {
  const root = project('out');
  const res = await handleHook({ cwd: join(root, 'tests/sub'), tool_input: { command: 'npx e2e run --output out' } }, {});
  assert.equal(res.status, 'archived');
});

test('ignores other commands', async () => {
  const root = project();
  assert.equal((await handleHook({ cwd: root, tool_input: { command: 'git status' } }, {})).status, 'ignored');
});

test('script exits 0 even on garbage stdin', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { input: 'not json' });
  assert.equal(r.status, 0);
});
