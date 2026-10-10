import './_home.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { patchConfig, setup, start, stop, main } from '../bin/dashboard.mjs';

const IMPORT = "import dashboardReporter from './e2e-dashboard.reporter.mjs';";

test('patchConfig adds the reporter to an existing reporters array', () => {
  const src = "import { web } from '@e2e-dev/web';\nexport default {\n  reporters: ['list', 'junit'],\n};\n";
  const r = patchConfig(src);
  assert.equal(r.patched, true);
  assert.ok(r.source.includes(IMPORT));
  assert.match(r.source, /reporters: \['list', 'junit', dashboardReporter\]/);
  assert.ok(r.source.indexOf(IMPORT) > r.source.indexOf("from '@e2e-dev/web'"));
});

test('patchConfig keeps list output when the config had no reporters', () => {
  for (const src of [
    "export default {\n  targets: [],\n} satisfies E2EConfig;\n",
    "import { defineConfig } from 'e2e';\nexport default defineConfig({\n  targets: [],\n});\n",
  ]) {
    const r = patchConfig(src);
    assert.equal(r.patched, true, src);
    assert.match(r.source, /reporters: \['list', dashboardReporter\],/);
  }
});

test('patchConfig is idempotent and refuses unknown shapes', () => {
  const once = patchConfig("export default {\n  targets: [],\n};\n").source;
  assert.deepEqual(patchConfig(once), { source: once, patched: false, reason: 'already' });
  const odd = 'const config = makeConfig();\nexport default config;\n';
  assert.deepEqual(patchConfig(odd), { source: odd, patched: false, reason: 'unknown-shape' });
});

function project(config = "export default {\n  targets: [],\n};\n") {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  writeFileSync(join(root, 'e2e.config.ts'), config);
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
  return root;
}

test('setup copies reporter + types, patches config, gitignore is idempotent', async () => {
  const root = project();
  await setup(root);
  await setup(root);
  assert.ok(existsSync(join(root, 'e2e-dashboard.reporter.mjs')));
  assert.ok(existsSync(join(root, 'e2e-dashboard.reporter.d.mts')));
  assert.match(readFileSync(join(root, 'e2e.config.ts'), 'utf8'), /dashboardReporter\]/);
  const gi = readFileSync(join(root, '.gitignore'), 'utf8');
  assert.equal(gi.split('\n').filter((l) => l === '.e2e-dashboard/').length, 1);
});

test('setup asks for a manual edit when the config shape is unknown', async () => {
  const root = project('export default makeConfig();\n');
  const lines = await setup(root);
  assert.ok(lines.some((l) => l.startsWith('NEEDS_MANUAL_EDIT')));
});

test('start spawns a detached server, second start reuses it, stop ends it', async () => {
  const root = project();
  const a = await start(root, { open: false });
  try {
    assert.equal(a.reused, false);
    assert.equal(readFileSync(join(root, '.e2e-dashboard/.gitignore'), 'utf8'), '*\n');
    assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), 'node_modules/\n');
    const b = await start(root, { open: false });
    assert.equal(b.reused, true);
    assert.equal(b.url, a.url);
    const { token, port } = JSON.parse(readFileSync(join(root, '.e2e-dashboard/server.json'), 'utf8'));
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/info`, { headers: { 'x-e2e-dashboard-token': token } })).status, 200);
  } finally {
    assert.equal(await stop(root), true);
  }
  assert.equal(existsSync(join(root, '.e2e-dashboard/server.json')), false);
  assert.equal(await stop(root), false);
});

test('stale server.json (dead pid) is replaced', async () => {
  const root = project();
  await setup(root); // creates .e2e-dashboard/
  writeFileSync(join(root, '.e2e-dashboard/server.json'), JSON.stringify({ port: 1, pid: 2 ** 22 + 12345, token: 'x' }));
  const s = await start(root, { open: false });
  try {
    assert.equal(s.reused, false);
  } finally {
    await stop(root);
  }
});

test('main reports a missing e2e project', async () => {
  const r = await main([], mkdtempSync(join(tmpdir(), 'e2ed-')));
  assert.equal(r.code, 1);
  assert.match(r.out, /e2e\.config/);
});

test('setup refuses to write through symlinks planted in the repo', async () => {
  const { symlinkSync, mkdirSync: mk } = await import('node:fs');
  for (const name of ['.gitignore', 'e2e-dashboard.reporter.mjs', 'e2e-dashboard.reporter.d.mts']) {
    const root = project();
    const outside = mkdtempSync(join(tmpdir(), 'victim-'));
    writeFileSync(join(outside, 'precious'), 'keep me');
    if (name === '.gitignore') {
      const { rmSync } = await import('node:fs');
      rmSync(join(root, '.gitignore'));
    }
    symlinkSync(join(outside, 'precious'), join(root, name));
    await assert.rejects(setup(root), /symlink/, name);
    assert.equal(readFileSync(join(outside, 'precious'), 'utf8'), 'keep me', name);
  }
});

test('start refuses a symlinked server.log', async () => {
  const { symlinkSync, mkdirSync: mk } = await import('node:fs');
  const root = project();
  mk(join(root, '.e2e-dashboard'), { recursive: true });
  const outside = mkdtempSync(join(tmpdir(), 'victim-'));
  writeFileSync(join(outside, 'precious'), 'keep me');
  symlinkSync(join(outside, 'precious'), join(root, '.e2e-dashboard/server.log'));
  await assert.rejects(start(root, { open: false }), /symlink/);
  assert.equal(readFileSync(join(outside, 'precious'), 'utf8'), 'keep me');
});

test('stop never signals a pid that is not our dashboard', async () => {
  const { spawn } = await import('node:child_process');
  const root = project();
  await setup(root);
  const victim = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
  try {
    writeFileSync(join(root, '.e2e-dashboard/server.json'), JSON.stringify({ port: 9, pid: victim.pid, token: 'x' }));
    assert.equal(await stop(root), false);
    assert.doesNotThrow(() => process.kill(victim.pid, 0), 'victim still alive');
    assert.equal(existsSync(join(root, '.e2e-dashboard/server.json')), false);
  } finally {
    victim.kill();
  }
});
