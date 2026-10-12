import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, result } from './_history.mjs';
import { findDuplicates, splitCandidates, actionPrompt, stepSignature } from '../server/dupes.mjs';

// a result whose first attempt has the given steps
function withSteps(r, steps) {
  r.attempts[0].steps = steps;
  return r;
}
const st = (api, label, events = []) => ({ api, label, status: 'passed', events });

test('same steps in two different tests is a duplicate group; one test on two targets is not', () => {
  const steps = [st('agent.act', 'open cart'), st('agent.act', 'Pay now')];
  const a = withSteps(result({ testId: 'buy', title: 'buy', idSeed: 1, target: 'web' }), steps);
  const b = withSteps(result({ testId: 'checkout', title: 'checkout', idSeed: 2 }), [st('agent.act', 'open   CART'), st('agent.act', 'pay now')]);
  const c = withSteps(result({ testId: 'buy', title: 'buy', idSeed: 3, target: 'ios' }), steps);
  const groups = findDuplicates(run({ results: [a, b, c] }).report);
  const same = groups.find((g) => g.kind === 'same-steps');
  assert.ok(same, 'steps group found');
  assert.deepEqual(same.members.map((m) => m.testId).sort(), ['tests/a.e2e.ts::buy', 'tests/a.e2e.ts::checkout']);
  assert.equal(groups.filter((g) => g.kind === 'same-title').length, 0, 'the same test on two targets is not a title duplicate');
});

test('same title in two files is a duplicate; different titles are not', () => {
  const x = result({ testId: 'tests/a.e2e.ts::login', title: 'login', idSeed: 1 });
  const y = result({ testId: 'tests/b.e2e.ts::login', title: 'login', idSeed: 2 });
  const z = result({ testId: 'tests/c.e2e.ts::logout', title: 'logout', idSeed: 3 });
  const groups = findDuplicates(run({ results: [x, y, z] }).report);
  assert.deepEqual(groups.map((g) => g.kind), ['same-title']);
  assert.equal(groups[0].members.length, 2);
});

test('a long test that changes pages is a split candidate, with where to cut it', () => {
  const nav = (url) => ({ kind: 'navigation', detail: url });
  const steps = Array.from({ length: 16 }, (_, i) => st('agent.act', `step ${i}`, i === 5 || i === 11 ? [nav('/cart')] : []));
  const long = withSteps(result({ testId: 'tests/long.e2e.ts::flow', title: 'flow', idSeed: 4 }), steps);
  const short = withSteps(result({ testId: 'tests/s.e2e.ts::s', title: 's', idSeed: 5 }), steps.slice(0, 3));
  const [split] = splitCandidates(run({ results: [long, short] }).report);
  assert.equal(split.kind, 'split');
  assert.deepEqual(split.cuts.map((c) => c.step), [6, 12]);
});

test('the action prompt names the tests and asks for a reviewed diff, never a silent delete', () => {
  const steps = [st('agent.act', 'a'), st('agent.act', 'b')];
  const groups = findDuplicates(run({ results: [withSteps(result({ testId: 't1', title: 'one', idSeed: 1 }), steps), withSteps(result({ testId: 't2', title: 'two', idSeed: 2 }), steps)] }).report);
  const p = actionPrompt(groups[0]);
  assert.match(p, /gộp/);
  assert.match(p, /trình bày diff để tôi duyệt/);
  assert.match(p, /one/);
  assert.equal(stepSignature(withSteps(result({ testId: 'x', idSeed: 9 }), steps)), 'agent.act:a|agent.act:b');
});
