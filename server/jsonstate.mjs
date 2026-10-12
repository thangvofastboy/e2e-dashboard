// Small JSON state files under .e2e-dashboard/ (triage, alerts, events, long-term stats…). Reads never
// follow a symlink a cloned repo planted; writes go through a temp file + rename, so a symlink at the
// target is replaced, never written through.
import { readFile, writeFile, rename, rm, mkdir, lstat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { DATA_DIR, isLink, ensureDataDir, dataPath, legacyDataPath } from '../reporter/e2e-dashboard.reporter.mjs';

// state/… hoặc runtime/… theo bố cục mới (dataPath); đọc thì rơi về vị trí cũ nếu chưa chạy doctor
export const statePath = (root, rel) => dataPath(root, rel);

export async function readState(root, rel, fallback) {
  for (const p of [statePath(root, rel), legacyDataPath(root, rel)]) {
    const data = join(root, DATA_DIR);
    // mọi thư mục từ .e2e-dashboard tới file (không xét project root: nó có thể là symlink hợp lệ)
    for (let d = dirname(p); d.startsWith(data); d = dirname(d)) if (isLink(d)) return fallback;
    if (isLink(p)) return fallback;
    let text;
    try {
      text = await readFile(p, 'utf8');
    } catch {
      continue; // chưa có ở đây: thử vị trí cũ
    }
    try {
      return JSON.parse(text) ?? fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export const writeState = (root, rel, value) => writeText(root, rel, JSON.stringify(value));

export async function writeText(root, rel, text) {
  if (!(await ensureDataDir(root))) throw new Error('unsafe data dir');
  const p = statePath(root, rel);
  const dir = dirname(p);
  for (const d of [dirname(dir), dir]) if ((await lstat(d).catch(() => null))?.isSymbolicLink()) throw new Error(`Từ chối ghi qua symlink: ${d}`);
  await mkdir(dir, { recursive: true });
  const tmp = `${p}.tmp-${randomBytes(6).toString('hex')}`;
  await writeFile(tmp, text, { flag: 'wx' });
  try {
    await rename(tmp, p);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  return p;
}

// Serialises read-modify-write cycles on one file within this process.
const chains = new Map();
export function serial(key, fn) {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  const tail = next.catch(() => {}).finally(() => chains.get(key) === tail && chains.delete(key));
  chains.set(key, tail);
  return next;
}

export const clip = (s, n) => String(s ?? '').slice(0, n);
