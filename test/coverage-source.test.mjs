import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanSource, cleanPath, isIgnoredHost } from '../server/sourcescan.mjs';
import { changeIgnored, readIgnored, normalizeIgnoreValue } from '../server/coverageignore.mjs';

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'cov-src-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

test('scanSource finds router paths, links and service hosts; skips comments and documentation hosts', async () => {
  const root = fixture({
    'src/router.tsx': [
      "const r = [{ path: '/reports' }, { path: '/billing/orders/:id' }];",
      "// { path: '/commented/out' }",
      "/* { path: '/block/commented' } */",
      "const a = <Link to={'/billing/orders'}>x</Link>;",
      "navigate('/ims/referrals?tab=1');",
      "const img = `${base}/x.png`;",
      "const apiCall = '/api/hidden';",
    ].join('\n'),
    'src/config.ts': "export const API = 'https://whmcs.dev-fastboy.dev/api'; const doc = 'https://www.w3.org/2000/svg';",
  });
  try {
    const r = await scanSource(root);
    assert.deepEqual([...r.routes.keys()].sort(), ['/billing/orders', '/billing/orders/:id', '/ims/referrals', '/reports'].sort());
    assert.equal(r.routes.get('/reports'), 'src/router.tsx');
    assert.deepEqual(r.domains.map((d) => d.host), ['whmcs.dev-fastboy.dev']);
    assert.equal(r.domains[0].count, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scanSource returns nothing for a missing source folder; extra domainIgnore applies', async () => {
  const empty = await scanSource(join(tmpdir(), 'no-such-dir-' + Date.now()));
  assert.equal(empty.routes.size, 0);
  assert.equal(empty.domains.length, 0);
  const root = fixture({ 'src/a.ts': "fetch('https://api.partner.io/x'); fetch('https://cdn.keep.dev/y');" });
  try {
    const r = await scanSource(root, { ignore: ['partner.io'] });
    assert.deepEqual(r.domains.map((d) => d.host), ['cdn.keep.dev']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cleanPath and isIgnoredHost', () => {
  assert.equal(cleanPath('/a/b?x=1#y'), '/a/b');
  assert.equal(cleanPath('/logo.png'), null);
  assert.equal(cleanPath('/api/x'), null);
  assert.equal(cleanPath('/a/${id}'), null);
  assert.equal(cleanPath('/<[^>]*>/g'), null); // regex literal, not a route
  assert.equal(cleanPath('/a b'), null);
  assert.equal(cleanPath('/reports/:id'), '/reports/:id');
  assert.equal(isIgnoredHost('docs.w3.org'), true);
  assert.equal(isIgnoredHost('fastboy.net'), false);
});

test('coverage ignore list: add, dedupe, remove, validation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cov-ign-'));
  try {
    assert.deepEqual(await readIgnored(root), { routes: [], domains: [] });
    await changeIgnored(root, { kind: 'route', value: '/billing/orders/' });
    await changeIgnored(root, { kind: 'route', value: '/billing/orders' }); // trailing slash folded, no duplicate
    await changeIgnored(root, { kind: 'domain', value: 'https://Sentry.IO:443/x' });
    assert.deepEqual(await readIgnored(root), { routes: ['/billing/orders'], domains: ['sentry.io'] });
    assert.deepEqual(await changeIgnored(root, { kind: 'route', value: '/billing/orders', remove: true }), { routes: [], domains: ['sentry.io'] });
    for (const bad of [{ kind: 'route', value: 'billing' }, { kind: 'route', value: '/a b' }, { kind: 'domain', value: 'no_dot' }, { kind: 'x', value: '/a' }, { kind: 'route', value: '' }]) {
      await assert.rejects(changeIgnored(root, bad), (e) => e.status === 400, JSON.stringify(bad));
    }
    assert.equal(normalizeIgnoreValue('domain', 'http://a.b.dev/path'), 'a.b.dev');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
