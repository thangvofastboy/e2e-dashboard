import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { buildRunArgs, createRunner } from '../server/runner.mjs';
import { createLive } from '../server/live.mjs';

test('buildRunArgs maps the run request to e2e CLI flags', () => {
  assert.deepEqual(
    buildRunArgs({ tests: ['tests/a.e2e.ts:12', 'tests/b.e2e.ts:40'], targets: ['web', 'webkit'], agents: ['default'], retries: 2, repeatEach: 3, noCache: true }),
    ['e2e', 'run', 'tests/a.e2e.ts:12', 'tests/b.e2e.ts:40', '--target', 'web,webkit', '--agent', 'default', '--retries', '2', '--repeat-each', '3', '--no-cache'],
  );
  assert.deepEqual(buildRunArgs({}), ['e2e', 'run']);
});

test('buildRunArgs rejects anything that could become a flag or a shell trick', () => {
  for (const bad of [{ tests: ['--config=/etc/x'] }, { tests: ['a.ts; rm -rf ~'] }, { targets: ['web --x'] }, { retries: -1 }, { retries: 99 }, { repeatEach: 0 }, { tests: 'a.ts' }, { tests: ['../../outside.e2e.ts:1'] }])
    assert.throws(() => buildRunArgs(bad), /invalid/, JSON.stringify(bad));
});

function fakeSpawn() {
  const calls = [];
  const spawnImpl = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 4242;
    child.killed = [];
    child.kill = (sig) => child.killed.push(sig);
    calls.push({ cmd, args, opts, child });
    return child;
  };
  return { calls, spawnImpl };
}

test('runner spawns without a shell, streams output into live, refuses a second run, reports exit', async () => {
  const live = createLive({ throttleMs: 1 });
  const { calls, spawnImpl } = fakeSpawn();
  const finished = [];
  const runner = createRunner({ projectRoot: '/p', live, spawnImpl, onExit: (r) => finished.push(r), resolveBin: () => '/p/node_modules/e2e/cli.js' });
  assert.equal(runner.start({ tests: ['tests/a.e2e.ts:3'], rerunOf: 'r-old' }).ok, true);
  assert.equal(calls[0].cmd, process.execPath);
  assert.deepEqual(calls[0].args, ['/p/node_modules/e2e/cli.js', 'run', 'tests/a.e2e.ts:3']);
  assert.equal(calls[0].opts.cwd, '/p');
  assert.notEqual(calls[0].opts.shell, true);
  assert.equal(live.snapshot().status, 'running');
  assert.deepEqual(runner.start({}), { ok: false, error: 'busy' });
  calls[0].child.stdout.write('✓ shows the form\n');
  await new Promise((r) => setImmediate(r));
  assert.match(live.snapshot().output.at(-1).text, /shows the form/);
  calls[0].child.emit('close', 1);
  assert.equal(runner.state().running, false);
  assert.deepEqual(finished, [{ exitCode: 1, rerunOf: 'r-old', before: null, browser: null }]);
  assert.equal(live.snapshot().status, 'finished');
});

test('stop sends SIGINT, then SIGTERM after the grace period', async () => {
  const { calls, spawnImpl } = fakeSpawn();
  const sent = [];
  const runner = createRunner({ projectRoot: '/p', live: createLive(), spawnImpl, graceMs: 20, resolveBin: () => '/p/cli.js', killImpl: (_t, sig) => sent.push(sig) });
  runner.start({});
  assert.equal(runner.stop(), true);
  assert.deepEqual(sent, ['SIGINT']);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(sent, ['SIGINT', 'SIGTERM']);
  calls[0].child.emit('close', 130);
  assert.equal(runner.stop(), false);
});

test('buildRunArgs passes --workers 1..1024 and rejects anything else', () => {
  assert.deepEqual(buildRunArgs({ workers: 4 }), ['e2e', 'run', '--workers', '4']);
  for (const bad of [0, 1025, 2.5, '4', -1]) assert.throws(() => buildRunArgs({ workers: bad }), /invalid workers/, String(bad));
});

test('buildRunArgs maps the selection, cache, trace and snapshot flags', () => {
  assert.deepEqual(
    buildRunArgs({ tag: ['@smoke', 'api'], tagMode: 'all', excludeTag: ['slow'], grep: 'login', shard: '2/4', maxFailures: 3, strictCache: true, trace: 'retain-on-failure', video: 'on', lastFailed: true, updateSnapshots: true, aiTrace: true }),
    ['e2e', 'run', '--tag', '@smoke,api', '--tag-mode', 'all', '--exclude-tag', 'slow', '--grep', 'login', '--shard', '2/4', '--max-failures', '3', '--strict-cache', '--trace=retain-on-failure', '--video=on', '--last-failed', '--update-snapshots', '--ai-trace'],
  );
});

test('buildRunArgs rejects bad selection and mode values', () => {
  for (const bad of [{ tag: ['--x'] }, { tagMode: 'some' }, { grep: '--config' }, { shard: '5/4' }, { shard: '0/4' }, { maxFailures: 0 }, { trace: 'always' }, { video: '--x' }, { strictCache: 'yes' }, { aiTrace: 1 }])
    assert.throws(() => buildRunArgs(bad), /invalid/, JSON.stringify(bad));
});
