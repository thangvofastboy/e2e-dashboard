// Small JSON state files under .e2e-dashboard/ (triage, alerts, events, long-term stats…). Reads never
// follow a symlink a cloned repo planted; writes go through a temp file + rename, so a symlink at the
// target is replaced, never written through.
import { readFile, writeFile, rename, rm, mkdir, lstat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { DATA_DIR, isLink, ensureDataDir } from '../reporter/e2e-dashboard.reporter.mjs';

export const statePath = (root, rel) => join(root, DATA_DIR, rel);

export async function readState(root, rel, fallback) {
  const p = statePath(root, rel);
  if (isLink(join(root, DATA_DIR)) || isLink(dirname(p)) || isLink(p)) return fallback;
  try {
    const v = JSON.parse(await readFile(p, 'utf8'));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export const writeState = (root, rel, value) => writeText(root, rel, JSON.stringify(value));

export async function writeText(root, rel, text) {
  if (!(await ensureDataDir(root))) throw new Error('unsafe data dir');
  const p = statePath(root, rel);
  const dir = dirname(p);
  if ((await lstat(dir).catch(() => null))?.isSymbolicLink()) throw new Error(`Từ chối ghi qua symlink: ${dir}`);
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
