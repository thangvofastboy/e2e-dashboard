// install.sh: cài môi trường một lệnh. Chỉ chạy --dry-run với node / git giả trên PATH, không cài gì thật.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dirname, '..', 'install.sh');
const skip = process.platform === 'win32';

// thư mục bin giả: node in ra phiên bản cho trước, git có sẵn, không có claude
function fakeBin(nodeVersion) {
  const bin = mkdtempSync(join(tmpdir(), 'e2ed-inst-bin-'));
  const sh = (name, body) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  if (nodeVersion) sh('node', `case "$1" in -v) echo v${nodeVersion} ;; *) echo ${nodeVersion} ;; esac`);
  sh('git', 'echo git version 2.0.0');
  return bin;
}
function dryRun(nodeVersion, { config = true, args = [] } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'e2ed-inst-proj-'));
  if (config) writeFileSync(join(cwd, 'e2e.config.ts'), 'export default {};\n');
  const home = mkdtempSync(join(tmpdir(), 'e2ed-inst-home-'));
  const r = spawnSync('bash', [SCRIPT, '--dry-run', ...args], { cwd, encoding: 'utf8', env: { HOME: home, PATH: `${fakeBin(nodeVersion)}:/usr/bin:/bin` } });
  return { ...r, cwd };
}

test('install.sh: cú pháp bash hợp lệ, --help thoát 0, tham số lạ thoát 2', { skip }, () => {
  assert.equal(spawnSync('bash', ['-n', SCRIPT]).status, 0);
  assert.equal(spawnSync('bash', [SCRIPT, '--help']).status, 0);
  assert.equal(spawnSync('bash', [SCRIPT, '--xyz']).status, 2);
});

test('install.sh --dry-run: in thứ tự 9 bước, hệ điều hành, Node cũ → nvm, cài claude + plugin, cấu hình config, Quick Setup', { skip }, () => {
  const r = dryRun('20.11.0', { args: ['--app-url', 'http://localhost:5173', '--app-command', 'npm run dev', '--ai', 'anthropic', '--api-key', 'sk-ant-bimat'] });
  assert.equal(r.status, 0, r.stderr);
  for (let i = 1; i <= 9; i++) assert.ok(r.stdout.includes(`[${i}/9]`), `bước ${i}`);
  assert.match(r.stdout, /Các bước sẽ chạy theo thứ tự/);
  assert.match(r.stdout, /\[1\/9\] Phát hiện hệ điều hành\n {2}✓ \S+/);
  assert.match(r.stdout, /Trình quản lý gói: /);
  assert.match(r.stdout, /nvm install 22/);
  assert.match(r.stdout, /npm install -g @anthropic-ai\/claude-code/);
  assert.match(r.stdout, /claude plugin marketplace add thangvofastboy\/e2e-dashboard/);
  assert.match(r.stdout, /claude plugin install e2e-dashboard@e2e-dashboard/);
  assert.match(r.stdout, /dashboard\.mjs autoupdate on/); // tự cập nhật plugin: bật mặc định
  assert.doesNotMatch(dryRun('22.22.3', { args: ['--no-auto-update'] }).stdout, /autoupdate on/);
  assert.match(r.stdout, /dashboard\.mjs config --yes --gateway anthropic --app-url http:\/\/localhost:5173 --app-command npm run dev/);
  assert.match(r.stdout, /dashboard\.mjs ai --yes --provider anthropic/);
  assert.ok(r.stdout.indexOf('ai --yes') < r.stdout.indexOf('setup --quick'), 'AI trước Quick Setup');
  assert.doesNotMatch(r.stdout, /sk-ant-bimat/); // key không bao giờ in ra / lên dòng lệnh
  assert.match(r.stdout, /dashboard\.mjs setup --quick --yes/);
  assert.match(r.stdout, /Tổng kết\n {2}1\. ✓ đã có/);
  assert.match(r.stdout, /3\. · sẽ chạy +Node\.js/);
});

test('install.sh: ngưỡng Node của e2e (≥ 22.22.3 hoặc ≥ 24.8)', { skip }, () => {
  for (const [v, ok] of [['22.22.3', true], ['22.23.0', true], ['22.22.2', false], ['23.5.0', false], ['24.8.0', true], ['24.7.9', false], ['26.0.0', true]]) {
    const r = dryRun(v);
    assert.equal(r.stdout.includes('nvm install'), !ok, `node ${v}`);
  }
});

test('install.sh: chưa có e2e.config thì báo làm tay; --init tạo bằng `config --init`; --skip-project bỏ qua project', { skip }, () => {
  const none = dryRun('22.22.3', { config: false });
  assert.match(none.stdout, /Không thấy e2e\.config/);
  assert.doesNotMatch(none.stdout, /setup --quick/);
  assert.match(none.stdout, /6\. ! làm tay +Cấu hình e2e\.config\.ts/);
  const init = dryRun('22.22.3', { config: false, args: ['--init', '--gateway', 'none'] }); // --gateway = tên cũ của --ai
  assert.match(init.stdout, /config --init --yes --gateway none/);
  assert.match(init.stdout, /setup --quick --yes/);
  const skipped = dryRun('22.22.3', { args: ['--skip-project'] });
  assert.match(skipped.stdout, /Bỏ qua \(--skip-project\)/);
  assert.doesNotMatch(skipped.stdout, /setup --quick/);
});

test('install.ps1 có cùng các bước và tham số', () => {
  const ps = readFileSync(join(import.meta.dirname, '..', 'install.ps1'), 'utf8');
  for (const s of ['[string]$Project', '[switch]$Init', '[string]$Ai', '[string]$ApiKey', '[switch]$AiLogin', '[string]$Gateway', '[string]$AppUrl', '[string]$AppCommand', '[switch]$Yes', '[switch]$NoOpen', '[switch]$NoAutoUpdate', '[switch]$SkipProject', '[switch]$DryRun',
    "'plugin', 'install', $PluginId", "'setup', '--quick', '--yes'", "'config', '--init'", "@($Dash, 'ai')", '$PSBoundParameters.Count -eq 0', "[version]'22.22.3'", 'Summary']) {
    assert.ok(ps.includes(s), s);
  }
  const sh = readFileSync(SCRIPT, 'utf8');
  const steps = (src, re) => [...re.exec(src)[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => (m[1] ?? m[2]).replace(/≥/g, '>='));
  assert.deepEqual(steps(ps, /\$Steps = @\(([^)]*\([^)]*\)[^)]*)\)/), steps(sh, /STEPS=\(([^)]*\([^)]*\)[^)]*)\)/)); // cùng 8 bước, cùng thứ tự
});

test('install.sh: --ai lạ thoát 2 trước khi cài gì', { skip }, () => {
  const r = dryRun('22.22.3', { args: ['--ai', 'xyz'] });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--ai phải là một trong: vercel anthropic/);
});
