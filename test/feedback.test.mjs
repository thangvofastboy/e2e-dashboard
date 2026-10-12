import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { Writable, PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { validateFeedback, buildIssue, createIssue, rateOk, FEEDBACK_REPO } from '../server/feedback.mjs';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';

const ok = { type: 'bug', title: 'Trang Tests không lọc tag', body: 'Chọn tag smoke rồi không thấy gì.', confirm: true };

test('validation: type, lengths, confirmation, and no secrets in a public issue', () => {
  assert.deepEqual(validateFeedback(ok), { type: 'bug', title: 'Trang Tests không lọc tag', body: 'Chọn tag smoke rồi không thấy gì.', includeEnv: true });
  assert.throws(() => validateFeedback({ ...ok, type: 'rant' }), /loại/);
  assert.throws(() => validateFeedback({ ...ok, title: 'abc' }), /tiêu đề/);
  assert.throws(() => validateFeedback({ ...ok, body: 'ngắn' }), /nội dung/);
  assert.throws(() => validateFeedback({ ...ok, confirm: false }), /xác nhận/);
  assert.throws(() => validateFeedback({ ...ok, body: 'dùng key ghp_abcdefghijklmnopqrstuv để chạy' }), /token|khoá/);
  assert.throws(() => validateFeedback({ ...ok, body: 'LINEAR lin_api_0123456789abcdef' }), /token|khoá/);
  assert.equal(validateFeedback({ ...ok, body: 'ab\u0007cd dài đủ 10 ký tự' }).body.includes('\u0007'), false);
});

test('the issue text: labelled by type, footer with the version only when asked', () => {
  const f = validateFeedback(ok);
  const env = { version: '0.9.0', node: 'v22', platform: 'linux' };
  const i = buildIssue(f, env);
  assert.equal(i.title, '[Lỗi] Trang Tests không lọc tag');
  assert.deepEqual(i.labels, ['feedback', 'bug']);
  assert.match(i.body, /Dashboard v0\.9\.0 · Node v22 · linux/);
  assert.doesNotMatch(buildIssue({ ...f, includeEnv: false }, env).body, /Dashboard v/);
  assert.equal(buildIssue({ ...f, type: 'idea' }, env).labels[1], 'enhancement');
});

function fakeGh(script) {
  const calls = [];
  const spawnImpl = (cmd, args) => {
    const p = new EventEmitter();
    p.stdout = new PassThrough();
    p.stderr = new PassThrough();
    let body = '';
    p.stdin = new Writable({ write(c, _e, cb) { body += c; cb(); }, final(cb) { p.body = body; cb(); } });
    calls.push({ cmd, args, get body() { return p.body ?? body; } });
    setImmediate(() => {
      const r = script(args, calls.length);
      if (r.stderr) p.stderr.end(r.stderr);
      else p.stdout.end(r.stdout ?? '');
      p.emit('close', r.code ?? 0);
    });
    return p;
  };
  return { calls, spawnImpl };
}

test('createIssue calls gh with argv only, the body on stdin, and returns the URL', async () => {
  const gh = fakeGh(() => ({ stdout: 'https://github.com/thangvofastboy/e2e-dashboard/issues/12\n' }));
  const r = await createIssue(buildIssue(validateFeedback(ok), {}), { spawnImpl: gh.spawnImpl });
  assert.equal(r.url, 'https://github.com/thangvofastboy/e2e-dashboard/issues/12');
  const [c] = gh.calls;
  assert.equal(c.cmd, 'gh');
  assert.deepEqual(c.args.slice(0, 4), ['issue', 'create', '--repo', FEEDBACK_REPO]);
  assert.ok(!c.args.some((a) => a.includes('Chọn tag smoke')), 'body must not be in argv');
  assert.match(c.body, /Chọn tag smoke/);
});

test('a missing label is retried once without labels; other failures surface', async () => {
  const gh = fakeGh((args, n) => (n === 1 ? { code: 1, stderr: 'could not add label: "bug" not found' } : { stdout: 'https://x/issues/3' }));
  assert.equal((await createIssue(buildIssue(validateFeedback(ok), {}), { spawnImpl: gh.spawnImpl })).url, 'https://x/issues/3');
  assert.equal(gh.calls[1].args.includes('--label'), false);
  const bad = fakeGh(() => ({ code: 1, stderr: 'HTTP 401: Bad credentials' }));
  await assert.rejects(createIssue(buildIssue(validateFeedback(ok), {}), { spawnImpl: bad.spawnImpl }), /401/);
  assert.equal(bad.calls.length, 1, 'no label retry for a non-label error');
});

test('a missing gh says what to install', async () => {
  const spawnImpl = () => { const p = new EventEmitter(); p.stdout = new PassThrough(); p.stderr = new PassThrough(); p.stdin = new PassThrough(); setImmediate(() => p.emit('error', Object.assign(new Error('x'), { code: 'ENOENT' }))); return p; };
  await assert.rejects(createIssue(buildIssue(validateFeedback(ok), {}), { spawnImpl }), /gh auth login/);
});

test('the rate limit counts attempts in a window', () => {
  const t = 1_000_000;
  for (let i = 0; i < 5; i++) assert.equal(rateOk(t + i), true);
  assert.equal(rateOk(t + 10), false);
  assert.equal(rateOk(t + 10 * 60_000 + 20), true, 'window passed');
});

test('POST /api/feedback refuses bad input before anything reaches gh', async () => {
  const server = http.createServer(createApp({ projectRoot: mkdtempSync(join(tmpdir(), 'e2ed-fb-')), token: 't', uiDir: fileURLToPath(new URL('../ui', import.meta.url)), live: createLive() }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (b) => fetch(`${base}/api/feedback`, { method: 'POST', headers: { 'x-e2e-dashboard-token': 't', origin: base, 'content-type': 'application/json' }, body: JSON.stringify(b) });
  try {
    assert.equal((await post({ ...ok, confirm: false })).status, 400);
    assert.match((await (await post({ ...ok, confirm: false })).json()).error, /xác nhận/);
    assert.equal((await post({ type: 'bug', title: 'x' })).status, 400);
  } finally {
    server.close();
  }
});
