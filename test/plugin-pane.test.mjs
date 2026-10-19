import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register, startPlugin } from '../hooks/register.ts';

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

test('/e2e-dashboard pane when /e2e-pane is not registered yet: a toast says to reload plugins (no separate mod to install)', async () => {
  const e = engine({ modLoaded: false });
  await e.run('pane');
  await e.timers[0]();
  await new Promise((r) => setImmediate(r));
  assert.equal(e.toasts.length, 1);
  assert.match(e.toasts[0], /reload-plugins/);
  assert.doesNotMatch(e.toasts[0], /cài mod/);
});

// Khởi động plugin với engine giả: `claude plugin list --json` trả về danh sách plugin đã cài
function session({ installed = [], store = new Map() } = {}) {
  const timers = [];
  const toasts = [];
  const $ = {
    clock: { after: (ms, fn) => timers.push(fn) },
    ui: { toast: (t) => toasts.push(t) },
    command: { register: async () => {}, run: async () => ({ text: '' }) },
    process: { run: async (argv) => (argv[1] === 'plugin' && argv[2] === 'list' ? { exitCode: 0, stdout: JSON.stringify(installed.map((id) => ({ id, version: '0.1.1' }))), stderr: '' } : { exitCode: 0, stdout: '', stderr: '' }) },
    fs: { read: async () => JSON.stringify({ version: '9.9.9' }) },
    session: { cwd: async () => '/p' },
    store: { get: async (k) => store.get(k), set: async (k, v) => store.set(k, v) },
    plugin: { root: '/nowhere' },
  };
  const open = async () => {
    await startPlugin($);
    for (const t of timers.splice(0)) await t();
    await new Promise((r) => setImmediate(r));
  };
  return { open, toasts, store };
}

test('startPlugin: mod e2e-dashboard-tab cũ còn cài thì báo gỡ đúng một lần cho mỗi phiên bản plugin', async () => {
  const s = session({ installed: ['e2e-dashboard@e2e-dashboard', 'e2e-dashboard-tab@e2e-dashboard'] });
  await s.open();
  const notices = s.toasts.filter((t) => /e2e-dashboard-tab/.test(t));
  assert.equal(notices.length, 1);
  assert.match(notices[0], /\/plugin uninstall e2e-dashboard-tab@e2e-dashboard/);
  await s.open();
  assert.equal(s.toasts.filter((t) => /e2e-dashboard-tab/.test(t)).length, 1, 'không báo lại trong cùng phiên bản');
});

test('startPlugin: không còn mod cũ thì không báo gì về mod', async () => {
  const s = session({ installed: ['e2e-dashboard@e2e-dashboard'] });
  await s.open();
  assert.deepEqual(s.toasts.filter((t) => /e2e-dashboard-tab/.test(t)), []);
});

test('startPlugin: `claude plugin list` lỗi thì im lặng, không làm vỡ phiên', async () => {
  const toasts = [];
  const timers = [];
  const $ = {
    clock: { after: (ms, fn) => timers.push(fn) }, ui: { toast: (t) => toasts.push(t) },
    command: { register: async () => {}, run: async () => ({ text: '' }) },
    process: { run: async () => { throw new Error('claude không có trong PATH'); } },
    fs: { read: async () => JSON.stringify({ version: '9.9.9' }) }, session: { cwd: async () => '/p' },
    store: { get: async () => undefined, set: async () => {} }, plugin: { root: '/nowhere' },
  };
  await startPlugin($);
  for (const t of timers.splice(0)) await t();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(toasts, []);
});

test('plugin register: không tự đăng ký session.start (index.ts giữ handler duy nhất), vẫn đăng ký command.run', () => {
  const events = [];
  register((event) => events.push(event));
  assert.ok(!events.includes('session.start'));
  assert.ok(events.includes('command.run'));
});
