import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { quickSetupPlan, runQuickSetup, pickPm, spawnStep } from '../server/quicksetup.mjs';

const project = (pkg, installed = []) => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-qs-'));
  if (pkg) writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
  for (const n of installed) {
    mkdirSync(join(root, 'node_modules', n), { recursive: true });
    writeFileSync(join(root, 'node_modules', n, 'package.json'), '{}');
  }
  return root;
};
const base = { os: 'linux', which: (c) => c === 'apt-get', canSudo: false, nodeMajor: 22, browser: 'chromium', setupItems: [], tools: { git: 'git 2', gh: 'gh 2', claude: '1.0' }, browserEntries: ['chromium-1243', 'chromium_headless_shell-1243'] };
const item = (plan, id) => plan.items.find((x) => x.id === id);

test('máy đủ hết: không có bước nào', async () => {
  const root = project({ devDependencies: { e2e: '^0.17.0', '@e2e-dev/web': '^0.12.0' } }, ['e2e', '@e2e-dev/web']);
  const plan = await quickSetupPlan(root, base);
  assert.deepEqual(plan.steps, []);
  assert.ok(plan.items.every((x) => x.ok));
});

test('thiếu e2e trong package.json: npm install -D e2e @e2e-dev/web, gộp luôn bước deps', async () => {
  const root = project({ dependencies: { lodash: '1' } });
  const plan = await quickSetupPlan(root, base);
  assert.deepEqual(item(plan, 'e2e').cmd, ['npm', 'install', '-D', 'e2e', '@e2e-dev/web']);
  assert.ok(!plan.steps.includes('deps'));
});

test('có khai báo nhưng node_modules thiếu: npm install; windows dùng npm.cmd', async () => {
  const root = project({ devDependencies: { e2e: '1', '@e2e-dev/web': '1', zod: '3' } }, ['e2e', '@e2e-dev/web']);
  const plan = await quickSetupPlan(root, base);
  assert.deepEqual(item(plan, 'deps').cmd, ['npm', 'install']);
  assert.match(item(plan, 'deps').detail, /zod/);
  const win = await quickSetupPlan(root, { ...base, os: 'win32', which: (c) => c === 'winget' });
  assert.equal(item(win, 'deps').cmd[0], 'npm.cmd');
});

test('Chromium và headless shell kiểm tra riêng; cài bằng bin @e2e-dev/web của project', async () => {
  const root = project({ devDependencies: { e2e: '1', '@e2e-dev/web': '1' } }, ['e2e', '@e2e-dev/web']);
  const plan = await quickSetupPlan(root, { ...base, browserEntries: ['chromium-1243'] });
  const b = item(plan, 'browsers');
  assert.equal(b.ok, false);
  assert.match(b.detail, /headless shell/);
  assert.doesNotMatch(b.detail, /Chromium/);
  assert.equal(b.cmd[1], join(root, 'node_modules', '@e2e-dev', 'web', 'dist', 'bin.js'));
  assert.deepEqual(b.cmd.slice(2), ['install', 'chromium']); // không sudo được → không --with-deps
  const ff = await quickSetupPlan(root, { ...base, canSudo: true, browser: 'firefox' });
  assert.deepEqual(item(ff, 'browsers').cmd.slice(2), ['install', 'chromium', 'firefox', '--with-deps']);
});

test('gói hệ thống: sudo -n khi sudo không cần mật khẩu, không thì thành chạy tay; CLI dùng sudo thường', async () => {
  const root = project({ devDependencies: { e2e: '1', '@e2e-dev/web': '1' } }, ['e2e', '@e2e-dev/web']);
  const noTools = { ...base, tools: { git: null, gh: null, claude: null } };
  const manual = await quickSetupPlan(root, noTools);
  assert.equal(item(manual, 'git').manual, true);
  assert.equal(item(manual, 'git').display, 'sudo apt-get install -y git');
  assert.ok(!manual.steps.includes('git'));
  assert.ok(manual.steps.includes('claude'));
  const auto = await quickSetupPlan(root, { ...noTools, canSudo: true });
  assert.deepEqual(item(auto, 'git').cmd, ['sudo', '-n', 'apt-get', 'install', '-y', 'git']);
  const cli = await quickSetupPlan(root, { ...noTools, interactive: true });
  assert.deepEqual(item(cli, 'gh').cmd, ['sudo', 'apt-get', 'install', '-y', 'gh']);
  const mac = await quickSetupPlan(root, { ...noTools, os: 'darwin', which: (c) => c === 'brew' });
  assert.deepEqual(item(mac, 'gh').cmd, ['brew', 'install', 'gh']);
  assert.equal(pickPm('linux', () => false), null);
});

test('Node < 22 chỉ hiện cách cài, không tự chạy', async () => {
  const plan = await quickSetupPlan(project(null), { ...base, nodeMajor: 20 });
  assert.equal(item(plan, 'node').ok, false);
  assert.ok(!plan.steps.includes('node'));
});

test('runQuickSetup chỉ chạy id có trong kế hoạch, theo thứ tự kế hoạch, dừng khi npm install hỏng', async () => {
  const root = project(null);
  const plan = { items: [
    { id: 'e2e', label: 'e2e', cmd: [process.execPath, '-e', 'console.log("cai e2e"); process.exit(1)'] },
    { id: 'browsers', label: 'br', cmd: [process.execPath, '-e', 'console.log("br")'] },
  ], steps: ['e2e', 'browsers'] };
  const ev = [];
  const r = await runQuickSetup(root, ['browsers', 'e2e', 'rm -rf /'], { plan, onEvent: (e) => ev.push(e) });
  assert.deepEqual(r.results, [{ id: 'e2e', ok: false, code: 1 }]);
  assert.ok(ev.some((e) => e.type === 'log' && e.text === 'cai e2e'));
  assert.ok(!ev.some((e) => e.id === 'browsers'));
  assert.equal(ev.at(-1).type, 'done');
});

test('spawnStep: lệnh không tồn tại trả 127, abort giết tiến trình', async () => {
  assert.equal(await spawnStep(tmpdir(), ['khong-co-lenh-nay-xyz']), 127);
  const ac = new AbortController();
  const p = spawnStep(tmpdir(), [process.execPath, '-e', 'setTimeout(() => {}, 20000)'], { signal: ac.signal });
  setTimeout(() => ac.abort(), 100);
  assert.notEqual(await p, 0);
});

test('quickPlanHtml: mục tự cài có nút Cài tất cả, mục chạy tay có nút copy, không gửi lệnh lên server', async () => {
  const { quickPlanHtml } = await import('../ui/views/system.js');
  const plan = { canSudo: false, steps: ['browsers'], items: [
    { id: 'git', label: 'Git', ok: false, detail: 'Chưa cài', display: 'sudo apt-get install -y git', manual: true },
    { id: 'browsers', label: 'Trình duyệt', ok: false, detail: 'Thiếu headless shell', display: 'npx @e2e-dev/web install chromium' },
    { id: 'node', label: 'Node', ok: true, detail: 'v22' },
  ] };
  const html = quickPlanHtml(plan);
  assert.match(html, /data-quick-run="browsers"/);
  assert.match(html, /data-copy-cmd="sudo apt-get install -y git"/);
  assert.match(html, /setup --quick/);
  assert.doesNotMatch(html, /Node/);
  assert.match(quickPlanHtml({ steps: [], items: [{ id: 'x', ok: true }] }), /không cần cài/);
});
