// Quarantined (known-flaky) tests: kept out of runs until a date, listed for CI as e2e flags.
// One JSON file in .e2e-dashboard/ (local); `/e2e-dashboard quarantine` prints the flags to commit.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { DATA_DIR, isLink, ensureDataDir } from '../reporter/e2e-dashboard.reporter.mjs';

const file = (root) => join(root, DATA_DIR, 'quarantine.json');
const KEY = /^[^\n|]{1,600}\|[\w.-]{1,80}\|[\w.-]{1,80}$/;

export async function readQuarantine(root) {
  if (isLink(file(root))) return [];
  try {
    const list = JSON.parse(await readFile(file(root), 'utf8'));
    return Array.isArray(list) ? list.filter((q) => q && typeof q.key === 'string' && KEY.test(q.key)) : [];
  } catch {
    return [];
  }
}

async function save(root, list) {
  if (!(await ensureDataDir(root))) throw new Error('unsafe data dir');
  const tmp = `${file(root)}.tmp-${randomBytes(6).toString('hex')}`;
  await writeFile(tmp, JSON.stringify(list, null, 2), { flag: 'wx' });
  await rename(tmp, file(root));
}

export async function addQuarantine(root, { key, title, file: testFile, line, reason = '', days = 14 }, now = Date.now()) {
  if (typeof key !== 'string' || !KEY.test(key)) throw new Error('invalid key');
  const d = Number.isInteger(days) && days > 0 && days <= 365 ? days : 14;
  const list = (await readQuarantine(root)).filter((q) => q.key !== key);
  const entry = { key, title: String(title ?? key).slice(0, 300), file: String(testFile ?? '').slice(0, 300), line: Number.isInteger(line) ? line : null, reason: String(reason).slice(0, 500), addedAt: new Date(now).toISOString(), until: new Date(now + d * 86_400_000).toISOString() };
  list.push(entry);
  await save(root, list);
  return entry;
}

export async function removeQuarantine(root, key) {
  const list = await readQuarantine(root);
  const next = list.filter((q) => q.key !== key);
  if (next.length === list.length) return false;
  await save(root, next);
  return true;
}

export const expired = (q, now = Date.now()) => Date.parse(q.until) < now;

// e2e matches --grep-invert against "describe titles + test title"; escape the title as a regex.
export function quarantineFlags(list, now = Date.now()) {
  const active = list.filter((q) => !expired(q, now));
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const patterns = active.map((q) => `^${esc(q.title.replace(/ › /g, ' '))}$`);
  return {
    active,
    expired: list.filter((q) => expired(q, now)),
    args: patterns.flatMap((p) => ['--grep-invert', p]),
    command: patterns.length ? `npx e2e run ${patterns.map((p) => `--grep-invert '${p.replace(/'/g, "'\\''")}'`).join(' ')}` : null,
  };
}
