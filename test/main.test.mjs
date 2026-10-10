import './_home.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { startServer } from '../server/main.mjs';

const freePort = () => new Promise((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

test('writes server.json, answers with the token, removes server.json on close', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  const s = await startServer({ projectRoot: root, port: 0 });
  try {
    const info = JSON.parse(readFileSync(join(root, '.e2e-dashboard/server.json'), 'utf8'));
    assert.equal(info.port, s.port);
    assert.equal(info.pid, process.pid);
    assert.equal(info.token, s.token);
    assert.match(s.url, new RegExp(`^http://127\\.0\\.0\\.1:${s.port}/\\?token=`));
    const res = await fetch(`http://127.0.0.1:${s.port}/api/info`, { headers: { 'x-e2e-dashboard-token': s.token } });
    assert.equal(res.status, 200);
  } finally {
    await s.close();
  }
  assert.equal(existsSync(join(root, '.e2e-dashboard/server.json')), false);
});

test('takes the next port when the preferred one is busy', async () => {
  const port = await freePort();
  const a = await startServer({ projectRoot: mkdtempSync(join(tmpdir(), 'e2ed-')), port });
  const b = await startServer({ projectRoot: mkdtempSync(join(tmpdir(), 'e2ed-')), port });
  try {
    assert.equal(a.port, port);
    assert.notEqual(b.port, port);
  } finally {
    await a.close();
    await b.close();
  }
});
