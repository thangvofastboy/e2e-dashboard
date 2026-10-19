import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const json = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));

test('plugin manifest names the plugin e2e-dashboard', () => {
  assert.equal(json('.claude-plugin/plugin.json').name, 'e2e-dashboard');
});

test('marketplace lists the plugin: repo root, or pinned to the tag of the current version', () => {
  const m = json('.claude-plugin/marketplace.json');
  const p = m.plugins[0];
  assert.equal(p.name, 'e2e-dashboard');
  if (p.source !== './') {
    const version = json('.claude-plugin/plugin.json').version;
    assert.deepEqual(p.source, { source: 'github', repo: 'thangvofastboy/e2e-dashboard', ref: `v${version}` });
    assert.equal(p.version, version);
  }
});

test('plugin, package and reporter versions agree', async () => {
  const { VERSION } = await import('../reporter/e2e-dashboard.reporter.mjs');
  assert.equal(json('package.json').version, json('.claude-plugin/plugin.json').version);
  assert.equal(VERSION, json('.claude-plugin/plugin.json').version);
});

test('fixture is a report-1 document', () => {
  assert.equal(json('test/fixtures/report-v1.valid.json').schemaVersion, 'report-1');
});

test('pane E2E đã gộp vào plugin: marketplace chỉ còn một plugin, không còn thư mục mod riêng', () => {
  const m = json('.claude-plugin/marketplace.json');
  assert.deepEqual(m.plugins.map((p) => p.name), ['e2e-dashboard']);
  for (const f of ['README.md', '.claude-plugin/plugin.json', 'hooks/hooks.json', 'hooks/register.tsx', 'hooks/pure.ts', 'types/index.d.ts']) {
    assert.ok(!existsSync(new URL(`../mods/e2e-dashboard-tab/${f}`, import.meta.url)), `mods/e2e-dashboard-tab/${f} đã được gộp vào plugin`);
  }
});

test('plugin: hooks.json chỉ một module (engine từ chối module thứ hai), nối cả register.ts và pane.tsx; file types được khai báo', () => {
  const plugin = json('.claude-plugin/plugin.json');
  const modules = json('hooks/hooks.json').modules;
  assert.deepEqual(modules, ['./index.ts'], 'hooks.json modules names one hooks module per plugin');
  for (const f of ['index.ts', 'register.ts', 'pane.tsx', 'pane-pure.ts']) assert.ok(existsSync(new URL(`../hooks/${f}`, import.meta.url)), `hooks/${f}`);
  const index = readFileSync(new URL('../hooks/index.ts', import.meta.url), 'utf8');
  assert.match(index, /from '\.\/pane'/);
  assert.match(index, /from '\.\/register'/);
  assert.match(index, /on\('session\.start', async \(\$, e, next\) => \{[^]*await startPlugin\(\$\)[^]*await startPane\(\$\)[^]*return next\(e\)/, 'một handler session.start gọi tĩnh cả hai phần khởi động');
  assert.match(index, /registerPlugin\(on\)[^]*registerPane\(on\)/, 'index gọi cả hai register');
  // engine: mỗi module chỉ một on("session.start") không matcher; và $ chỉ được truyền cho hàm có tên tĩnh
  const count = (f) => (readFileSync(new URL(`../hooks/${f}`, import.meta.url), 'utf8').match(/on\('session\.start'/g) ?? []).length;
  assert.deepEqual(['index.ts', 'register.ts', 'pane.tsx'].map(count), [1, 0, 0]);
  assert.equal(plugin.types, './types/index.d.ts');
  assert.ok(existsSync(new URL(`../${plugin.types}`, import.meta.url)), 'types file named in plugin.json');
});

test('pane: state và atom khoá theo tên plugin e2e-dashboard (không còn tên mod cũ); đăng ký lệnh không làm vỡ session khi mod cũ còn cài', () => {
  const name = json('.claude-plugin/plugin.json').name;
  const types = readFileSync(new URL('../types/index.d.ts', import.meta.url), 'utf8');
  assert.match(types, new RegExp(`interface PluginState \\{\\s*'${name}':`));
  const pane = readFileSync(new URL('../hooks/pane.tsx', import.meta.url), 'utf8');
  const atoms = [...pane.matchAll(/atom\(\{ plugin: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(atoms.length >= 3);
  assert.ok(atoms.every((a) => a === name), `atom phải thuộc plugin ${name}: ${atoms}`);
  assert.doesNotMatch(types + pane, /e2e-dashboard-tab/);
  assert.match(pane, /command\.register\(\{ name: 'e2e-pane'[^)]*\}\)\s*\.catch\(/, 'trùng lệnh với mod cũ không được làm vỡ session.start');
});
