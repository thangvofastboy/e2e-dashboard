import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, result, err } from './_history.mjs';
import { DEFAULTS, readTemplates, saveTemplate, findTemplate, fill, resultVars, runVars, renderPrompt, keepFingerprint, PLACEHOLDERS } from '../server/qc-templates.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'e2ed-tpl-'));

test('fill replaces known names, keeps and reports unknown ones, never reads prototype properties', () => {
  const r = fill('A {{title}} B {{ nope }} C {{constructor}} {{toString}}', { title: 'T' });
  assert.equal(r.text, 'A T B {{ nope }} C {{constructor}} {{toString}}');
  assert.deepEqual(r.missing.sort(), ['constructor', 'nope', 'toString']);
});

test('templates: defaults until saved, then save / edit / delete / reset, with validation', async () => {
  const root = tmp();
  assert.deepEqual((await readTemplates(root)).map((t) => t.id), DEFAULTS.map((t) => t.id));
  await assert.rejects(saveTemplate(root, { name: '', body: 'x'.repeat(20) }), /tên/);
  await assert.rejects(saveTemplate(root, { name: 'N', body: 'ngắn' }), /10 ký tự/);
  const { item } = await saveTemplate(root, { name: 'Mẫu của tôi', kind: 'weird', body: 'Viết bug {{title}} cho {{target}}' });
  assert.equal(item.kind, 'custom', 'an unknown kind becomes custom');
  const edited = (await saveTemplate(root, { id: item.id, name: 'Đổi tên', kind: 'bug', body: 'Viết bug {{title}}' })).item;
  assert.deepEqual([edited.id, edited.name, edited.kind], [item.id, 'Đổi tên', 'bug']);
  assert.equal((await readTemplates(root)).length, DEFAULTS.length + 1);
  assert.equal((await saveTemplate(root, { delete: item.id })).templates.length, DEFAULTS.length);
  await saveTemplate(root, { delete: 'bug-short' });
  assert.equal((await saveTemplate(root, { reset: true })).templates.length, DEFAULTS.length);
});

test('every placeholder used by a default template is a documented one', () => {
  for (const t of DEFAULTS) for (const m of t.body.matchAll(/\{\{(\w+)\}\}/g)) assert.ok(Object.hasOwn(PLACEHOLDERS, m[1]), `${t.id}: ${m[1]}`);
});

test('a result fills the bug templates; a run fills the report template; evidence is attached when not used', () => {
  const r = result({ testId: 'pay', title: 'thanh toán', idSeed: 5, status: 'failed', error: err('ASSERTION_FAILED', 'expected 3') });
  const h = run({ results: [r, result({ testId: 'ok', idSeed: 6 })], startedAt: '2026-10-13T00:00:00Z' });
  const vars = resultVars({ meta: h.meta, report: h.report }, r.id, 'ghi chú', 'ENG-1');
  assert.equal(vars.title, 'thanh toán');
  assert.equal(vars.errorCode, 'ASSERTION_FAILED');
  assert.equal(vars.known, 'ENG-1');
  const short = renderPrompt(findTemplate(DEFAULTS, 'bug-short'), vars);
  assert.match(short.prompt, /Test thanh toán fail ở web/);
  assert.match(short.prompt, /Dữ liệu:/, 'evidence is appended when the template does not use {{evidence}}');
  assert.deepEqual(short.missing, []);
  const linear = renderPrompt(findTemplate(DEFAULTS, 'bug-linear'), vars);
  assert.doesNotMatch(linear.prompt, /Dữ liệu:\n## \[QC\][\s\S]*Dữ liệu:/, 'evidence is not added twice');
  const rep = renderPrompt(findTemplate(DEFAULTS, 'run-report'), runVars({ meta: h.meta, report: h.report }));
  assert.match(rep.prompt, /passed 1, failed 1/);
  assert.match(rep.prompt, /- thanh toán \[web\]: ASSERTION_FAILED/);
  assert.equal(resultVars({ meta: h.meta, report: h.report }, 'f'.repeat(64)), null);
});

test('keepFingerprint appends the line only when the AI text dropped it', () => {
  const line = '_Tạo từ e2e-dashboard · fingerprint: `e2ed-abc` (giữ dòng này)_';
  assert.equal(keepFingerprint('nội dung', line), `nội dung\n\n${line}`);
  assert.equal(keepFingerprint(`nội dung\n${line}`, line), `nội dung\n${line}`);
  assert.equal(keepFingerprint('x', ''), 'x');
});
