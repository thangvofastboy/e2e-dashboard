// Timeline annotations (M7): deploys, releases, incidents, environment changes, notes — drawn on the
// trend charts so a drop in pass rate lines up with its cause. Added from the dashboard, from
// `/e2e-dashboard mark …` (works in CI too: it only writes the file) and, read-only, from git tags.
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readState, writeState, serial, clip } from './jsonstate.mjs';

export const EVENT_KINDS = ['deploy', 'release', 'incident', 'env', 'note'];
const FILE = 'events.json';
const ID = /^ev-[0-9a-f]{12}$/;

export async function readEvents(root) {
  const list = await readState(root, FILE, []);
  // the file may come with a cloned repo: keep only well-formed entries and https links
  return Array.isArray(list)
    ? list.filter((e) => e && ID.test(e.id) && EVENT_KINDS.includes(e.kind) && Number.isFinite(Date.parse(e.at)))
      .map((e) => ({ id: e.id, kind: e.kind, at: new Date(e.at).toISOString(), label: clip(e.label, 200), url: typeof e.url === 'string' && /^https:\/\/\S{1,500}$/.test(e.url) ? e.url : null, createdAt: e.createdAt ?? null }))
    : [];
}

export async function addEvent(root, { kind, label, at, url } = {}) {
  if (!EVENT_KINDS.includes(kind)) throw new Error(`loại sự kiện phải là một trong: ${EVENT_KINDS.join(', ')}`);
  const text = clip(label, 200).trim();
  if (!text) throw new Error('thiếu mô tả sự kiện');
  const t = at === undefined || at === null || at === '' ? Date.now() : Date.parse(at);
  if (!Number.isFinite(t)) throw new Error('thời điểm không hợp lệ');
  return serial(`${root}:events`, async () => {
    const list = await readEvents(root);
    const e = { id: `ev-${randomBytes(6).toString('hex')}`, kind, label: text, at: new Date(t).toISOString(), url: typeof url === 'string' && /^https:\/\/\S{1,500}$/.test(url) ? url : null, createdAt: new Date().toISOString() };
    list.push(e);
    list.sort((a, b) => a.at.localeCompare(b.at));
    await writeState(root, FILE, list.slice(-1000));
    return e;
  });
}

export function removeEvent(root, id) {
  return serial(`${root}:events`, async () => {
    const list = await readEvents(root);
    const next = list.filter((e) => e.id !== id);
    if (next.length === list.length) return false;
    await writeState(root, FILE, next);
    return true;
  });
}

// Git tags, newest first: name, date, commit (peeled for annotated tags).
export function gitTags(root, { limit = 50, execImpl = execFile } = {}) {
  return new Promise((ok) => {
    execImpl('git', ['for-each-ref', 'refs/tags', '--sort=-creatordate', `--count=${limit}`, '--format=%(refname:short)%09%(creatordate:iso-strict)%09%(objectname)%09%(*objectname)'], { cwd: root, timeout: 5000, maxBuffer: 1024 * 1024 }, (err, out) => {
      if (err) return ok([]);
      ok(String(out).split('\n').filter(Boolean).map((l) => {
        const [name, date, obj, peeled] = l.split('\t');
        return { name, date, commit: peeled || obj };
      }).filter((t) => /^[\w.\-/+]{1,120}$/.test(t.name) && /^[0-9a-f]{40,64}$/.test(t.commit ?? '')));
    });
  });
}

// Events in a time window, git tags included as releases.
export async function timeline(root, { from = 0, to = Date.now(), tags = true } = {}) {
  const own = (await readEvents(root)).filter((e) => Date.parse(e.at) >= from && Date.parse(e.at) <= to);
  const fromTags = tags ? (await gitTags(root)).filter((t) => Date.parse(t.date) >= from && Date.parse(t.date) <= to).map((t) => ({ id: `tag:${t.name}`, kind: 'release', label: t.name, at: new Date(t.date).toISOString(), auto: true })) : [];
  return [...own, ...fromTags].sort((a, b) => a.at.localeCompare(b.at));
}

// Last commit touching each file: { file: { commit, at, author } }, for the test lifecycle page.
export async function lastCommits(root, files, { execImpl = execFile, limit = 200 } = {}) {
  const out = {};
  const list = [...new Set(files.filter((f) => typeof f === 'string' && f && !f.startsWith('-') && !f.includes('\0')))].slice(0, limit);
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const f = list[i++];
      out[f] = await new Promise((ok) =>
        execImpl('git', ['log', '-1', '--format=%h%x09%cI%x09%an', '--', f], { cwd: root, timeout: 5000 }, (err, so) => {
          const [commit, at, author] = err ? [] : String(so).trim().split('\t');
          ok(commit ? { commit, at, author: String(author ?? '').slice(0, 80) } : null);
        }));
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}
