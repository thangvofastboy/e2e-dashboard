import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { junitToReport, parseXml } from '../server/junit.mjs';
import { importReport } from '../server/share.mjs';
import { loadHistory } from '../server/store.mjs';
import { groupErrors } from '../server/analytics.mjs';

// what the e2e `junit` reporter writes: a suite per file, a case per test-target pair, a `run` suite for run-level errors
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="5" failures="1" errors="1" skipped="1" time="4.5">
<testsuite name="tests/checkout.e2e.ts" tests="4" failures="1" errors="1" skipped="1" time="4.5" timestamp="2026-10-12T10:00:00.000Z">
  <testcase name="checkout &gt; pays [web]" classname="tests/checkout.e2e.ts" time="1.200"/>
  <testcase name="checkout &gt; refund [web] [buyer]" classname="tests/checkout.e2e.ts" time="2.000">
    <failure message="expected &quot;3&quot; got &quot;2&quot;" type="ASSERTION_FAILED">ASSERTION_FAILED (step): expected "3" got "2"</failure>
  </testcase>
  <testcase name="checkout &gt; coupon [ios]" classname="tests/checkout.e2e.ts" time="0.500">
    <error message="provider 503" type="MODEL_PROVIDER_FAILED"><![CDATA[MODEL_PROVIDER_FAILED: provider 503 <retry>]]></error>
  </testcase>
  <testcase name="checkout &gt; flaky one [web]" classname="tests/checkout.e2e.ts" time="0.800"><system-out>flaky: 1 failed attempt before passing</system-out></testcase>
  <testcase name="checkout &gt; later [web]" classname="tests/checkout.e2e.ts" time="0.000"><skipped message="skipped"/></testcase>
</testsuite>
<testsuite name="run" tests="1" errors="1"><testcase name="APP_UNREACHABLE" classname="run" time="0.000"><error message="no app" type="APP_UNREACHABLE">x</error></testcase></testsuite>
</testsuites>`;

test('parseXml handles attributes, entities, CDATA and self-closing tags', () => {
  const t = parseXml('<a x="1 &amp; 2"><!-- c --><b/><c><![CDATA[<z>]]> &lt;t&gt;</c></a>');
  const a = t.children[0];
  assert.equal(a.attrs.x, '1 & 2');
  assert.deepEqual(a.children.map((c) => c.name), ['b', 'c']);
  assert.equal(a.children[1].text, '<z> <t>');
  assert.throws(() => parseXml('<a>'.repeat(40)), /sâu/);
});

test('junitToReport maps cases, targets, agents, error classes and run errors', () => {
  const r = junitToReport(XML).run;
  assert.equal(r.status, 'failed');
  assert.deepEqual(r.summary, { discovered: 5, selected: 5, executed: 4, passed: 1, failed: 2, interrupted: 0, flaky: 1, skipped: 1 });
  assert.deepEqual(r.results.map((x) => [x.titlePath.join('>'), x.targetId, x.agent, x.status]), [
    ['checkout>pays', 'web', 'default', 'passed'], ['checkout>refund', 'web', 'buyer', 'failed'], ['checkout>coupon', 'ios', 'default', 'failed'], ['checkout>flaky one', 'web', 'default', 'flaky'], ['checkout>later', 'web', 'default', 'skipped'],
  ]);
  assert.deepEqual([r.results[1].attempts[0].error.code, r.results[1].attempts[0].error.category], ['ASSERTION_FAILED', 'test']);
  assert.deepEqual([r.results[2].attempts[0].error.code, r.results[2].attempts[0].error.category], ['MODEL_PROVIDER_FAILED', 'infrastructure']);
  assert.match(r.results[2].attempts[0].error.details.observed, /<retry>/);
  assert.deepEqual(r.errors.map((e) => e.code), ['APP_UNREACHABLE']);
  assert.equal(r.startedAt, '2026-10-12T10:00:00.000Z');
  assert.equal(r.finishedAt, '2026-10-12T10:00:04.500Z');
  assert.deepEqual(r.targets.map((t) => t.id), ['web', 'ios']);
  assert.equal(junitToReport(XML).run.id, r.id); // same file, same run id: importing twice is a no-op
});

test('junitToReport rejects things that are not a JUnit report', () => {
  assert.throws(() => junitToReport('<html/>'), /junit/i);
  assert.throws(() => junitToReport('<testsuites></testsuites>'), /testcase/);
});

test('importReport takes a junit.xml (file or output directory) into history, once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-junit-'));
  const out = join(root, 'ci-out');
  mkdirSync(out);
  writeFileSync(join(out, 'junit.xml'), XML);
  const a = await importReport(root, out);
  assert.equal(a.status, 'archived');
  assert.equal((await importReport(root, join(out, 'junit.xml'))).status, 'exists');
  const [h] = await loadHistory(root, 5);
  assert.equal(h.meta.source, 'ci');
  assert.deepEqual(h.meta.errorClasses, { test: 1, infrastructure: 1 });
  assert.equal(groupErrors([h]).length, 2);
  assert.equal(JSON.parse(readFileSync(join(a.runDir, 'meta.json'), 'utf8')).runErrors, 1);
  writeFileSync(join(out, 'bad.xml'), '<x/>');
  assert.match((await importReport(root, join(out, 'bad.xml'))).reason, /junit/);
});
