// Phát hiện hệ điều hành đang chạy để cài đúng cách: distro Linux (qua /etc/os-release), WSL, musl (Alpine),
// phiên bản macOS / Windows, kiến trúc CPU. Không spawn lệnh nào: chỉ đọc file và os.*, nên gọi được ở mọi request.
import { existsSync, readFileSync } from 'node:fs';
import { arch as osArch, platform as osPlatform, release as osRelease } from 'node:os';

// thứ tự trình quản lý gói thử theo họ distro; dòng cuối là dự phòng khi không nhận ra distro
const FAMILY_PMS = {
  debian: ['apt-get'],
  rhel: ['dnf', 'yum'],
  arch: ['pacman'],
  suse: ['zypper'],
  alpine: ['apk'],
  darwin: ['brew'],
  windows: ['winget'],
  unknown: ['apt-get', 'dnf', 'yum', 'pacman', 'zypper', 'apk'],
};

const FAMILY_OF = [
  ['debian', /\b(debian|ubuntu|linuxmint|pop|raspbian|elementary|zorin|kali|neon)\b/],
  ['rhel', /\b(rhel|fedora|centos|rocky|almalinux|ol|amzn)\b/],
  ['arch', /\b(arch|manjaro|endeavouros|garuda)\b/],
  ['suse', /\b(suse|opensuse|opensuse-leap|opensuse-tumbleweed|sles)\b/],
  ['alpine', /\balpine\b/],
];

export function parseOsRelease(text = '') {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const read = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};

// Darwin 20 = macOS 11, 21 = 12, … (từ Big Sur số major cách nhau 9)
const macVersion = (kernel) => {
  const major = Number(String(kernel).split('.')[0]);
  return major >= 20 ? String(major - 9) : major >= 4 ? `10.${major - 4}` : '';
};
const ARCH = { x64: 'x64', arm64: 'arm64', ia32: 'x86', arm: 'arm' };

// deps tiêm được để test: platform, arch, release, env, osRelease (nội dung /etc/os-release), procVersion, exists
export function osInfo(deps = {}) {
  const platform = deps.platform ?? osPlatform();
  const arch = ARCH[deps.arch ?? osArch()] ?? deps.arch ?? osArch();
  const release = deps.release ?? osRelease();
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;
  if (platform === 'darwin') {
    const v = macVersion(release);
    return { platform, arch, family: 'darwin', name: `macOS ${v}`.trim(), version: v, wsl: false, musl: false, pms: FAMILY_PMS.darwin, label: `macOS ${v} (${arch === 'arm64' ? 'Apple Silicon' : 'Intel'})` };
  }
  if (platform === 'win32') {
    const build = Number(String(release).split('.')[2] ?? 0);
    const name = build >= 22000 ? 'Windows 11' : 'Windows 10';
    return { platform, arch, family: 'windows', name, version: release, wsl: false, musl: false, pms: FAMILY_PMS.windows, label: `${name} (${arch}, build ${build || '?'})` };
  }
  if (platform !== 'linux') return { platform, arch, family: 'unknown', name: platform, version: release, wsl: false, musl: false, pms: FAMILY_PMS.unknown, label: `${platform} ${release} (${arch})` };
  const r = parseOsRelease(deps.osRelease ?? (read('/etc/os-release') || read('/usr/lib/os-release')));
  const ids = `${r.ID ?? ''} ${r.ID_LIKE ?? ''}`.toLowerCase();
  const family = FAMILY_OF.find(([, re]) => re.test(ids))?.[0] ?? 'unknown';
  const wsl = Boolean(env.WSL_DISTRO_NAME) || /microsoft/i.test(deps.procVersion ?? read('/proc/version'));
  const musl = family === 'alpine' || exists('/lib/ld-musl-x86_64.so.1') || exists('/lib/ld-musl-aarch64.so.1');
  const name = r.PRETTY_NAME || [r.NAME, r.VERSION_ID].filter(Boolean).join(' ') || 'Linux';
  return {
    platform, arch, family, name, id: r.ID ?? null, version: r.VERSION_ID ?? null, wsl, musl, pms: FAMILY_PMS[family],
    label: `${name} (${arch}${wsl ? ', WSL' : ''}${musl ? ', musl' : ''})`,
  };
}
