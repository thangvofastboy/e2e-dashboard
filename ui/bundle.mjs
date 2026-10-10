// Tiny concatenating bundler for the dashboard UI: one script for the server and the HTML export.
import { readFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';

const IMPORT = /^\s*import\s*\{[^}]*\}\s*from\s*['"](\.{1,2}\/[^'"]+)['"];?\s*$/gm;

export async function bundleUi(uiDir, entry = 'app.js') {
  const seen = new Set();
  const parts = [];
  async function visit(file) {
    if (seen.has(file)) return;
    seen.add(file);
    const src = await readFile(file, 'utf8');
    if (/^\s*export\s+default\b/m.test(src)) throw new Error(`export default is not supported: ${file}`);
    for (const [, spec] of src.matchAll(IMPORT)) await visit(resolve(dirname(file), spec));
    const body = src.replace(IMPORT, '').replace(/^(\s*)export\s+(?=(async\s+)?function|const|let|class)/gm, '$1');
    parts.push(`// ${relative(uiDir, file)}\n${body}`);
  }
  await visit(resolve(uiDir, entry));
  return `(() => {\n'use strict';\n${parts.join('\n')}\n})();\n`;
}
