import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlight, detectLang, highlightLog } from '../ui/highlight.js';

const strip = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

test('highlight never lets markup through, in any language', () => {
  const evil = '<img src=x onerror=alert(1)>"</span><script>';
  for (const lang of ['json', 'js', 'shell', 'path', 'text']) {
    const html = highlight(evil, lang);
    assert.doesNotMatch(html, /<img|<script|<\/span><script/);
    assert.equal(strip(html), evil, lang);
  }
  assert.doesNotMatch(highlightLog(`[error] ${evil}`), /<img|<script/);
});

test('JSON is pretty-printed and its parts are coloured', () => {
  const html = highlight('{"retention":{"keep":50,"ok":true,"name":"x"}}', 'json', { pretty: true });
  assert.match(strip(html), /\{\n {2}"retention": \{\n {4}"keep": 50/);
  assert.match(html, /<span class="hl-key">&quot;keep&quot;<\/span>/);
  assert.match(html, /<span class="hl-num">50<\/span>/);
  assert.match(html, /<span class="hl-kw">true<\/span>/);
  assert.match(html, /<span class="hl-str">&quot;x&quot;<\/span>/);
});

test('language detection: json, shell, js, file:line, plain', () => {
  assert.equal(detectLang('{ "a": 1 }'), 'json');
  assert.equal(detectLang('"retention": { "keep": 50 }'), 'json');
  assert.equal(detectLang('npx e2e run tests/a.e2e.ts:3 --retries 0'), 'shell');
  assert.equal(detectLang('await screen.getByRole("button").tap()'), 'js');
  assert.equal(detectLang('tests/example.e2e.ts:3'), 'path');
  assert.equal(detectLang('main'), 'text');
});

test('shell flags, js calls and log levels get their classes', () => {
  assert.match(highlight('git bisect run npx e2e run a.ts --retries 0', 'shell'), /<span class="hl-flag">--retries<\/span>/);
  assert.match(highlight('screen.getByRole("status")', 'js'), /<span class="hl-fn">getByRole<\/span>/);
  assert.match(highlightLog('[error] network POST /api/cart 500\n[info] ok'), /<span class="ln hl-err">.*<span class="hl-bad">500<\/span>/);
});

test('long hostile input stays linear (no regex backtracking blow-up)', () => {
  const t = performance.now();
  highlight(`git ${' '.repeat(50000)}x`, 'shell');
  highlight(`;${' '.repeat(50000)}git`, 'shell');
  highlightLog(`[${'x'.repeat(200000)}`);
  assert.ok(performance.now() - t < 300, `took ${performance.now() - t} ms`);
});
