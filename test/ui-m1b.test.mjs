import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSseParser } from '../ui/api.js';
import { selectionToRun } from '../ui/model.js';

test('createSseParser yields one event per data block across chunk boundaries', () => {
  const got = [];
  const feed = createSseParser((e) => got.push(e));
  feed('data: {"type":"session"}\n\ndata: {"type":"te');
  feed('xt","text":"a"}\n\n: ping\n\n');
  assert.deepEqual(got, [{ type: 'session' }, { type: 'text', text: 'a' }]);
});

test('selectionToRun turns selected rows into unique file:line tests, targets and agents', () => {
  const rows = [
    { id: '1', file: 'tests/a.e2e.ts', line: 3, target: 'web', agent: 'default' },
    { id: '2', file: 'tests/a.e2e.ts', line: 3, target: 'webkit', agent: 'default' },
    { id: '3', file: 'tests/b.e2e.ts', line: 9, target: 'web', agent: 'fast' },
    { id: '4', file: 'tests/c.e2e.ts', line: null, target: 'web', agent: 'default' },
  ];
  assert.deepEqual(selectionToRun(rows, new Set(['1', '2', '3', '4'])), {
    tests: ['tests/a.e2e.ts:3', 'tests/b.e2e.ts:9', 'tests/c.e2e.ts'],
    targets: ['web', 'webkit'],
    agents: ['default', 'fast'],
  });
  assert.deepEqual(selectionToRun(rows, new Set()), { tests: [], targets: [], agents: [] });
});
