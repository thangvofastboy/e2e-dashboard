import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from '../hooks/register.ts';

// A fake engine: `$.command.run` rejects while a hook the turn waits on is running, as the real one does.
function engine({ modLoaded }) {
  const hooks = [];
  register((event, ...rest) => hooks.push({ event, hook: rest.at(-1) }));
  const timers = [];
  const calls = [];
  const toasts = [];
  let inHook = false;
  const $ = {
    clock: { after: (ms, fn) => timers.push(fn) },
    ui: { toast: (t) => toasts.push(t) },
    command: {
      run: async (input) => {
        calls.push({ input, inHook });
        if (inHook || !modLoaded) throw new Error(inHook ? 'run inside a waiting hook' : 'unknown command');
        return { text: 'Pane E2E đã mở.' };
      },
    },
    plugin: { root: '/nowhere' },
  };
  const commandRun = hooks.find((h) => h.event === 'command.run').hook;
  const run = async (args) => {
    inHook = true;
    try {
      return await commandRun($, { command: 'e2e-dashboard', args }, async () => assert.fail('pane must not fall through'));
    } finally {
      inHook = false;
    }
  };
  return { run, timers, calls, toasts };
}

test('/e2e-dashboard pane: returns at once and starts /e2e-pane from a timer, never inside the hook', async () => {
  const e = engine({ modLoaded: true });
  const out = await e.run('pane theme ocean');
  assert.match(out.text, /Đang mở pane/);
  assert.equal(e.calls.length, 0, 'nothing run inside the waiting hook');
  assert.equal(e.timers.length, 1);
  await e.timers[0]();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(e.calls, [{ input: { command: 'e2e-pane', args: 'theme ocean' }, inHook: false }]);
  assert.deepEqual(e.toasts, []);
});

test('/e2e-dashboard pane without the mod: a toast says how to install it', async () => {
  const e = engine({ modLoaded: false });
  await e.run('pane');
  await e.timers[0]();
  await new Promise((r) => setImmediate(r));
  assert.equal(e.toasts.length, 1);
  assert.match(e.toasts[0], /e2e-dashboard-tab/);
});
