#!/usr/bin/env node
// Creates a demo e2e project with 12 archived runs for manual UI checks: node test/seed-demo.mjs [dir]
// Covers the M2 pages too: flaky tests, two branches, grouped errors, routes, replay cache entries,
// and toHaveScreenshot expected/actual images for the visual diff.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { deflateSync } from 'node:zlib';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';

const dir = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'e2e-demo-'));
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'e2e.config.ts'), 'export default {\n  targets: [],\n};\n');
mkdirSync(join(dir, '.github'), { recursive: true });
writeFileSync(join(dir, '.github/CODEOWNERS'), '* @team-web\ntests/ @team-qa @ana\n');
mkdirSync(join(dir, '.e2e-dashboard'), { recursive: true });
writeFileSync(join(dir, '.e2e-dashboard/config.json'), JSON.stringify({ pricing: { inputPerMTok: 3, outputPerMTok: 15 }, budget: { tokensPerRun: 2000 } }, null, 2));
const base = JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));
const VIDEO = base.run.results[0].attempts[0].artifacts[0].path;
const hex = (n, len = 64) => n.toString(16).padStart(len, '0').slice(-len);

// Minimal RGB PNG: a page mock with a header bar and a button whose colour can change.
function png(w, h, paint) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(paint(x, y), y * (w * 3 + 1) + 1 + x * 3);
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const page = (button) => png(320, 200, (x, y) => {
  if (y < 28) return [37, 99, 235];
  if (x > 40 && x < 280 && y > 60 && y < 70) return [148, 163, 184];
  if (x > 40 && x < 200 && y > 84 && y < 92) return [203, 213, 225];
  if (x > 40 && x < 140 && y > 130 && y < 162) return button;
  return [248, 250, 252];
});

// The replay cache entry of the "adds shoes" step, as e2e writes it (.e2e/cache/<entry>.json).
const ENTRY = base.run.results[0].attempts[0].steps[0].cache.entry;
mkdirSync(join(dir, '.e2e/cache'), { recursive: true });
writeFileSync(join(dir, `.e2e/cache/${ENTRY}.json`), JSON.stringify({
  schemaVersion: 'trace-1',
  createdAt: '2026-10-01T09:00:00Z',
  payload: {
    summary: 'closed the promo modal and added the shoes to the cart',
    startPath: '/products/:id',
    actions: [
      { name: 'tap', summary: 'tap button "Close"', target: { role: 'button', name: 'Close' } },
      { name: 'select', summary: 'select size 42', target: { role: 'combobox', name: 'Size' }, value: '42' },
      { name: 'tap', summary: 'tap button "Add to cart"', target: { role: 'button', name: 'Add to cart' } },
    ],
    endAnchors: [{ role: 'status', name: '1 item in cart' }],
  },
}));

const NAV = [['navigated to /', 'navigated to /products/42', 'navigated to /cart'], ['navigated to /', 'navigated to /login', 'navigated to /account/7/orders']];

for (let i = 0; i < 12; i++) {
  const r = structuredClone(base);
  const start = Date.parse('2026-10-01T09:00:00Z') + i * 6 * 3600_000;
  r.run.id = `018f0f5c-7b2a-7abc-8abc-${String(i).padStart(12, '0')}`;
  r.run.startedAt = new Date(start).toISOString();
  r.run.finishedAt = new Date(start + 60_000 + i * 7_000).toISOString();
  const branch = i < 8 ? 'main' : 'feat/checkout';
  r.run.vcs = { commit: (i.toString(16).repeat(40)).slice(0, 40), branch, dirty: i === 11 };
  const out = join(dir, '.e2e');
  // three tests: "opens app" (flips), "checkout" (breaks on the feature branch), "account" (stable)
  const results = [];
  for (const [k, name] of ['opens app', 'checkout', 'account'].entries()) {
    const t = structuredClone(base.run.results[0]);
    t.id = hex(i * 10 + k + 1);
    t.testId = `tests/example.e2e.ts::${encodeURIComponent(name)}`;
    t.titlePath = [name];
    t.source = { ...t.source, line: 3 + k * 12 };
    const a = t.attempts[0];
    a.durationMs = 900 + k * 400 + i * 30;
    const failing = (k === 0 && i % 3 === 2) || (k === 1 && branch !== 'main');
    t.status = failing ? 'failed' : k === 0 && i % 4 === 1 ? 'flaky' : 'passed';
    a.status = failing ? 'failed' : 'passed';
    a.error = failing ? { category: 'test', code: 'ASSERTION_FAILED', message: `expect.toHaveText failed: expected "${k + 2} remaining", got "${k + 1} remaining"`, details: { locator: 'getByRole("status")', expected: `text "${k + 2} remaining"`, observed: `text "${k + 1} remaining"` } } : undefined;
    a.failure = failing ? { url: k === 1 ? 'http://127.0.0.1:3000/cart?step=2' : 'http://127.0.0.1:3000/products/42', screen: `${a.id}:artifact:0` } : undefined;
    const step = a.steps[0];
    step.cache = { ...step.cache, mode: i > 1 ? 'self-finalized' : 'missed', reason: i > 1 ? undefined : 'no-entry', replayedActions: i > 1 ? 3 : 0, totalActions: 3, entry: ENTRY };
    step.events = [
      ...(i > 1 ? [] : step.events.filter((e) => e.kind === 'model').map((e) => ({ ...e, inputTokens: 300 + i * 40 + k * 90, outputTokens: 60 }))),
      ...NAV[k === 2 ? 1 : 0].map((detail) => ({ kind: 'navigation', detail })),
    ];
    step.model = { provider: 'anthropic', model: k === 2 ? 'claude-haiku-4.5' : 'claude-sonnet-4.5', endpoint: 'provider-default', adapterVersion: '1', policyVersion: '1', calls: 1, tokenAccounting: 'provider', peakTokensPerCall: 400, inputTokens: 300 + k * 90, outputTokens: 60, estimatedCostUsd: k === 2 ? 0.0006 : 0.0018 };
    if (k === 2) {
      step.label = 'log in and then open the orders page and check everything works properly';
      step.cache = { ...step.cache, write: 'unconfirmed' };
    }
    a.steps = [step, a.steps[1] && { ...a.steps[1], status: failing ? 'failed' : 'passed', error: failing ? a.error : undefined }].filter(Boolean);
    a.artifacts = [];
    if (failing) {
      const shots = k === 1
        ? [['checkout-expected.png', [37, 99, 235]], ['checkout-actual.png', [220, 38, 38]], ['checkout-diff.png', [230, 30, 50]]]
        : [['fail.png', [234, 88, 12]]];
      for (const [name2, colour] of shots) {
        const rel = `web/${t.id.slice(-16)}/attempt-0/screenshots/${name2}`;
        mkdirSync(dirname(join(out, 'results', rel)), { recursive: true });
        writeFileSync(join(out, 'results', rel), page(colour));
        a.artifacts.push({ id: `${a.id}:artifact:${a.artifacts.length}`, kind: 'screenshot', mediaType: 'image/png', path: rel });
      }
      a.artifacts.push({ ...base.run.results[0].attempts[0].artifacts[0], path: VIDEO });
    }
    results.push(t);
  }
  r.run.results = results;
  const count = (s) => results.filter((x) => x.status === s).length;
  r.run.summary = { ...r.run.summary, passed: count('passed'), flaky: count('flaky'), failed: count('failed'), skipped: 0 };
  r.run.status = count('failed') ? 'failed' : 'passed';
  mkdirSync(dirname(join(out, 'results', VIDEO)), { recursive: true });
  writeFileSync(join(out, 'results', VIDEO), 'not a real video');
  writeFileSync(join(out, 'report.json'), JSON.stringify(r));
  await archive(dir, { source: i % 2 ? 'reporter' : 'hook' });
}
console.log(dir);
