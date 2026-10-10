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
  const runner = createRunner({ projectRoot: '/p', live, spawnImpl, onExit: (r) => finished.push(r) });
  assert.equal(runner.start({ tests: ['tests/a.e2e.ts:3'], rerunOf: 'r-old' }).ok, true);
  assert.equal(calls[0].cmd, 'npx');
  assert.deepEqual(calls[0].args, ['e2e', 'run', 'tests/a.e2e.ts:3']);
  assert.equal(calls[0].opts.cwd, '/p');
  assert.notEqual(calls[0].opts.shell, true);
  assert.equal(live.snapshot().status, 'running');
  assert.deepEqual(runner.start({}), { ok: false, error: 'busy' });
  calls[0].child.stdout.write('✓ shows the form\n');
  await new Promise((r) => setImmediate(r));
  assert.match(live.snapshot().output.at(-1).text, /shows the form/);
  calls[0].child.emit('close', 1);
  assert.equal(runner.state().running, false);
  assert.deepEqual(finished, [{ exitCode: 1, rerunOf: 'r-old' }]);
  assert.equal(live.snapshot().status, 'finished');
});

test('stop sends SIGINT, then SIGTERM after the grace period', async () => {
  const { calls, spawnImpl } = fakeSpawn();
  const runner = createRunner({ projectRoot: '/p', live: createLive(), spawnImpl, graceMs: 20 });
  runner.start({});
  assert.equal(runner.stop(), true);
  assert.deepEqual(calls[0].child.killed, ['SIGINT']);
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(calls[0].child.killed, ['SIGINT', 'SIGTERM']);
  calls[0].child.emit('close', 130);
  assert.equal(runner.stop(), false);
});
