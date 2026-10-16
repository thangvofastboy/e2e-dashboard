// Quarantined (known-flaky) tests: kept out of runs until a date, listed for CI as e2e flags.
// One JSON file in .e2e-dashboard/ (local); `/e2e-dashboard quarantine` prints the flags to commit.
import { serial, readState, writeState } from './jsonstate.mjs';

const KEY = /^[^\n|]{1,600}\|[\w.-]{1,80}\|[\w.-]{1,80}$/;

export async function readQuarantine(root) {
  const list = await readState(root, 'quarantine.json', []); // state/quarantine.json (đọc cả vị trí cũ)
  return Array.isArray(list) ? list.filter((q) => q && typeof q.key === 'string' && KEY.test(q.key) && typeof q.title === 'string' && typeof q.until === 'string') : [];
}

const save = (root, list) => writeState(root, 'quarantine.json', list);

export async function addQuarantine(root, { key, title, file: testFile, line, reason = '', days = 14 }, now = Date.now()) {
  if (typeof key !== 'string' || !KEY.test(key)) throw new Error('invalid key');
  const d = Number.isInteger(days) && days > 0 && days <= 365 ? days : 14;
  return serial(`${root}:quarantine`, async () => {
    const list = (await readQuarantine(root)).filter((q) => q.key !== key);
    const entry = { key, title: String(title ?? key).slice(0, 300), file: String(testFile ?? '').slice(0, 300), line: Number.isInteger(line) ? line : null, reason: String(reason).slice(0, 500), addedAt: new Date(now).toISOString(), until: new Date(now + d * 86_400_000).toISOString() };
    list.push(entry);
    await save(root, list);
    return entry;
  });
}

export async function removeQuarantine(root, key) {
  return serial(`${root}:quarantine`, async () => {
    const list = await readQuarantine(root);
    const next = list.filter((q) => q.key !== key);
    if (next.length === list.length) return false;
    await save(root, next);
    return true;
  });
}

export const expired = (q, now = Date.now()) => Date.parse(q.until) < now;

// e2e matches --grep-invert against "describe titles + test title"; escape the title as a regex.
export function quarantineFlags(list, now = Date.now()) {
  const active = list.filter((q) => !expired(q, now));
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const patterns = active.map((q) => `^${esc(q.title.replace(/ › /g, ' '))}$`);
  // Playwright so --grep-invert với tiêu đề đầy đủ "project file describe… tiêu đề @tag": kèm tên file để cách ly
  // "works" không kéo theo "Login › works" ở file khác; mục không có file thì khớp theo cuối tiêu đề như cũ
  const pwOne = (q) => {
    const name = String(q.file ?? '').split(/[\\/]/).pop();
    return name ? `(?:^|[ /\\\\])${esc(name)} (?:.* )?${esc(q.title.replace(/ › /g, ' '))}(?: @\\S+)*$` : `(?:^| )${esc(q.title.replace(/ › /g, ' '))}(?: @\\S+)*$`;
  };
  return {
    active,
    pw: active.length ? active.slice(0, 100).map((q) => `(?:${pwOne(q)})`).join('|') : null,
    expired: list.filter((q) => expired(q, now)),
    args: patterns.flatMap((p) => ['--grep-invert', p]),
    command: patterns.length ? `npx e2e run ${patterns.map((p) => `--grep-invert '${p.replace(/'/g, "'\\''")}'`).join(' ')}` : null,
  };
}
