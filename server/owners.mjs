// CODEOWNERS: who owns a test file (or the file a failure points at). GitHub's rules: the last
// matching pattern wins; patterns are gitignore-like.
import { readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';

const PLACES = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

export function parseCodeowners(text) {
  const rules = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (!line) continue;
    const [pattern, ...owners] = line.split(/\s+/);
    rules.push({ pattern, owners: owners.filter((o) => /^(@[\w./-]+|[^@\s]+@[^@\s]+)$/.test(o)), rx: patternToRegex(pattern) });
  }
  return rules;
}

export function patternToRegex(pattern) {
  let p = pattern;
  const anchored = p.startsWith('/') || p.slice(0, -1).includes('/');
  p = p.replace(/^\//, '');
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);
  let rx = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') {
        rx += '(?:.*/)?';
        i += 2;
      } else {
        rx += '.*';
        i += 1;
      }
    } else if (c === '*') rx += '[^/]*';
    else if (c === '?') rx += '[^/]';
    else rx += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${anchored ? '^' : '(?:^|/)'}${rx}(?:/.*)?$`);
}

export function ownersOf(rules, file) {
  const f = String(file ?? '').replace(/^\.\//, '');
  let hit = null;
  for (const r of rules) if (r.rx.test(f)) hit = r;
  return hit ? hit.owners : [];
}

export function readCodeowners(root) {
  for (const p of PLACES) {
    try {
      if (lstatSync(join(root, p)).isSymbolicLink()) continue;
      return { file: p, rules: parseCodeowners(readFileSync(join(root, p), 'utf8').slice(0, 512 * 1024)) };
    } catch {
      // not here
    }
  }
  return { file: null, rules: [] };
}
