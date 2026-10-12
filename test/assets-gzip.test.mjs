import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gunzipSync } from 'node:zlib';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';

const UI = fileURLToPath(new URL('../ui', import.meta.url));

function get(base, path, headers = {}) {
  return new Promise((ok, fail) => {
    http.get(base + path, { headers: { 'x-e2e-dashboard-token': 't', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', fail);
  });
}

test('app.js and style.css are served gzip when asked, identical once decoded, with their own ETag and 304', async () => {
  const server = http.createServer(createApp({ projectRoot: mkdtempSync(join(tmpdir(), 'e2ed-gz-')), token: 't', uiDir: UI, live: createLive() }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/app.js', '/style.css']) {
      const plain = await get(base, path);
      const gz = await get(base, path, { 'accept-encoding': 'gzip, deflate' });
      assert.equal(plain.headers['content-encoding'], undefined);
      assert.equal(gz.headers['content-encoding'], 'gzip');
      assert.equal(gz.headers.vary, 'accept-encoding');
      assert.ok(gz.body.length < plain.body.length / 2, `${path} is much smaller compressed`);
      assert.deepEqual(gunzipSync(gz.body), plain.body, 'same bytes after decoding');
      assert.notEqual(gz.headers.etag, plain.headers.etag, 'the compressed form has its own validator');
      assert.equal((await get(base, path, { 'accept-encoding': 'gzip', 'if-none-match': gz.headers.etag })).status, 304);
      assert.equal((await get(base, path, { 'if-none-match': plain.headers.etag })).status, 304);
      assert.equal((await get(base, path, { 'accept-encoding': 'gzip', 'if-none-match': plain.headers.etag })).status, 200, 'a plain validator does not match the gzip form');
    }
    assert.match((await get(base, '/app.js', { 'accept-encoding': 'gzip' })).headers['content-security-policy'], /default-src 'self'/, 'the CSP headers are kept');
  } finally {
    server.close();
  }
});
