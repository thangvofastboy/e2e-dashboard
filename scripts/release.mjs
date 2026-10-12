#!/usr/bin/env node
// Cut a release: bump the version everywhere, pin the marketplace to the new tag, commit and tag.
// `/e2e-dashboard update` installs whatever tag the marketplace on main points at.
//
//   npm run release -- minor          (patch | minor | major | X.Y.Z)
//   npm run release -- minor --push   (also push main and the tag)
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = 'thangvofastboy/e2e-dashboard';
const semver = (v) => v.split('.').map(Number);

export function nextVersion(current, kind) {
  const [a, b, c] = semver(current);
  const next = kind === 'major' ? `${a + 1}.0.0` : kind === 'minor' ? `${a}.${b + 1}.0` : kind === 'patch' ? `${a}.${b}.${c + 1}` : kind;
  if (!/^\d+\.\d+\.\d+$/.test(next)) throw new Error(`version must be patch|minor|major|X.Y.Z, got '${kind}'`);
  const [x, y, z] = semver(next);
  if (x * 1e6 + y * 1e3 + z <= a * 1e6 + b * 1e3 + c) throw new Error(`version ${next} must be greater than ${current}`);
  return next;
}

const editJson = (path, fn) => {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  fn(data);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
};

export function setVersion(root, version, repo = REPO) {
  const files = ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'package.json', 'reporter/e2e-dashboard.reporter.mjs'];
  editJson(join(root, files[0]), (d) => (d.version = version));
  editJson(join(root, files[1]), (d) => {
    for (const p of d.plugins) if (p.name === 'e2e-dashboard') Object.assign(p, { source: { source: 'github', repo, ref: `v${version}` }, version });
  });
  editJson(join(root, files[2]), (d) => (d.version = version));
  const rp = join(root, files[3]);
  writeFileSync(rp, readFileSync(rp, 'utf8').replace(/export const VERSION = '[^']*';/, `export const VERSION = '${version}';`));
  return files;
}

function main(argv) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
  const out = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim();
  const kind = argv.find((a) => !a.startsWith('--')) ?? 'patch';
  if (out('git', ['branch', '--show-current']) !== 'main') throw new Error('release from main only');
  if (out('git', ['status', '--porcelain'])) throw new Error('working tree is not clean; commit or stash first');
  const current = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8')).version;
  const version = nextVersion(current, kind);
  const tag = `v${version}`;
  if (out('git', ['tag', '--list', tag])) throw new Error(`tag ${tag} already exists`);
  sh('claude', ['plugin', 'validate', '.']);
  const files = setVersion(root, version);
  // test sau khi bump: test CHANGELOG kiểm tra mục đầu khớp version đang release
  try {
    sh('npm', ['test']);
    sh('claude', ['plugin', 'test', '.']);
  } catch (e) {
    sh('git', ['checkout', '--', ...files]); // lỗi test thì trả lại file, không để bump dở
    throw e;
  }
  sh('git', ['add', ...files]);
  sh('git', ['commit', '-m', `chore: release ${tag}`]);
  sh('git', ['tag', '-a', tag, '-m', tag]);
  if (argv.includes('--push')) sh('git', ['push', 'origin', 'HEAD', tag]);
  console.log(`released ${tag}${argv.includes('--push') ? '' : ` (push with: git push origin main ${tag})`}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`release: ${e.message}`);
    process.exit(1);
  }
}
