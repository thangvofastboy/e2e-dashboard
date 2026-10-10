import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const CONFIG_NAMES = ['e2e.config.ts', 'e2e.config.mts', 'e2e.config.js', 'e2e.config.mjs'];

export function findConfig(dir) {
  for (const n of CONFIG_NAMES) if (existsSync(join(dir, n))) return join(dir, n);
  return null;
}

export function findProjectRoot(start) {
  let d = resolve(start);
  for (;;) {
    if (findConfig(d)) return d;
    const parent = dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}
