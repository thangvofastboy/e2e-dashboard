import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flakyTests, compareRuns, normalizeMessage, errorSignature, groupErrors, costStats, estimateCost, slowSteps,
  normalizeRoute, routeMap, branchStats, compareBranches, locatorFor, actionToCode, traceToCode, locatorCandidates, digest,
} from '../server/analytics.mjs';
import { result, run, err } from './_history.mjs';

const newestFirst = (...runs) => runs.reverse();

test('flakyTests scores retries and flips, ignores stable tests', () => {
  const h = newestFirst(
    run({ results: [result({ testId: 'a', status: 'passed' }), result({ testId: 'b', status: 'passed', idSeed: 2 })] }),
    run({ results: [result({ testId: 'a', status: 'failed' }), result({ testId: 'b', status: 'passed', idSeed: 2 })] }),
    run({ results: [result({ testId: 'a', status: 'passed' }), result({ testId: 'b', status: 'flaky', idSeed: 2 })] }),
    run({ results: [result({ testId: 'a', status: 'failed' }), result({ testId: 'b', status: 'passed', idSeed: 2 })] }),
    run({ results: [result({ testId: 'a', status: 'passed' }), result({ testId: 'b', status: 'passed', idSeed: 2 }), result({ testId: 'c', status: 'passed', idSeed: 3 })] }),
  );
  const f = flakyTests(h);
  assert.deepEqual(f.map((t) => t.title), ['a', 'b']);
  const a = f[0];
  assert.equal(a.flips, 4);
  assert.equal(a.sameCommitFlips, 4); // every run on the same commit
  assert.equal(a.fails, 2);
  assert.equal(a.runs, 5);
  assert.equal(a.history[0].runId, h[0].meta.runId, 'history newest first');
  assert.equal(f[1].flaky, 1);
  assert.ok(f.every((t) => t.score > 0 && t.score <= 1));
});

test('flakyTests: same-commit flips weigh more; one break after a commit change is a regression', () => {
  const seq = (statuses, commits) => newestFirst(...statuses.map((status, i) => run({ results: [result({ status })], commit: commits?.[i] ?? 'a'.repeat(40) })));
  const same = flakyTests(seq(['passed', 'failed', 'passed']))[0];
  const moved = flakyTests(seq(['passed', 'failed', 'passed'], ['b', 'c', 'd'].map((c) => c.repeat(40))))[0];
  assert.ok(same.score > moved.score);
  assert.deepEqual(flakyTests(seq(['passed', 'passed', 'failed', 'failed'], ['b', 'b', 'c', 'c'].map((c) => c.repeat(40)))), [], 'broke once with a new commit: not flaky');
  assert.equal(flakyTests(seq(['passed', 'failed'])).length, 1, 'same commit, other verdict: flaky');
});

test('compareRuns classifies every test and orders regressions first', () => {
  const base = run({ results: [result({ testId: 'a' }), result({ testId: 'b', status: 'failed', idSeed: 2 }), result({ testId: 'c', status: 'failed', idSeed: 3 }), result({ testId: 'gone', idSeed: 4 })] });
  const head = run({ results: [result({ testId: 'a', status: 'failed', error: err('X', 'boom'), durationMs: 3000 }), result({ testId: 'b', idSeed: 2 }), result({ testId: 'c', status: 'failed', idSeed: 3 }), result({ testId: 'new', idSeed: 5 })] });
  const c = compareRuns(base, head);
  const by = Object.fromEntries(c.rows.map((r) => [r.title, r.change]));
  assert.deepEqual(by, { a: 'regressed', b: 'fixed', c: 'still-failing', gone: 'removed', new: 'added' });
  assert.equal(c.rows[0].title, 'a');
  assert.equal(c.rows[0].durationDelta, 2000);
  assert.equal(c.rows[0].b.error.code, 'X');
  assert.equal(c.counts.regressed, 1);
  assert.ok(c.deltas.passRate < 0.5 && c.deltas.passRate > -1);
});

test('error signatures ignore numbers, quoted text, ids and URLs', () => {
  assert.equal(normalizeMessage('expected "2 remaining" got "1 remaining" after 3000ms at https://x.test/a?b=1'), 'expected "…" got "…" after Nms at <url>');
  const a = errorSignature(err('ASSERTION_FAILED', 'timeout 5000ms waiting for "Save"', 'getByRole("button", "Save")'));
  const b = errorSignature(err('ASSERTION_FAILED', 'timeout 3000ms waiting for "Pay"', 'getByRole("button", "Pay")'));
  const c = errorSignature(err('LOCATOR_NOT_FOUND', 'timeout 3000ms waiting for "Pay"'));
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, c.id);
  assert.equal(errorSignature(null), null);
});

test('groupErrors gathers tests that fail the same way across runs', () => {
  const h = newestFirst(
    run({ results: [result({ testId: 'a', status: 'failed', error: err('E', 'cart has 1 item') }), result({ testId: 'b', status: 'failed', idSeed: 2, error: err('E', 'cart has 3 item') })] }),
    run({ results: [result({ testId: 'a', status: 'failed', error: err('E', 'cart has 2 item') }), result({ testId: 'c', status: 'failed', idSeed: 3, error: err('OTHER', 'nope') }), result({ testId: 'd', idSeed: 4 })] }),
  );
  const g = groupErrors(h);
  assert.equal(g.length, 2);
  assert.equal(g[0].code, 'E');
  assert.equal(g[0].count, 3);
  assert.equal(g[0].tests.length, 2);
  assert.equal(g[0].runs, 2);
  assert.equal(g[0].latest.runId, h[0].meta.runId);
});

test('costStats: tokens, cache outcomes, miss reasons, estimated cost and budget', () => {
  const h = newestFirst(
    run({ results: [result({ testId: 'a', tokens: 1000, cache: 'missed' }), result({ testId: 'b', idSeed: 2, tokens: 10, cache: 'self-finalized' })] }),
    run({ results: [result({ testId: 'a', tokens: 3000, cache: 'agent-concluded' }), result({ testId: 'b', idSeed: 2, tokens: 10, cache: null })] }),
  );
  const c = costStats(h, { pricing: { inputPerMTok: 3, outputPerMTok: 15 }, budget: { tokensPerRun: 1000 } });
  assert.deepEqual(c.cache, { replayed: 1, handedOff: 1, missed: 1, off: 1 });
  assert.deepEqual(c.missReasons, [{ reason: 'no-entry', count: 1 }]);
  assert.equal(c.tests[0].title, 'a');
  assert.equal(c.runs[0].total, 3612);
  assert.ok(c.runs[0].estimated);
  assert.ok(Math.abs(c.runs[0].costUsd - estimateCost({ input: 3010, output: 602 }, { inputPerMTok: 3, outputPerMTok: 15 })) < 1e-9);
  assert.equal(c.budget.over[0].key, 'tokensPerRun');
  assert.equal(estimateCost({ input: 1, output: 1 }, null), null);
  assert.equal(c.roles[0].role, 'executor');
});

test('slowSteps averages each step across runs', () => {
  const h = [run({ results: [result({})] }), run({ results: [result({})] })];
  const s = slowSteps(h);
  assert.equal(s[0].samples, 2);
  assert.equal(s[0].api, 'agent.act');
});

test('normalizeRoute folds ids and drops origin, query and fragment', () => {
  assert.equal(normalizeRoute('navigated to /orders/42?tab=x'), '/orders/:id');
  assert.equal(normalizeRoute('https://app.test/u/018f0f5c-7b2a-7abc-8abc-0123456789ab/edit#top'), '/u/:id/edit');
  assert.equal(normalizeRoute('/cart/'), '/cart');
  assert.equal(normalizeRoute('/'), '/');
  assert.equal(normalizeRoute('javascript:alert(1)'), null);
  assert.equal(normalizeRoute(''), null);
});

test('routeMap counts visits, transitions and where tests fail', () => {
  const h = [run({ results: [result({ testId: 'a', nav: ['/', '/cart', '/checkout'] }), result({ testId: 'b', idSeed: 2, status: 'failed', nav: ['/', '/cart'], failUrl: 'http://x.test/cart?x=1' })] })];
  const m = routeMap(h);
  const cart = m.nodes.find((n) => n.route === '/cart');
  assert.equal(cart.visits, 2);
  assert.equal(cart.failures, 1);
  assert.equal(cart.tests, 2);
  assert.deepEqual(m.edges.find((e) => e.from === '/' && e.to === '/cart'), { from: '/', to: '/cart', count: 2 });
  assert.equal(m.nodes.find((n) => n.route === '/').entries, 2);
});

test('branchStats and compareBranches find what one branch breaks', () => {
  const h = newestFirst(
    run({ branch: 'main', results: [result({ testId: 'a' }), result({ testId: 'b', idSeed: 2 })] }),
    run({ branch: 'feat', results: [result({ testId: 'a' }), result({ testId: 'b', idSeed: 2, status: 'failed' })] }),
    run({ branch: 'feat', results: [result({ testId: 'a' }), result({ testId: 'b', idSeed: 2, status: 'failed' })] }),
  );
  const b = branchStats(h.map((x) => x.meta));
  assert.deepEqual(b.map((x) => x.branch), ['feat', 'main']);
  assert.equal(b[0].runs, 2);
  assert.equal(b[0].passRate, 0.5);
  const c = compareBranches(h, 'main', 'feat');
  assert.equal(c.rows[0].title, 'b');
  assert.equal(c.rows[0].delta, -1);
  assert.equal(c.latest.counts.regressed, 1);
});

test('locatorFor and actionToCode write e2e locator code, escaping values', () => {
  assert.equal(locatorFor({ role: 'button', name: "Don't" }), "screen.getByRole('button', 'Don\\'t')");
  assert.equal(locatorFor({ testId: 'cart' }), "screen.getByTestId('cart')");
  assert.equal(locatorFor({ placeholder: 'Search' }), "screen.getByPlaceholder('Search')");
  assert.equal(locatorFor({ role: 'listitem', name: 'Row', position: { index: 2, of: 3 } }), "screen.getByRole('listitem', 'Row').nth(2)");
  assert.equal(locatorFor({ selector: '#x' }), null);
  assert.equal(actionToCode({ name: 'tap', target: { role: 'button', name: 'Add' } }).code, "await screen.getByRole('button', 'Add').tap();");
  assert.equal(actionToCode({ name: 'type', target: { role: 'textbox', name: 'Email' }, value: 'a\nb' }).code, "await screen.getByRole('textbox', 'Email').fill('a\\nb');");
  assert.equal(actionToCode({ name: 'check', target: { testId: 'x' }, checked: false }).code, "await screen.getByTestId('x').uncheck();");
  assert.equal(actionToCode({ name: 'navigate', url: '/cart' }).code, "await app.open('/cart');");
  assert.ok(actionToCode({ name: 'tool', summary: 'x' }).todo);
  assert.ok(actionToCode({ name: 'tap', target: { selector: 'x' } }).todo);
});

test('traceToCode turns a trace-1 entry into code with a closing assertion', () => {
  const entry = { schemaVersion: 'trace-1', payload: { summary: 'adds shoes', actions: [{ name: 'tap', target: { role: 'button', name: 'Add' } }, { name: 'tool', summary: 'read code' }], endAnchors: [{ role: 'status', name: '1 item' }] } };
  const t = traceToCode(entry);
  assert.equal(t.actions, 2);
  assert.equal(t.todos, 1);
  assert.match(t.code, /tap\(\);\n\/\/ TODO: .*\nawait expect\(screen\.getByRole\('status', '1 item'\)\)\.toBeVisible\(\);/);
  assert.equal(traceToCode({ schemaVersion: 'trace-2', payload: { actions: [{}] } }), null);
  assert.equal(traceToCode(null), null);
});

test('locatorCandidates keeps agent.act steps that replay run after run', () => {
  const entry = 'e'.repeat(64);
  const h = [0, 1, 2, 3].map(() => run({ results: [result({ testId: 'stable', entry }), result({ testId: 'live', idSeed: 2, cache: 'missed' })] }));
  const c = locatorCandidates(h);
  assert.equal(c.length, 1);
  assert.equal(c[0].title, 'stable');
  assert.equal(c[0].stability, 1);
  assert.equal(c[0].entry, entry);
  assert.equal(c[0].stepIndex, 0);
});

test('digest summarizes the week against the one before, as escaped Markdown', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const at = (d) => new Date(now - d * 86_400_000).toISOString();
  const h = newestFirst(
    run({ startedAt: at(10), results: [result({ testId: 'a' })] }),
    run({ startedAt: at(2), results: [result({ testId: 'a', title: 'a <b>', status: 'failed', error: err('E', 'broke *badly*') })] }),
  );
  const d = digest(h, { now, project: 'shop', health: { score: 70 } });
  assert.equal(d.runs, 1);
  assert.equal(d.previousRuns, 1);
  assert.match(d.markdown, /^# Digest e2e · shop: 2026-10-03 → 2026-10-10/);
  assert.match(d.markdown, /Health score:\*\* 70\/100/);
  assert.match(d.markdown, /## Test mới fail\n- a \\<b\\>/);
  assert.match(d.markdown, /broke \\\*badly\\\*/);
  assert.match(d.markdown, /-100 điểm so với tuần trước/);
});
