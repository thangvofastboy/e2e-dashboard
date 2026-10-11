// "What's new": the plugin's own CHANGELOG.md, split into versions (## vX.Y.Z — date).
import { readFile } from 'node:fs/promises';

export function parseChangelog(md) {
  const out = [];
  let cur = null;
  for (const line of String(md).split(/\r?\n/)) {
    const h = /^##\s+v?(\d+\.\d+\.\d+)\s*(?:[—-]\s*(.*))?$/.exec(line);
    if (h) {
      cur = { version: h[1], date: h[2]?.trim() || null, body: [] };
      out.push(cur);
    } else if (cur) cur.body.push(line);
  }
  return out.map((e) => ({ ...e, body: e.body.join('\n').trim() }));
}

export async function readChangelog() {
  try {
    return parseChangelog(await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8')).slice(0, 20);
  } catch {
    return [];
  }
}
