import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const VIEWS = new URL('../ui/views/', import.meta.url).pathname;
const files = readdirSync(VIEWS).filter((f) => f.endsWith('.js')).map((f) => [f, readFileSync(join(VIEWS, f), 'utf8')]);

test('no view uses the browser confirm(): every confirmation is the shared dialog', () => {
  for (const [f, src] of files) assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /(^|[^\w.])confirm\(/m, f);
});

// An endpoint that deletes, removes, stops or switches something dangerous on must be asked about first:
// the call has to be preceded, within the same handler, by confirmDialog.
const DANGEROUS = /postJson\((?:'|`)\/api\/(?:projects\/forget|timeline\/remove|quarantine\/remove|run\/stop|storage\/(?:prune|cleanup)|cache\/clear|selfheal\/(?:approve|reject)|qc\/manual'?`?, \{ delete|qc\/templates'?`?, \{ (?:delete|reset)|linear\/detach|runs\/\$\{[^}]+\}\/delete|system\/doctor)/g;

test('every dangerous action asks through confirmDialog first', () => {
  const unguarded = [];
  let seen = 0;
  for (const [f, src] of files) {
    for (const m of src.matchAll(DANGEROUS)) {
      seen++;
      const before = src.slice(Math.max(0, m.index - 700), m.index);
      if (!before.includes('confirmDialog(')) unguarded.push(`${f}: ${m[0]}`);
    }
  }
  assert.ok(seen >= 16, `the pattern still finds the dangerous calls (${seen})`);
  assert.deepEqual(unguarded, []);
});

test('turning automation on (auto bug log, self-heal), clearing keys, and snapshot overwrite are confirmed too', () => {
  const sys = files.find(([f]) => f === 'system.js')[1];
  for (const needle of ["title: 'Bật tự log bug'", "title: 'Bật tự sửa lỗi'", "title: 'Xoá Linear API key'", "title: 'Xoá webhook'"]) assert.ok(sys.includes(needle), needle);
  assert.ok(files.find(([f]) => f === 'run-dialog.js')[1].includes("title: 'Cập nhật snapshot'"));
});

test('the reset dialog keeps its typed RESET confirmation', () => {
  const sys = files.find(([f]) => f === 'system.js')[1];
  assert.match(sys, /input\.value !== 'RESET'/);
});

test('style.css lets the hidden attribute win over a class display (typed field, QC buttons)', () => {
  const css = readFileSync(new URL('../ui/style.css', import.meta.url), 'utf8');
  assert.match(css, /^\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/m);
});
