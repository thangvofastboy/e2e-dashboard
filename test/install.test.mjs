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

test('install.sh --dry-run: Node cũ → nvm, chưa có claude → npm -g, cài plugin, Quick Setup trong project', { skip }, () => {
  const r = dryRun('20.11.0');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /nvm install 22/);
  assert.match(r.stdout, /npm install -g @anthropic-ai\/claude-code/);
  assert.match(r.stdout, /claude plugin marketplace add thangvofastboy\/e2e-dashboard/);
  assert.match(r.stdout, /claude plugin install e2e-dashboard@e2e-dashboard/);
  assert.match(r.stdout, /dashboard\.mjs setup --quick --yes/);
  assert.ok(r.stdout.includes(`Project ${r.cwd}`));
});

test('install.sh: ngưỡng Node của e2e (≥ 22.22.3 hoặc ≥ 24.8)', { skip }, () => {
  for (const [v, ok] of [['22.22.3', true], ['22.23.0', true], ['22.22.2', false], ['23.5.0', false], ['24.8.0', true], ['24.7.9', false], ['26.0.0', true]]) {
    const r = dryRun(v);
    assert.equal(r.stdout.includes('nvm install'), !ok, `node ${v}`);
  }
});

test('install.sh: không có e2e.config thì không chạy Quick Setup; --skip-project bỏ qua project', { skip }, () => {
  const none = dryRun('22.22.3', { config: false });
  assert.match(none.stdout, /Không thấy e2e\.config/);
  assert.doesNotMatch(none.stdout, /setup --quick/);
  const skipped = dryRun('22.22.3', { args: ['--skip-project'] });
  assert.match(skipped.stdout, /bỏ qua \(--skip-project\)/);
  assert.doesNotMatch(skipped.stdout, /setup --quick/);
});

test('install.ps1 có cùng các bước và tham số', () => {
  const ps = readFileSync(join(import.meta.dirname, '..', 'install.ps1'), 'utf8');
  for (const s of ['-Project', '-NoOpen', '-SkipProject', '-DryRun', "'plugin', 'install', $PluginId", "'setup', '--quick', '--yes'", "[version]'22.22.3'"]) {
    assert.ok(ps.includes(s.replace(/^-/, '[switch]$').replace('[switch]$Project', '[string]$Project')) || ps.includes(s), s);
  }
});
