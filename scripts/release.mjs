#!/usr/bin/env node
// Cut a release: bump the version everywhere, pin the marketplace to the new tag, commit and tag.
// `/e2e-dashboard update` installs whatever tag the marketplace on main points at.
// Tag và GitHub Release mang nội dung mục CHANGELOG của version (tính năng mới / cập nhật / sửa lỗi).
//
//   npm run release -- minor          (patch | minor | major | X.Y.Z)
//   npm run release -- minor --push   (also push main and the tag, and create the GitHub Release)
//   npm run release -- patch --trailer="Claude-Session: …"   (dòng thêm vào cuối commit release)
//   npm run release -- notes v0.8.6   (tạo / cập nhật GitHub Release của một tag đã push)
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseChangelog } from '../server/changelog.mjs';

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

// Nội dung mục "## vX.Y.Z — ngày" của CHANGELOG; thiếu mục thì lỗi (không phát hành bản không có ghi chú)
export function releaseNotes(changelogMd, version) {
  const entry = parseChangelog(changelogMd).find((e) => e.version === version);
  if (!entry?.body) throw new Error(`CHANGELOG.md chưa có mục v${version} — viết tính năng mới / cập nhật / sửa lỗi trước khi release`);
  return entry.body;
}

// Tạo GitHub Release cho tag (đã push) với ghi chú; có rồi thì cập nhật ghi chú
function publishNotes(sh, out, tag, notes) {
  const exists = (() => {
    try {
      out('gh', ['release', 'view', tag, '--repo', REPO, '--json', 'tagName']);
      return true;
    } catch {
      return false;
    }
  })();
  // chỉ bản cao nhất mang nhãn Latest (bổ sung Release cho bản cũ không được chiếm nhãn này)
  const newest = out('git', ['tag', '--list', 'v*', '--sort=-v:refname']).split('\n')[0];
  const latest = `--latest=${tag === newest}`;
  if (exists) sh('gh', ['release', 'edit', tag, '--repo', REPO, '--title', tag, '--notes', notes, latest]);
  else sh('gh', ['release', 'create', tag, '--repo', REPO, '--title', tag, '--notes', notes, '--verify-tag', latest]);
}

function main(argv) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
  const out = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim();
  const changelog = () => readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  if (argv[0] === 'notes') {
    const tag = argv[1];
    if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '')) throw new Error('usage: release notes vX.Y.Z');
    publishNotes(sh, out, tag, releaseNotes(changelog(), tag.slice(1)));
    console.log(`release notes published for ${tag}`);
    return;
  }
  const trailer = argv.find((a) => a.startsWith('--trailer='))?.slice('--trailer='.length);
  const kind = argv.find((a) => !a.startsWith('--')) ?? 'patch';
  if (out('git', ['branch', '--show-current']) !== 'main') throw new Error('release from main only');
  if (out('git', ['status', '--porcelain'])) throw new Error('working tree is not clean; commit or stash first');
  const current = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8')).version;
  const version = nextVersion(current, kind);
  const tag = `v${version}`;
  if (out('git', ['tag', '--list', tag])) throw new Error(`tag ${tag} already exists`);
  const notes = releaseNotes(changelog(), version); // kiểm tra trước khi bump
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
  sh('git', ['commit', '-m', trailer ? `chore: release ${tag}\n\n${trailer}` : `chore: release ${tag}`]);
  sh('git', ['tag', '-a', tag, '-m', `${tag}\n\n${notes}`]); // tag mang ghi chú của bản
  if (argv.includes('--push')) {
    sh('git', ['push', 'origin', 'HEAD', tag]);
    try {
      publishNotes(sh, out, tag, notes);
    } catch (e) {
      console.error(`release: đã push nhưng chưa tạo được GitHub Release (${e.message}); chạy lại: npm run release -- notes ${tag}`);
    }
  }
  console.log(`released ${tag}${argv.includes('--push') ? '' : ` (push with: git push origin main ${tag}; then: npm run release -- notes ${tag})`}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`release: ${e.message}`);
    process.exit(1);
  }
}
