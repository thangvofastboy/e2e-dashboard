import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { watchReport, outputFromArtifactsRoot } from '../server/watch.mjs';

const fixture = readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8');
const waitFor = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};
const runCount = (root) => (existsSync(join(root, '.e2e-dashboard/runs')) ? readdirSync(join(root, '.e2e-dashboard/runs')).filter((n) => !n.startsWith('.')).length : 0);

test('outputFromArtifactsRoot strips a trailing results dir', () => {
  assert.equal(outputFromArtifactsRoot('/p/.e2e/results'), '/p/.e2e');
  assert.equal(outputFromArtifactsRoot('/p/out'), '/p/out');
});

test('archives when report.json appears, ignoring a half-written file first', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  mkdirSync(join(root, '.e2e'));
  const results = [];
  const w = watchReport({ projectRoot: root, outputDir: join(root, '.e2e'), debounceMs: 50, onResult: (r) => results.push(r) });
  try {
    writeFileSync(join(root, '.e2e/report.json'), fixture.slice(0, 40));
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(runCount(root), 0);
    writeFileSync(join(root, '.e2e/report.json'), fixture);
    assert.ok(await waitFor(() => runCount(root) === 1), 'run archived');
    assert.ok(results.some((r) => r.status === 'archived'));
  } finally {
    w.close();
  }
});

test('output dir that does not exist yet is picked up once created', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  const w = watchReport({ projectRoot: root, outputDir: join(root, '.e2e'), debounceMs: 50 });
  try {
    mkdirSync(join(root, '.e2e'));
    await new Promise((r) => setTimeout(r, 1200));
    writeFileSync(join(root, '.e2e/report.json'), fixture);
    assert.ok(await waitFor(() => runCount(root) === 1), 'run archived');
  } finally {
    w.close();
  }
});
