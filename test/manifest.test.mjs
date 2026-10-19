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

test('mod e2e-dashboard-tab: marketplace entry, version, hooks module and types match the mod folder', () => {
  const entry = json('.claude-plugin/marketplace.json').plugins.find((p) => p.name === 'e2e-dashboard-tab');
  assert.equal(entry?.source, './mods/e2e-dashboard-tab');
  const mod = json('mods/e2e-dashboard-tab/.claude-plugin/plugin.json');
  assert.equal(mod.name, 'e2e-dashboard-tab');
  assert.equal(entry.version, mod.version, 'bump the mod version in plugin.json and in marketplace.json together');
  const here = (rel) => new URL(`../mods/e2e-dashboard-tab/${rel}`, import.meta.url);
  for (const m of json('mods/e2e-dashboard-tab/hooks/hooks.json').modules) assert.ok(existsSync(here(`hooks/${m}`)), `hooks module ${m}`);
  assert.ok(existsSync(here(mod.types)), 'types file named in plugin.json');
});
