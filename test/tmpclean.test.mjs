import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CLEAN = fileURLToPath(new URL('./_tmpclean.mjs', import.meta.url));
const MAKE = `
  import { mkdtempSync, writeFileSync } from 'node:fs';
  import { mkdtemp } from 'node:fs/promises';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  const a = mkdtempSync(join(tmpdir(), 'tmpclean-a-'));
  const b = await mkdtemp(join(tmpdir(), 'tmpclean-b-'));
  writeFileSync(join(a, 'f'), 'x'.repeat(1000));
  writeFileSync(join(b, 'f'), 'x'.repeat(1000));
  console.log(JSON.stringify([a, b]));`;
const run = (extra) => JSON.parse(spawnSync(process.execPath, [...extra, '--input-type=module', '-e', MAKE], { encoding: 'utf8' }).stdout);

test('without the preload a test process leaves its temp dirs behind (the leak that filled tmpfs)', () => {
  const dirs = run([]);
  try {
    assert.ok(dirs.every(existsSync));
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
});

test('with the preload, mkdtempSync and fs/promises mkdtemp dirs are gone when the process exits', () => {
  const dirs = run(['--import', CLEAN]);
  assert.equal(dirs.length, 2);
  assert.deepEqual(dirs.map(existsSync), [false, false]);
});

test('npm test loads the preload, so the suite cannot leak temp dirs again', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts.test, /--import \.\/test\/_tmpclean\.mjs/);
});
