#!/usr/bin/env node
// Creates a demo e2e project with 12 archived runs for manual UI checks: node test/seed-demo.mjs [dir]
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';

const dir = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'e2e-demo-'));
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'e2e.config.ts'), 'export default {\n  targets: [],\n};\n');
const base = JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));
const VIDEO = base.run.results[0].attempts[0].artifacts[0].path;
for (let i = 0; i < 12; i++) {
  const r = structuredClone(base);
  const start = Date.parse('2026-10-01T09:00:00Z') + i * 6 * 3600_000;
  r.run.id = `018f0f5c-7b2a-7abc-8abc-${String(i).padStart(12, '0')}`;
  r.run.startedAt = new Date(start).toISOString();
  r.run.finishedAt = new Date(start + 60_000 + i * 7_000).toISOString();
  const failing = i % 3 === 2;
  r.run.status = failing ? 'failed' : 'passed';
  r.run.results[0].status = failing ? 'failed' : i % 4 === 1 ? 'flaky' : 'passed';
  r.run.summary = { ...r.run.summary, passed: failing ? 0 : 1, failed: failing ? 1 : 0 };
  r.run.vcs = { commit: (i.toString(16).repeat(40)).slice(0, 40), branch: i < 8 ? 'main' : 'feat/checkout', dirty: i === 11 };
  for (const e of r.run.results[0].attempts[0].steps[0].events) if (e.kind === 'model') e.inputTokens = 100 + i * 40;
  const out = join(dir, '.e2e');
  mkdirSync(dirname(join(out, 'results', VIDEO)), { recursive: true });
  writeFileSync(join(out, 'results', VIDEO), 'not a real video');
  writeFileSync(join(out, 'report.json'), JSON.stringify(r));
  await archive(dir, { source: i % 2 ? 'reporter' : 'hook' });
}
console.log(dir);
