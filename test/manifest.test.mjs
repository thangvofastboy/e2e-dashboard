import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const json = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));

test('plugin manifest names the plugin e2e-dashboard', () => {
  assert.equal(json('.claude-plugin/plugin.json').name, 'e2e-dashboard');
});

test('marketplace lists the plugin from repo root', () => {
  const m = json('.claude-plugin/marketplace.json');
  assert.equal(m.plugins[0].name, 'e2e-dashboard');
  assert.equal(m.plugins[0].source, './');
});

test('fixture is a report-1 document', () => {
  assert.equal(json('test/fixtures/report-v1.valid.json').schemaVersion, 'report-1');
});
