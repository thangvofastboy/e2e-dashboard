// Quick Setup: kiểm tra máy + thư viện của project, thiếu gì thì chạy lệnh cài cái đó.
// Kế hoạch (danh sách lệnh) luôn dựng ở server; client chỉ gửi id bước, không bao giờ gửi lệnh.
// Bước cần sudo: chạy từ dashboard thì dùng `sudo -n` (không có TTY để hỏi mật khẩu) — sudo đòi mật khẩu thì
// bước đó thành "chạy tay" và hiện lệnh để copy. Chạy từ CLI (`setup --quick`) thì sudo hỏi mật khẩu bình thường.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { platform } from 'node:os';
import { join, resolve } from 'node:path';
import { browsersDir } from './browsers.mjs';
import { tools, resetTools, setupStatus } from './system.mjs';
import { readSettings } from './settings.mjs';

// lệnh thoát mã 0 trong 3 giây: async để không chặn event loop của dashboard (SSE Live, request khác) khi sudo / which treo
const exitsZero = (cmd, args) => new Promise((done) => {
  const c = spawn(cmd, args, { stdio: 'ignore' });
  const timer = setTimeout(() => c.kill('SIGKILL'), 3000);
  c.on('error', () => done(false));
  c.on('close', (code) => {
    clearTimeout(timer);
    done(code === 0);
  });
});
const PM_CANDIDATES = { darwin: ['brew'], win32: ['winget'] };

// trình quản lý gói JS theo lockfile: npm install trong project pnpm / yarn ghi package-lock.json và làm hỏng node_modules
export function jsPm(root, os = platform()) {
  const ext = os === 'win32' ? '.cmd' : '';
  const has = (f) => existsSync(join(root, f));
  if (has('pnpm-lock.yaml')) return { name: 'pnpm', bin: `pnpm${ext}`, add: ['add', '-D'], install: ['install'] };
  if (has('yarn.lock')) return { name: 'yarn', bin: `yarn${ext}`, add: ['add', '-D'], install: ['install'], pnp: has('.pnp.cjs') };
  if (has('bun.lockb') || has('bun.lock')) return { name: 'bun', bin: 'bun', add: ['add', '-d'], install: ['install'] };
  return { name: 'npm', bin: `npm${ext}`, add: ['install', '-D'], install: ['install'] };
}

// ponytail: chỉ apt-get/dnf/pacman (Linux), brew (macOS), winget (Windows); distro khác thì hiện lệnh để cài tay
const PMS = {
  'apt-get': { sudo: true, install: (p) => ['sh', '-c', `apt-get update && apt-get install -y ${p}`] }, // p là hằng trong PKG
  dnf: { sudo: true, install: (p) => ['dnf', 'install', '-y', p] },
  pacman: { sudo: true, install: (p) => ['pacman', '-S', '--noconfirm', p] },
  brew: { sudo: false, install: (p) => ['brew', 'install', p] },
  winget: { sudo: false, install: (p) => ['winget', 'install', '-e', '--accept-source-agreements', '--accept-package-agreements', '--id', p] },
};
const PKG = { git: { pacman: 'git', winget: 'Git.Git' }, gh: { pacman: 'github-cli', winget: 'GitHub.cli' } };
export function pickPm(os, which) {
  const order = os === 'darwin' ? ['brew'] : os === 'win32' ? ['winget'] : ['apt-get', 'dnf', 'pacman'];
  return order.find((pm) => which(pm)) ?? null;
}

const readPkg = (root) => {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
};
const show = (argv) => argv.map((a) => (/^[\w@./:=+-]+$/.test(a) ? a : `'${a}'`)).join(' ');

// deps tiêm vào được để test: os, which(cmd), canSudo, tools, browserEntries, nodeMajor, setupItems, browser
// reporter: giá trị hoặc hàm (hàm thì đo lại mỗi lần lập kế hoạch — sau khi cài, reporter đã khác)
export async function quickSetupPlan(root, opts = {}) {
  const os = opts.os ?? platform();
  const interactive = Boolean(opts.interactive);
  // which / sudo -n chạy song song, không chặn server
  const cands = PM_CANDIDATES[os] ?? ['apt-get', 'dnf', 'pacman'];
  const [found, sudoOk] = await Promise.all([
    opts.which ? null : Promise.all(cands.map((c) => exitsZero(os === 'win32' ? 'where' : 'which', [c]))),
    opts.canSudo ?? (os === 'win32' ? false : exitsZero('sudo', ['-n', 'true'])),
  ]);
  const which = opts.which ?? ((c) => found[cands.indexOf(c)] === true);
  const canSudo = sudoOk;
  const t = opts.tools ?? tools();
  const nodeMajor = opts.nodeMajor ?? Number(process.versions.node.split('.')[0]);
  const npm = os === 'win32' ? 'npm.cmd' : 'npm'; // cài Claude CLI toàn cục
  const js = jsPm(root, os);
  const pm = pickPm(os, which);
  const items = [];
  const add = (it) => items.push({ optional: false, manual: false, ...it });
  // lệnh cần sudo: CLI dùng sudo thường; dashboard dùng sudo -n, không sudo được thì thành chạy tay
  const elevated = (argv) => ({ cmd: interactive ? ['sudo', ...argv] : ['sudo', '-n', ...argv], manual: !interactive && !canSudo, display: show(['sudo', ...argv]) });

  // 1. công cụ hệ thống
  for (const [id, label, optional] of [['git', 'Git', false], ['gh', 'GitHub CLI (cho đồng bộ CI)', true]]) {
    if (t[id]) {
      add({ id, label, ok: true, detail: t[id], optional });
      continue;
    }
    if (!pm) {
      add({ id, label, ok: false, optional, manual: true, detail: 'Không thấy trình quản lý gói (apt-get/dnf/pacman/brew/winget): cài tay', display: `cài ${id} theo hướng dẫn của hệ điều hành` });
      continue;
    }
    const argv = PMS[pm].install(PKG[id][pm] ?? id);
    add({ id, label, ok: false, optional, detail: `Chưa cài: cài bằng ${pm}`, ...(PMS[pm].sudo ? elevated(argv) : { cmd: argv, display: show(argv) }) });
  }
  // Node chạy chính dashboard này: không tự nâng cấp (đổi Node dưới chân server đang chạy), chỉ chỉ cách
  add({ id: 'node', label: 'Node.js ≥ 22', ok: nodeMajor >= 22, detail: `v${nodeMajor}`, manual: true, display: os === 'win32' ? 'winget install -e --id OpenJS.NodeJS.LTS' : 'cài Node 22+ qua nvm / fnm / brew (nodejs của apt thường cũ hơn)' });

  // 2. e2e (github.com/tester-army/e2e: gói npm `e2e` + engine `@e2e-dev/web`) và thư viện của project
  const pkg = readPkg(root);
  const declared = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const needE2e = ['e2e', '@e2e-dev/web'].filter((n) => !declared[n]);
  // Yarn PnP không có node_modules: không kiểm tra được từng gói
  const missingDeps = js.pnp ? [] : Object.keys(declared).filter((n) => !existsSync(join(root, 'node_modules', n, 'package.json')));
  const e2eLabel = 'e2e (tester-army/e2e) + @e2e-dev/web';
  if (needE2e.length) {
    const argv = [js.bin, ...js.add, ...needE2e]; // add -D cũng cài luôn mọi thư viện còn thiếu
    add({ id: 'e2e', label: e2eLabel, ok: false, detail: `package.json chưa có ${needE2e.join(', ')}`, cmd: argv, display: show(argv) });
  } else add({ id: 'e2e', label: e2eLabel, ok: true, detail: `e2e ${declared.e2e}, @e2e-dev/web ${declared['@e2e-dev/web']}` });
  const depsLabel = 'Thư viện của project (node_modules)';
  if (!needE2e.length && missingDeps.length) {
    add({ id: 'deps', label: depsLabel, ok: false, detail: `Thiếu ${missingDeps.length}: ${missingDeps.slice(0, 6).join(', ')}${missingDeps.length > 6 ? '…' : ''}`, cmd: [js.bin, ...js.install], display: show([js.name, ...js.install]) });
  } else add({ id: 'deps', label: depsLabel, ok: !missingDeps.length, detail: missingDeps.length ? 'Cài cùng bước e2e' : js.pnp ? 'Yarn PnP: không kiểm tra node_modules' : `Đủ ${Object.keys(declared).length} gói` });

  // 3. trình duyệt: chromium và chromium-headless-shell kiểm tra riêng (installedBrowsers gộp hai cái làm một)
  // ponytail: chỉ xem thư mục chromium-<rev>, không so revision với bản Playwright mà engine ghim
  let entries = opts.browserEntries;
  if (!entries) {
    const dir = browsersDir(process.env, os);
    try {
      entries = dir ? readdirSync(dir) : [];
    } catch {
      entries = [];
    }
  }
  const has = (re) => entries.some((n) => re.test(n));
  const browser = opts.browser ?? (await readSettings(root)).browser;
  const want = [...new Set(['chromium', browser ?? 'chromium'])];
  const missingBr = [];
  if (!has(/^chromium-\d+$/)) missingBr.push('Chromium');
  if (!has(/^chromium_headless_shell-\d+$/)) missingBr.push('headless shell');
  for (const b of want.slice(1)) if (!has(new RegExp(`^${b}-\\d+$`))) missingBr.push(b);
  // engine ghim bản Playwright của nó: gọi bin của @e2e-dev/web trong project (cài Chromium kèm headless shell)
  const bin = join(root, 'node_modules', '@e2e-dev', 'web', 'dist', 'bin.js');
  const withDeps = os === 'linux' && (interactive || canSudo); // --with-deps gọi sudo apt-get bên trong
  const flags = withDeps ? ['--with-deps'] : [];
  add({
    id: 'browsers', label: `Trình duyệt: Chromium + headless shell${want.length > 1 ? ` + ${want.slice(1).join(', ')}` : ''}`, ok: !missingBr.length,
    detail: missingBr.length ? `Thiếu ${missingBr.join(', ')}` : 'Đã cài', cmd: [process.execPath, bin, 'install', ...want, ...flags],
    // Yarn PnP: không có node_modules/@e2e-dev/web để gọi trực tiếp, chạy tay qua yarn
    ...(js.pnp ? { manual: true, display: show(['yarn', 'e2e-web', 'install', ...want, ...flags]) } : { display: show(['npx', '@e2e-dev/web', 'install', ...want, ...flags]) }),
  });

  // 4. Claude Code CLI cho tính năng AI
  const claudeArgv = [npm, 'install', '-g', '@anthropic-ai/claude-code'];
  add({ id: 'claude', label: 'Claude Code CLI (cho tính năng AI)', ok: Boolean(t.claude), detail: t.claude ?? 'Không thấy lệnh claude trên PATH', cmd: claudeArgv, display: show(claudeArgv) });

  // 5. reporter, .env, .gitignore: setup() sẵn có
  const setupItems = opts.setupItems ?? (await setupStatus(root, { reporter: typeof opts.reporter === 'function' ? opts.reporter() : opts.reporter }));
  const todo = setupItems.filter((x) => !x.ok && x.fix === 'setup');
  add({ id: 'project', label: 'Reporter, .env, .gitignore', ok: !todo.length, detail: todo.length ? todo.map((x) => x.label).join(', ') : 'Đã xong', internal: true, display: '/e2e-dashboard setup' });

  return { items, steps: items.filter((x) => !x.ok && !x.manual && (x.cmd || x.internal)).map((x) => x.id), canSudo, interactive };
}

// project đang chạy Quick Setup: mọi đường khởi chạy test (nút Chạy, lịch, MCP) từ chối, vì npm install đang ghi node_modules
const busy = new Set();
export const quickSetupRunning = (root) => busy.has(resolve(root));

// chạy các bước đã chọn theo thứ tự kế hoạch. onEvent: {type:'step'|'log'|'step-done'|'done'}
// plan: kế hoạch dựng sẵn (test); không truyền thì dựng lại từ trạng thái máy lúc bấm
export async function runQuickSetup(root, ids, opts = {}) {
  const key = resolve(root);
  // đánh dấu trước await đầu tiên: kiểm tra quickSetupRunning rồi gọi hàm này (không await xen giữa) là nguyên tử
  if (busy.has(key)) throw Object.assign(new Error('Quick Setup đang chạy'), { status: 409 });
  busy.add(key);
  try {
    return await runSteps(root, ids, opts);
  } finally {
    busy.delete(key);
  }
}

async function runSteps(root, ids, { onEvent = () => {}, signal, inherit = false, plan: given, ...planOpts } = {}) {
  const plan = given ?? (await quickSetupPlan(root, planOpts));
  const want = new Set(ids);
  const steps = plan.items.filter((x) => want.has(x.id) && plan.steps.includes(x.id));
  const results = [];
  for (const s of steps) {
    if (signal?.aborted) break;
    onEvent({ type: 'step', id: s.id, label: s.label, display: s.display });
    let code = 0;
    if (s.internal) {
      try {
        const { setup } = await import('../bin/dashboard.mjs'); // lazy: bin kéo theo nhiều module server
        for (const line of await setup(root)) onEvent({ type: 'log', id: s.id, text: line });
      } catch (e) {
        onEvent({ type: 'log', id: s.id, text: e.message });
        code = 1;
      }
    } else code = await spawnStep(root, s.cmd, { onLine: (text) => onEvent({ type: 'log', id: s.id, text }), signal, inherit });
    if (code !== 0 && s.id === 'claude' && process.platform !== 'win32') onEvent({ type: 'log', id: s.id, text: 'Lỗi quyền (EACCES)? Chạy tay: sudo npm install -g @anthropic-ai/claude-code' });
    results.push({ id: s.id, ok: code === 0, code });
    onEvent({ type: 'step-done', id: s.id, ok: code === 0, code });
    // npm install hỏng thì bước trình duyệt (cần node_modules/@e2e-dev/web) chắc chắn hỏng theo
    if (code !== 0 && (s.id === 'e2e' || s.id === 'deps')) {
      onEvent({ type: 'log', id: s.id, text: 'Dừng: các bước sau cần thư viện của project.' });
      break;
    }
  }
  resetTools(); // vừa cài git/gh/claude: lần đo sau (trang Cài đặt tải lại) không dùng cache cũ
  onEvent({ type: 'done', results });
  return { results };
}

export function spawnStep(root, argv, { onLine = () => {}, signal, inherit = false } = {}) {
  return new Promise((resolve) => {
    const [cmd, ...args] = argv;
    // .cmd trên Windows phải đi qua shell; mọi tham số là hằng của server nên không có chỗ chèn lệnh
    // POSIX: nhóm tiến trình riêng (detached) để huỷ giết cả cây (npm → node → postinstall…); CLI (inherit) giữ chung
    // nhóm với terminal để Ctrl-C vẫn tới. Windows: .cmd chạy qua cmd.exe, giết cây bằng taskkill /T
    const win = process.platform === 'win32';
    const group = !inherit && !win;
    const child = spawn(cmd, args, { cwd: root, shell: cmd.endsWith('.cmd'), detached: group, stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', npm_config_fund: 'false', npm_config_audit: 'false' } });
    const kill = () => {
      try {
        if (win && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        else if (group && child.pid) process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch {
        child.kill('SIGTERM'); // nhóm đã thoát
      }
    };
    signal?.addEventListener('abort', kill, { once: true });
    let buf = '';
    const feed = (d) => {
      buf += d.toString();
      const parts = buf.split(/\r?\n|\r/);
      buf = parts.pop();
      for (const p of parts) if (p.trim()) onLine(p.slice(0, 500));
    };
    child.stdout?.on('data', feed);
    child.stderr?.on('data', feed);
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      if (buf.trim()) onLine(buf.slice(0, 500));
      signal?.removeEventListener('abort', kill);
      resolve(code);
    };
    child.on('error', (e) => {
      onLine(e.message);
      finish(127);
    });
    child.on('close', (code, sig) => finish(code ?? (sig ? 1 : 0)));
  });
}
