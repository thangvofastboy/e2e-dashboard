import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setVersion, nextVersion, releaseNotes } from '../scripts/release.mjs';

test('nextVersion bumps patch, minor, major or takes an explicit X.Y.Z', () => {
  assert.equal(nextVersion('0.1.9', 'patch'), '0.1.10');
  assert.equal(nextVersion('0.1.9', 'minor'), '0.2.0');
  assert.equal(nextVersion('0.1.9', 'major'), '1.0.0');
  assert.equal(nextVersion('0.1.9', '2.3.4'), '2.3.4');
  assert.throws(() => nextVersion('0.1.9', 'v2'), /X\.Y\.Z/);
  assert.throws(() => nextVersion('0.2.0', '0.1.0'), /greater/);
});

test('setVersion updates manifest, package, reporter and pins the marketplace to the tag', () => {
  const root = mkdtempSync(join(tmpdir(), 'rel-'));
  mkdirSync(join(root, '.claude-plugin'));
  mkdirSync(join(root, 'reporter'));
  writeFileSync(join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'e2e-dashboard', version: '0.1.0' }));
  writeFileSync(join(root, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'e2e-dashboard', plugins: [{ name: 'e2e-dashboard', source: './' }] }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'e2e-dashboard', version: '0.1.0' }));
  writeFileSync(join(root, 'reporter/e2e-dashboard.reporter.mjs'), "export const VERSION = '0.1.0';\n");
  const files = setVersion(root, '0.2.0', 'thangvofastboy/e2e-dashboard');
  assert.equal(JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8')).version, '0.2.0');
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, '0.2.0');
  assert.match(readFileSync(join(root, 'reporter/e2e-dashboard.reporter.mjs'), 'utf8'), /VERSION = '0\.2\.0'/);
  const mp = JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8')).plugins[0];
  assert.deepEqual(mp.source, { source: 'github', repo: 'thangvofastboy/e2e-dashboard', ref: 'v0.2.0' });
  assert.equal(mp.version, '0.2.0');
  assert.equal(files.length, 4);
});

test('releaseNotes takes the CHANGELOG section of the version and refuses a release without one', () => {
  const md = '# Changelog\n\n## v1.2.0 — 2026-01-02\n\n- **Mới**: a\n- **Sửa lỗi**: b\n\n## v1.1.0 — 2026-01-01\n\n- old\n';
  assert.equal(releaseNotes(md, '1.2.0'), '- **Mới**: a\n- **Sửa lỗi**: b');
  assert.equal(releaseNotes(md, '1.1.0'), '- old');
  assert.throws(() => releaseNotes(md, '1.3.0'), /chưa có mục v1.3.0/);
});
