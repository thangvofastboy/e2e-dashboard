import { test } from 'node:test';
import assert from 'node:assert/strict';
import { osInfo, parseOsRelease } from '../server/osinfo.mjs';

const linux = (osRelease, extra = {}) => osInfo({ platform: 'linux', arch: 'x64', release: '6.0', env: {}, osRelease, procVersion: 'Linux version 6.0', exists: () => false, ...extra });

test('parseOsRelease đọc KEY=value, bỏ nháy', () => {
  assert.deepEqual(parseOsRelease('ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 24.04 LTS"\n# x\n'), { ID: 'ubuntu', ID_LIKE: 'debian', PRETTY_NAME: 'Ubuntu 24.04 LTS' });
});

test('distro Linux → họ và trình quản lý gói đúng', () => {
  const cases = [
    ['ID=ubuntu\nID_LIKE=debian\nVERSION_ID="24.04"', 'debian', ['apt-get']],
    ['ID=linuxmint\nID_LIKE="ubuntu debian"', 'debian', ['apt-get']],
    ['ID=fedora\nVERSION_ID=40', 'rhel', ['dnf', 'yum']],
    ['ID="rocky"\nID_LIKE="rhel centos fedora"', 'rhel', ['dnf', 'yum']],
    ['ID=arch', 'arch', ['pacman']],
    ['ID="opensuse-tumbleweed"\nID_LIKE="opensuse suse"', 'suse', ['zypper']],
    ['ID=alpine', 'alpine', ['apk']],
    ['ID=nixos', 'unknown', ['apt-get', 'dnf', 'yum', 'pacman', 'zypper', 'apk']],
  ];
  for (const [rel, family, pms] of cases) {
    const o = linux(rel);
    assert.equal(o.family, family, rel);
    assert.deepEqual(o.pms, pms, rel);
  }
  assert.equal(linux('ID=alpine').musl, true);
});

test('WSL nhận qua /proc/version hoặc WSL_DISTRO_NAME; nhãn ghi rõ', () => {
  assert.equal(linux('ID=ubuntu', { procVersion: 'Linux version 5.15.0-microsoft-standard-WSL2' }).wsl, true);
  const o = linux('ID=ubuntu\nPRETTY_NAME="Ubuntu 22.04"', { env: { WSL_DISTRO_NAME: 'Ubuntu' } });
  assert.equal(o.wsl, true);
  assert.match(o.label, /Ubuntu 22\.04 \(x64, WSL\)/);
});

test('macOS: phiên bản từ Darwin, Apple Silicon / Intel; Windows 10 / 11 theo build', () => {
  const mac = osInfo({ platform: 'darwin', arch: 'arm64', release: '24.1.0' });
  assert.equal(mac.name, 'macOS 15');
  assert.match(mac.label, /Apple Silicon/);
  assert.deepEqual(mac.pms, ['brew']);
  assert.match(osInfo({ platform: 'darwin', arch: 'x64', release: '19.6.0' }).label, /macOS 10\.15 \(Intel\)/);
  assert.equal(osInfo({ platform: 'win32', arch: 'x64', release: '10.0.22631' }).name, 'Windows 11');
  assert.equal(osInfo({ platform: 'win32', arch: 'x64', release: '10.0.19045' }).name, 'Windows 10');
});
