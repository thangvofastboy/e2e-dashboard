import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateToken, resetToken } from '../server/main.mjs';

const home = () => mkdtempSync(join(tmpdir(), 'e2ed-token-'));
const env = (h) => ({ E2E_DASHBOARD_HOME: h });

test('token: one per user, kept across calls, file is 0600', async () => {
  const h = home();
  const a = await loadOrCreateToken(env(h));
  const b = await loadOrCreateToken(env(h));
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{48}$/);
  assert.equal(statSync(join(h, 'token')).mode & 0o777, 0o600);
});

test('token: reset makes a new one and keeps the file private', async () => {
  const h = home();
  const a = await loadOrCreateToken(env(h));
  const b = await resetToken(env(h));
  assert.notEqual(a, b);
  assert.equal(await loadOrCreateToken(env(h)), b);
  assert.equal(statSync(join(h, 'token')).mode & 0o777, 0o600);
});

test('token: a broken saved value is replaced, not used', async () => {
  const h = home();
  writeFileSync(join(h, 'token'), 'abc\n');
  const t = await loadOrCreateToken(env(h));
  assert.match(t, /^[0-9a-f]{48}$/);
  assert.equal(readFileSync(join(h, 'token'), 'utf8').trim(), t);
});

test('token: a symlinked token file is refused, never read or written through', async () => {
  const h = home();
  const target = join(h, 'elsewhere');
  mkdirSync(h, { recursive: true });
  writeFileSync(target, 'x'.repeat(40));
  symlinkSync(target, join(h, 'token'));
  await assert.rejects(loadOrCreateToken(env(h)), /symlink/);
  await assert.rejects(resetToken(env(h)), /symlink/);
  assert.equal(readFileSync(target, 'utf8'), 'x'.repeat(40));
});

test('CLI token: never prints the token; reset writes a new one', async () => {
  const { main } = await import('../bin/dashboard.mjs');
  const h = home();
  const prev = process.env.E2E_DASHBOARD_HOME;
  process.env.E2E_DASHBOARD_HOME = h;
  try {
    const r1 = await main(['token', 'reset'], h);
    assert.equal(r1.code, 0);
    const before = readFileSync(join(h, 'token'), 'utf8');
    const shown = await main(['token'], h);
    assert.equal(shown.code, 0);
    assert.doesNotMatch(shown.out, /[0-9a-f]{48}/);
    assert.equal(readFileSync(join(h, 'token'), 'utf8'), before, 'show does not change the token');
    const r2 = await main(['token', 'reset'], h);
    assert.equal(r2.code, 0);
    assert.notEqual(readFileSync(join(h, 'token'), 'utf8'), before);
  } finally {
    if (prev === undefined) delete process.env.E2E_DASHBOARD_HOME;
    else process.env.E2E_DASHBOARD_HOME = prev;
  }
});
