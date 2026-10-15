// Static report site (M7): index.html (90-day report + 12-month calendar) and the latest runs as
// self-contained HTML, in a folder you can push to GitHub Pages or a shared drive. The folder is
// .e2e-dashboard/site unless the user passes one (CLI) or sets "publish": { "dir" } in their own
// ~/.e2e-dashboard/config.json — never from the repo's config, which a clone controls.
import { mkdir, writeFile, rename, rm, lstat, readFile, readdir, unlink } from 'node:fs/promises';
import zlib, { deflateRaw } from 'node:zlib';
import { promisify } from 'node:util';

const deflate = promisify(deflateRaw);
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DATA_DIR, ensureDataDir } from '../reporter/e2e-dashboard.reporter.mjs';
import { listRuns } from './store.mjs';
import { buildExportHtml } from './export.mjs';
import { buildReport } from './reports.mjs';
import { reportHtml } from './report-html.mjs';
import { homeDir } from './projects.mjs';

export async function siteDir(root, dir = null, env = process.env) {
  if (dir) return resolve(dir);
  try {
    const d = JSON.parse(await readFile(join(homeDir(env), 'config.json'), 'utf8'))?.publish?.dir;
    if (typeof d === 'string' && d) return resolve(d);
  } catch {
    // default below
  }
  return join(root, DATA_DIR, 'site');
}

async function put(dir, name, text) {
  const p = join(dir, name);
  const tmp = join(dir, `.tmp-${randomBytes(6).toString('hex')}`);
  await writeFile(tmp, text, { flag: 'wx' });
  try {
    await rename(tmp, p); // a symlink planted at p is replaced, never written through
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

export async function publishSite(root, { dir = null, runs = 10, env = process.env } = {}) {
  const out = await siteDir(root, dir, env);
  if (out.startsWith(join(root, DATA_DIR)) && !(await ensureDataDir(root))) throw new Error('unsafe data dir');
  for (const d of [out, join(out, 'runs')]) {
    if ((await lstat(d).catch(() => null))?.isSymbolicLink()) throw new Error(`Từ chối ghi qua symlink: ${d}`);
    await mkdir(d, { recursive: true });
  }
  const metas = (await listRuns(root)).filter((m) => m.kind !== 'explore').slice(0, Math.max(0, Math.min(50, runs)));
  const links = [];
  for (const m of metas) {
    const x = await buildExportHtml(root, m.runId).catch(() => null);
    if (!x) continue;
    await put(join(out, 'runs'), `${x.runId}.html`, x.html);
    links.push({ href: `runs/${x.runId}.html`, label: `${m.git?.branch ?? ''}${m.git?.commit ? `@${String(m.git.commit).slice(0, 7)}` : ''} ${m.runId.slice(-8)}`.trim(), status: m.status, at: m.startedAt });
  }
  // trang run của lần xuất trước không còn trong index: xoá, để thư mục (và zip tải về) đúng bằng trang đang xuất
  const keep = new Set(links.map((l) => l.href.slice('runs/'.length)));
  for (const n of await readdir(join(out, 'runs')).catch(() => [])) if (n.endsWith('.html') && !keep.has(n)) await unlink(join(out, 'runs', n)).catch(() => {});
  const data = await buildReport(root, { kind: 'site', calendar: true });
  await put(out, 'index.html', reportHtml(data, { runs: links }));
  await put(out, '.nojekyll', '');
  return { dir: out, runs: links.length, index: join(out, 'index.html') };
}

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
// zlib.crc32 (native, Node ≥ 22.2) khi có; bản JS cho Node 22.0–22.1
const crc32 = zlib.crc32 ?? ((b) => { let c = ~0; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return ~c >>> 0; });

// Zip (deflate) từ danh sách { name, data }: đủ cho vài chục file HTML, không cần ZIP64. Nén bất đồng bộ (threadpool
// của zlib) để file run vài MB không chặn server
export async function zipFiles(files) {
  const local = []; const central = []; let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name); const raw = Buffer.from(f.data); const z = await deflate(raw); const crc = crc32(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(z.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(z.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    local.push(h, name, z); central.push(c, name); off += 30 + name.length + z.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, end]);
}

// Trang tĩnh đã xuất, gói thành zip để tải về (chỉ file thường, bỏ symlink và file tạm)
export async function siteZip(root, env = process.env) {
  const out = await siteDir(root, null, env);
  // giống publishSite: không đọc qua thư mục symlink (repo clone về có thể cài site/runs -> ~/.aws)
  for (const d of [out, join(out, 'runs')]) if ((await lstat(d).catch(() => null))?.isSymbolicLink()) return null;
  const files = [];
  for (const rel of ['index.html', '.nojekyll', ...(await readdir(join(out, 'runs')).catch(() => [])).map((n) => `runs/${n}`)]) {
    const st = await lstat(join(out, rel)).catch(() => null);
    if (!st?.isFile() || rel.includes('.tmp-')) continue;
    files.push({ name: `e2e-report/${rel}`, data: await readFile(join(out, rel)) });
  }
  return files.some((f) => f.name.endsWith('/index.html')) ? zipFiles(files) : null;
}
