import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { embedJson, buildExportHtml, exportRun } from '../server/export.mjs';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';
import { main } from '../bin/dashboard.mjs';

const VIDEO = 'web/tests_example.e2e.ts__opens_app/attempt-0/video/video.webm';
const PNG = 'web/shot.png';

function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

async function project() {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  writeFileSync(join(root, 'e2e.config.ts'), 'export default {}\n');
  const r = JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));
  r.run.results[0].status = 'failed';
  r.run.results[0].attempts[0].error.message = '</script><script>alert(1)</script>';
  r.run.results[0].attempts[0].artifacts.push({ id: 'p', kind: 'screenshot', mediaType: 'image/png', path: PNG, redaction: 'complete', producer: { kind: 'attempt' } });
  put(root, '.e2e/report.json', JSON.stringify(r));
  put(root, `.e2e/results/${VIDEO}`, 'webm');
  put(root, `.e2e/results/${PNG}`, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await archive(root, { source: 'hook' });
  return { root, runId: r.run.id };
}

test('embedJson cannot break out of a script tag', () => {
  const s = embedJson({ m: '</script><!-- & \u2028' });
  assert.doesNotMatch(s, /<\/script|<!--|&|\u2028/);
  assert.deepEqual(JSON.parse(s), { m: '</script><!-- & \u2028' });
});

test('export embeds report, screenshots and UI; skips video; escapes app text', async () => {
  const { root, runId } = await project();
  const { html } = await buildExportHtml(root);
  assert.match(html, /^<!doctype html>/i);
  assert.ok(html.includes(runId));
  assert.ok(html.includes('data:image/png;base64,iVBORw=='));
  assert.ok(!html.includes(`artifacts/${VIDEO}`), 'video not embedded as a file entry');
  assert.ok(html.includes(`artifacts/${PNG}`), 'screenshot embedded as a file entry');
  assert.doesNotMatch(html, /<\/script><script>alert\(1\)/);
  assert.doesNotMatch(html, /href="\/style\.css"|src="\/app\.js"/);
  assert.equal(await buildExportHtml(root, '018f0f5c-0000-0000-0000-000000000000'), null);
});

test('exportRun writes the file; CLI prints the path', async () => {
  const { root, runId } = await project();
  const p = await exportRun(root, runId);
  assert.ok(p.endsWith(`.e2e-dashboard/exports/run-${runId}.html`) && existsSync(p));
  const r = await main(['export'], root);
  assert.equal(r.code, 0);
  assert.match(r.out, /^Đã xuất: .*run-.*\.html$/);
});

test('server serves the export as a download', async () => {
  const { root, runId } = await project();
  const server = http.createServer(createApp({ projectRoot: root, token: 't', uiDir: fileURLToPath(new URL('../ui', import.meta.url)), live: createLive() }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/runs/${runId}/export`, { headers: { 'x-e2e-dashboard-token': 't' } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="e2e-run-/);
  } finally {
    server.close();
  }
});
