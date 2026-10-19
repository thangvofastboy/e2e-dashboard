import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { quickSetupPlan, runQuickSetup, pickPm, spawnStep, jsPm, quickSetupRunning, nodeOkForE2e } from '../server/quicksetup.mjs';
import { osInfo } from '../server/osinfo.mjs';

const project = (pkg, installed = []) => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-qs-'));
  if (pkg) writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
  for (const n of installed) {
    mkdirSync(join(root, 'node_modules', n), { recursive: true });
    writeFileSync(join(root, 'node_modules', n, 'package.json'), '{}');
  }
  return root;
};
const base = { autoUpdate: { enabled: true }, os: 'linux', which: (c) => c === 'apt-get', canSudo: false, nodeMajor: 22, browser: 'chromium', setupItems: [], tools: { git: 'git 2', gh: 'gh 2', claude: '1.0' }, browserEntries: ['chromium-1243', 'chromium_headless_shell-1243'] };
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
  assert.equal(item(manual, 'git').display, "sudo sh -c 'apt-get update && apt-get install -y git'");
  assert.ok(!manual.steps.includes('git'));
  assert.ok(manual.steps.includes('claude'));
  const auto = await quickSetupPlan(root, { ...noTools, canSudo: true });
  assert.deepEqual(item(auto, 'git').cmd, ['sudo', '-n', 'sh', '-c', 'apt-get update && apt-get install -y git']);
  const cli = await quickSetupPlan(root, { ...noTools, interactive: true });
  assert.deepEqual(item(cli, 'gh').cmd, ['sudo', 'sh', '-c', 'apt-get update && apt-get install -y gh']);
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

test('stepsHtml (trang 1 Click Setup / popup): bước tự cài đánh số, nút Cài tất cả, mục làm tay có copy, mục đã có thu gọn', async () => {
  const { stepsHtml } = await import('../ui/setup-steps.js');
  const plan = { canSudo: false, steps: ['browsers'], items: [
    { id: 'git', label: 'Git', ok: false, detail: 'Chưa cài', display: 'sudo apt-get install -y git', manual: true },
    { id: 'browsers', label: 'Trình duyệt', ok: false, detail: 'Thiếu headless shell', display: 'npx @e2e-dev/web install chromium' },
    { id: 'node', label: 'Node', ok: true, detail: 'v22' },
  ] };
  const html = stepsHtml(plan, { showOk: true });
  assert.match(html, /data-step="browsers"[\s\S]*Bước 1\/1/);
  assert.match(html, /data-run>[\s\S]*Cài tất cả \(1\)/);
  assert.match(html, /data-copy="sudo apt-get install -y git"/);
  assert.match(html, /Đã có \/ tuỳ chọn \(1\)[\s\S]*Node/);
  assert.doesNotMatch(stepsHtml(plan), /Đã có \/ tuỳ chọn/); // popup: không liệt kê mục đã có
  assert.doesNotMatch(stepsHtml({ steps: [], items: [{ id: 'x', ok: true }] }), /data-run/);
});

test('jsPm theo lockfile: pnpm / yarn / bun dùng đúng lệnh, Yarn PnP không đòi node_modules', async () => {
  const pnpm = project({ devDependencies: { zod: '3' } });
  writeFileSync(join(pnpm, 'pnpm-lock.yaml'), '');
  assert.equal(jsPm(pnpm, 'win32').bin, 'pnpm.cmd');
  const plan = await quickSetupPlan(pnpm, base);
  assert.deepEqual(item(plan, 'e2e').cmd, ['pnpm', 'add', '-D', 'e2e', '@e2e-dev/web']);
  const yarn = project({ devDependencies: { e2e: '1', '@e2e-dev/web': '1', zod: '3' } });
  writeFileSync(join(yarn, 'yarn.lock'), '');
  assert.deepEqual(item(await quickSetupPlan(yarn, base), 'deps').cmd, ['yarn', 'install']);
  writeFileSync(join(yarn, '.pnp.cjs'), '');
  const pnp = await quickSetupPlan(yarn, { ...base, browserEntries: [] });
  assert.equal(item(pnp, 'deps').ok, true);
  assert.equal(item(pnp, 'browsers').manual, true);
  assert.match(item(pnp, 'browsers').display, /^yarn e2e-web install/);
  assert.equal(jsPm(project(null)).name, 'npm');
});

test('runQuickSetup: đánh dấu đang chạy để chặn run test; lần gọi thứ hai cùng lúc bị từ chối', async () => {
  const root = project(null);
  const plan = { items: [{ id: 'deps', label: 'd', cmd: [process.execPath, '-e', 'setTimeout(() => {}, 300)'] }], steps: ['deps'] };
  const first = runQuickSetup(root, ['deps'], { plan });
  assert.equal(quickSetupRunning(root), true);
  await assert.rejects(runQuickSetup(root, ['deps'], { plan }), (e) => e.status === 409);
  await first;
  assert.equal(quickSetupRunning(root), false);
});

test('spawnStep huỷ thì giết cả nhóm tiến trình (cháu không sống sót)', { skip: process.platform === 'win32' }, async () => {
  const ac = new AbortController();
  const out = [];
  const p = spawnStep(tmpdir(), [process.execPath, '-e', "const c=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},20000)'],{stdio:'ignore'});console.log(c.pid);setTimeout(()=>{},20000)"], { signal: ac.signal, onLine: (l) => out.push(l) });
  while (!out.length) await new Promise((r) => setTimeout(r, 20));
  ac.abort();
  await p;
  await new Promise((r) => setTimeout(r, 100));
  // tiến trình cháu đã chết; zombie (đã chết, chờ PID 1 thu dọn — gặp trong container) cũng tính là chết
  const pid = Number(out[0]);
  let zombie = false;
  try { zombie = readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /, '').startsWith('Z'); } catch {}
  if (!zombie) assert.throws(() => process.kill(pid, 0));
});

test('runQuickSetup: bước project dùng hàm setup được truyền vào (CLI không import lại chính bin/dashboard.mjs)', async () => {
  const root = project(null);
  const plan = { items: [{ id: 'project', label: 'p', internal: true }], steps: ['project'] };
  const ev = [];
  const r = await runQuickSetup(root, ['project'], { plan, setup: async (dir) => [`setup ${dir === root}`], onEvent: (e) => ev.push(e) });
  assert.deepEqual(r.results, [{ id: 'project', ok: true, code: 0 }]);
  assert.ok(ev.some((e) => e.type === 'log' && e.text === 'setup true'));
});

test('setup --quick qua CLI chạy hết bước project, không treo ở top-level await', { skip: process.platform === 'win32' }, async () => {
  const { spawnSync } = await import('node:child_process');
  const root = project({ devDependencies: { e2e: '1', '@e2e-dev/web': '1' } }, ['e2e', '@e2e-dev/web']);
  writeFileSync(join(root, 'e2e.config.ts'), "export default {\n  tests: 'tests',\n};\n");
  // trình duyệt giả + claude/git sẵn trên PATH không quan trọng: chỉ cần bước project chạy xong
  const browsers = mkdtempSync(join(tmpdir(), 'e2ed-br-'));
  for (const d of ['chromium-1', 'chromium_headless_shell-1']) mkdirSync(join(browsers, d));
  const r = spawnSync(process.execPath, [join(import.meta.dirname, '..', 'bin', 'dashboard.mjs'), 'setup', '--quick', '--yes'], {
    cwd: root, encoding: 'utf8', timeout: 60000, env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers, PATH: '' },
  });
  const out = r.stdout + r.stderr;
  assert.doesNotMatch(out, /unsettled top-level await/);
  assert.match(out, /Đã thêm reporter vào e2e\.config\.ts/);
});

test('kế hoạch theo hệ điều hành: Fedora dùng dnf, Alpine dùng apk (gh là github-cli), --with-deps chỉ khi có apt-get', async () => {
  const root = project({ devDependencies: { e2e: '1', '@e2e-dev/web': '1' } }, ['e2e', '@e2e-dev/web']);
  const sys = (osRelease) => osInfo({ platform: 'linux', arch: 'x64', env: {}, osRelease, procVersion: '', exists: () => false });
  const noTools = { ...base, canSudo: true, tools: { git: 'git 2', gh: null, claude: '1' }, browserEntries: [] };
  const fedora = await quickSetupPlan(root, { ...noTools, osInfo: sys('ID=fedora\nPRETTY_NAME="Fedora Linux 40"'), which: (c) => ['dnf', 'apt-get'].includes(c) });
  assert.equal(fedora.os.family, 'rhel');
  assert.deepEqual(item(fedora, 'gh').cmd, ['sudo', '-n', 'dnf', 'install', '-y', 'gh']); // distro Fedora: dnf dù máy có apt-get
  assert.ok(!item(fedora, 'browsers').cmd.includes('--with-deps'));
  assert.match(item(fedora, 'os').detail, /Fedora Linux 40.*dnf/);
  const alpine = await quickSetupPlan(root, { ...noTools, osInfo: sys('ID=alpine'), which: (c) => c === 'apk' });
  assert.deepEqual(item(alpine, 'gh').cmd, ['sudo', '-n', 'apk', 'add', 'github-cli']);
  assert.match(item(alpine, 'node').display, /apk add nodejs/);
  const ubuntu = await quickSetupPlan(root, { ...noTools, osInfo: sys('ID=ubuntu'), which: (c) => c === 'apt-get' });
  assert.ok(item(ubuntu, 'browsers').cmd.includes('--with-deps'));
  assert.ok(!ubuntu.steps.includes('os')); // mục hệ điều hành chỉ để hiện
});

test('Node: ngưỡng của e2e (22.22.3 / 24.8), không phải chỉ ≥ 22', async () => {
  const root = project({ devDependencies: { e2e: '1', '@e2e-dev/web': '1' } }, ['e2e', '@e2e-dev/web']);
  for (const [v, ok] of [['22.22.0', false], ['22.22.3', true], ['24.7.0', false], ['24.8.0', true], ['25.0.0', true]]) {
    assert.equal(item(await quickSetupPlan(root, { ...base, nodeVersion: v }), 'node').ok, ok, v);
    assert.equal(nodeOkForE2e(v), ok, v);
  }
});

test('AI cho e2e: thiếu gói của provider → bước cài; thiếu API key / đăng nhập → làm tay kèm lệnh', async () => {
  const root = project({ devDependencies: { e2e: '1', '@e2e-dev/web': '1' } }, ['e2e', '@e2e-dev/web']);
  const ai = { provider: 'anthropic', label: 'Anthropic', kind: 'key', packages: ['ai', 'zod', '@ai-sdk/anthropic'], missing: ['@ai-sdk/anthropic'], install: ['npm', 'install', '-D', '@ai-sdk/anthropic'], installDisplay: 'npm install -D @ai-sdk/anthropic', env: 'ANTHROPIC_API_KEY', keyState: 'missing', keyUrl: 'https://console.anthropic.com/settings/keys' };
  const plan = await quickSetupPlan(root, { ...base, ai });
  assert.deepEqual(item(plan, 'ai').cmd, ['npm', 'install', '-D', '@ai-sdk/anthropic']);
  assert.ok(plan.steps.includes('ai'));
  assert.equal(item(plan, 'ai-key').manual, true);
  assert.match(item(plan, 'ai-key').display, /ANTHROPIC_API_KEY=… trong \.env/);
  const sub = await quickSetupPlan(root, { ...base, ai: { provider: 'copilot', label: 'GitHub Copilot (đăng nhập)', kind: 'login', packages: ['ai'], missing: [], loggedIn: false, loginDisplay: 'npx e2e login github-copilot' } });
  assert.equal(item(sub, 'ai').ok, true);
  assert.equal(item(sub, 'ai-login').ok, false);
  assert.equal(item(sub, 'ai-login').display, 'npx e2e login github-copilot');
  assert.equal((await quickSetupPlan(root, base)).items.find((x) => x.id === 'ai').ok, true); // không có config / không dùng AI: không bắt cài gì
});

test('setup không hứa việc nó không làm được: thiếu .env mà không có .env.example thì không thành bước tự cài', async () => {
  const { setupStatus, ensureEnvFile } = await import('../server/system.mjs');
  const { execFileSync } = await import('node:child_process');
  const root = project({});
  execFileSync('git', ['init', '-q'], { cwd: root });
  let items = await setupStatus(root, { reporter: { installed: true, version: '1', latest: '1' } });
  const env = items.find((x) => x.id === 'env');
  assert.equal(env.fix, null);
  assert.equal(env.optional, true);
  assert.equal(items.find((x) => x.id === 'ignore').ok, true); // chưa có .env: không có gì để lộ
  writeFileSync(join(root, '.env'), 'A=1\n');
  items = await setupStatus(root, { reporter: { installed: true, version: '1', latest: '1' } });
  assert.equal(items.find((x) => x.id === 'ignore').fix, 'setup');
  assert.deepEqual(await ensureEnvFile(root), ['Đã thêm .env vào .gitignore.']);
  items = await setupStatus(root, { reporter: { installed: true, version: '1', latest: '1' } });
  assert.equal(items.find((x) => x.id === 'ignore').ok, true);
});

test('project mobile: cài e2e + @e2e-dev/mobile, không có bước trình duyệt, kiểm adb / Xcode theo platform trong config', async () => {
  const { mobileTargets } = await import('../server/quicksetup.mjs');
  const root = project({ devDependencies: { lodash: '1' } });
  writeFileSync(join(root, 'e2e.config.ts'), "import { mobile } from '@e2e-dev/mobile';\nconst pixel = mobile({ platform: 'android' });\nconst iphone = mobile({ platform: 'ios' });\n");
  assert.deepEqual(mobileTargets(root, {}, 'linux'), { platforms: ['android', 'ios'], web: false });
  const plan = await quickSetupPlan(root, { ...base, mobileTools: { adb: false, xcrun: false } });
  assert.deepEqual(item(plan, 'e2e').cmd, ['npm', 'install', '-D', 'e2e', '@e2e-dev/mobile']);
  assert.equal(item(plan, 'browsers'), undefined);
  assert.equal(item(plan, 'android').ok, false);
  assert.equal(item(plan, 'android').manual, true);
  assert.match(item(plan, 'ios').detail, /chỉ chạy trên macOS/);
  const ok = await quickSetupPlan(root, { ...base, mobileTools: { adb: true, xcrun: false } });
  assert.equal(item(ok, 'android').display, 'npx agent-device doctor --platform android');
  assert.ok(!ok.steps.includes('android')); // bước chạy tay, không vào Cài tất cả
});

test('mobile không ghi platform: mặc định theo máy; config trộn web + mobile cần cả hai engine và trình duyệt', async () => {
  const { mobileTargets } = await import('../server/quicksetup.mjs');
  const root = project({ devDependencies: { e2e: '1', '@e2e-dev/mobile': '1' } }, ['e2e', '@e2e-dev/mobile']);
  assert.deepEqual(mobileTargets(root, { '@e2e-dev/mobile': '1' }, 'darwin').platforms, ['ios']);
  assert.deepEqual(mobileTargets(root, { '@e2e-dev/mobile': '1' }, 'linux').platforms, ['android']);
  writeFileSync(join(root, 'e2e.config.ts'), "import { web } from '@e2e-dev/web';\nimport { mobile } from '@e2e-dev/mobile';\n");
  const plan = await quickSetupPlan(root, { ...base, mobileTools: { adb: true, xcrun: false } });
  assert.deepEqual(item(plan, 'e2e').cmd, ['npm', 'install', '-D', '@e2e-dev/web']);
  assert.ok(item(plan, 'browsers'));
  assert.equal(mobileTargets(project({}), {}), null);
});

test('updateE2ePackages: chỉ gói đã khai báo, lên bản mới nhất bằng trình quản lý gói của project; khoá Quick Setup trong lúc cài', async () => {
  const { updateE2ePackages } = await import('../server/quicksetup.mjs');
  const root = project({ devDependencies: { e2e: '^0.17.0', '@e2e-dev/web': '^0.12.0', lodash: '1' } });
  const latest = async (n) => ({ e2e: '0.21.1', '@e2e-dev/web': '0.15.1', '@e2e-dev/mobile': '0.12.2' })[n];
  const installed = (n) => ({ e2e: '0.17.0', '@e2e-dev/web': '0.15.1' })[n];
  let during;
  const r = await updateE2ePackages(root, { latest, installed, os: 'linux', nodeVersion: '24.9.0', run: async (argv) => ((during = quickSetupRunning(root)), argv.length && 0) });
  const runs = [];
  await updateE2ePackages(root, { latest, installed: (n) => ({ e2e: '0.21.1', '@e2e-dev/web': '0.12.0' })[n], os: 'linux', nodeVersion: '24.9.0', run: async (argv) => (runs.push(argv), 0) });
  assert.deepEqual(runs.map((a) => a.slice(-2)), [['-D', '@e2e-dev/web@0.15.1'], ['install', 'chromium']]); // web mới → cài lại Chromium
  assert.equal(r.status, 'updated');
  assert.deepEqual(r.packages, [{ name: 'e2e', from: '0.17.0', to: '0.21.1' }]); // web đã mới nhất, mobile không khai báo
  assert.equal(r.command, 'npm install -D e2e@0.21.1');
  assert.equal(during, true);
  assert.equal(quickSetupRunning(root), false);
  assert.equal((await updateE2ePackages(root, { latest, installed: (n) => ({ e2e: '0.21.1', '@e2e-dev/web': '0.15.1' })[n], os: 'linux', nodeVersion: '24.9.0', run: () => assert.fail() })).status, 'up-to-date');
  assert.match((await updateE2ePackages(root, { latest, installed, nodeVersion: '22.12.0', run: () => assert.fail() })).reason, /Node v22\.12\.0/);
  assert.equal((await updateE2ePackages(project({ dependencies: { lodash: '1' } }), { latest, run: () => assert.fail() })).status, 'skipped');
  assert.equal((await updateE2ePackages(root, { latest, installed, os: 'linux', nodeVersion: '24.9.0', run: async () => 1 })).status, 'failed');
  // gói khai báo ở dependencies: cài không -D (giữ đúng mục)
  const prodRoot = project({ dependencies: { e2e: '^0.17.0' }, devDependencies: { '@e2e-dev/web': '^0.12.0' } });
  const cmds = [];
  const pr = await updateE2ePackages(prodRoot, { latest, installed: () => '0.1.0', os: 'linux', nodeVersion: '24.9.0', run: async (a) => (cmds.push(a.join(' ')), 0) });
  assert.deepEqual(cmds.slice(0, 2), ['npm install -D @e2e-dev/web@0.15.1', 'npm install e2e@0.21.1']);
  assert.equal(pr.status, 'updated');
});

test('updateE2ePackages: không hạ bản đang cài mới hơn latest, không đụng gói ghim đúng một bản', async () => {
  const { updateE2ePackages, newerVersion } = await import('../server/quicksetup.mjs');
  assert.equal(newerVersion('0.21.1', '0.17.0'), true);
  assert.equal(newerVersion('0.21.1', '0.22.0-beta.1'), false);
  assert.equal(newerVersion('0.21.1', '0.21.1-beta.1'), true);
  assert.equal(newerVersion('0.21.1', '0.21.1'), false);
  const root = project({ devDependencies: { e2e: '0.17.0', '@e2e-dev/web': '^0.12.0' } });
  const latest = async (n) => ({ e2e: '0.21.1', '@e2e-dev/web': '0.15.1' })[n];
  const r = await updateE2ePackages(root, { latest, installed: (n) => ({ e2e: '0.17.0', '@e2e-dev/web': '0.16.0-canary.3' })[n], os: 'linux', nodeVersion: '24.9.0', run: () => assert.fail() });
  assert.equal(r.status, 'up-to-date');
  // bản cục bộ / git / workspace: không thay bằng bản trên npm
  const local = project({ devDependencies: { e2e: 'file:../e2e', '@e2e-dev/web': 'workspace:*' } });
  assert.equal((await updateE2ePackages(local, { latest, installed: () => '0.1.0', os: 'linux', nodeVersion: '24.9.0', run: () => assert.fail() })).status, 'up-to-date');
  // đang có run: không cài đè node_modules
  const busyRun = project({ devDependencies: { e2e: '^0.17.0' } });
  assert.equal((await updateE2ePackages(busyRun, { latest, installed: () => '0.17.0', os: 'linux', nodeVersion: '24.9.0', idle: () => false, run: () => assert.fail() })).status, 'skipped');
});

test('describeE2eUpdate: one line per outcome', async () => {
  const { describeE2eUpdate } = await import('../server/quicksetup.mjs');
  assert.match(describeE2eUpdate({ status: 'updated', packages: [{ name: 'e2e', from: '0.21.1', to: '0.21.2' }] }), /^✓ Đã cập nhật e2e: e2e 0\.21\.1 → 0\.21\.2$/);
  assert.match(describeE2eUpdate({ status: 'failed', exitCode: 1, command: 'npm i -D e2e@1' }), /^✗ .*mã 1.*npm i -D e2e@1$/);
  assert.match(describeE2eUpdate({ status: 'up-to-date', packages: [{ name: 'e2e', from: '0.21.2' }] }), /^✓ e2e đã là bản mới nhất \(e2e 0\.21\.2\)$/);
  assert.match(describeE2eUpdate({ status: 'skipped', reason: 'Đang có run' }), /^ℹ .*Đang có run$/);
});

test('CLI update-e2e: no project → exit 3 (retry later); switched off in the user config → exit 0', async () => {
  const { main } = await import('../bin/dashboard.mjs');
  const home = mkdtempSync(join(tmpdir(), 'e2ed-home-'));
  const prev = process.env.E2E_DASHBOARD_HOME;
  process.env.E2E_DASHBOARD_HOME = home;
  try {
    const bare = mkdtempSync(join(tmpdir(), 'e2ed-bare-'));
    assert.equal((await main(['update-e2e'], bare)).code, 3);
    writeFileSync(join(home, 'config.json'), JSON.stringify({ e2e: { autoUpdate: false } }));
    const off = await main(['update-e2e'], bare);
    assert.equal(off.code, 0);
    assert.match(off.out, /đang tắt/);
  } finally {
    if (prev === undefined) delete process.env.E2E_DASHBOARD_HOME;
    else process.env.E2E_DASHBOARD_HOME = prev;
  }
});
