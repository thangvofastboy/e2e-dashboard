#!/usr/bin/env node
// Creates a demo e2e project with 12 archived runs for manual UI checks: node test/seed-demo.mjs [dir]
// Covers the M2 pages too: flaky tests, two branches, grouped errors, routes, replay cache entries,
// and toHaveScreenshot expected/actual images for the visual diff.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { deflateSync } from 'node:zlib';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { applyRun, emptyIndex } from '../server/longterm.mjs';

const dir = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'e2e-demo-'));
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'e2e.config.ts'), 'export default {\n  targets: [],\n};\n');
mkdirSync(join(dir, '.github'), { recursive: true });
writeFileSync(join(dir, '.github/CODEOWNERS'), '* @team-web\ntests/ @team-qa @ana\n');
// A few Next.js-style pages so the Coverage page has app routes to compare with the tested ones.
for (const f of ['app/page.tsx', 'app/cart/page.tsx', 'app/products/[id]/page.tsx', 'app/login/page.tsx', 'app/account/[id]/orders/page.tsx', 'app/settings/page.tsx', 'app/checkout/page.tsx', 'app/layout.tsx']) {
  mkdirSync(dirname(join(dir, f)), { recursive: true });
  writeFileSync(join(dir, f), 'export default function Page() { return null; }\n');
}
mkdirSync(join(dir, '.e2e-dashboard'), { recursive: true });
writeFileSync(join(dir, '.e2e-dashboard/config.json'), JSON.stringify({ pricing: { inputPerMTok: 3, outputPerMTok: 15 }, budget: { tokensPerRun: 2000 }, reports: { weekly: 'mon 09:00', monthly: '1 09:00' }, traceability: { stories: ['LIN-101', { id: 'LIN-102', title: 'Xem đơn hàng' }, { id: 'LIN-103', title: 'Thanh toán bằng ví' }] } }, null, 2));
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
    t.tags = [['@smoke'], ['@LIN-101', '@checkout'], ['@LIN-102']][k];
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
    a.appLog = [
      ...(failing && k === 1 ? [{ source: 'network', level: 'error', text: `POST /api/cart/${100 + i} 500 Internal Server Error`, at: r.run.startedAt, step: 1 }] : []),
      ...(k === 0 ? [{ source: 'console', level: 'warning', text: 'React: each child in a list should have a unique "key" prop', at: r.run.startedAt }] : []),
    ];
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
  // a setup project (login) and a beforeEach hook on the account test
  const setup = structuredClone(base.run.results[0]);
  setup.id = hex(i * 10 + 9);
  setup.kind = 'setup';
  setup.testId = 'tests/auth.setup.ts::log%20in';
  setup.titlePath = ['log in'];
  setup.status = 'passed';
  setup.attempts[0].durationMs = 2500 + i * 40;
  setup.attempts[0].artifacts = [];
  results[2].attempts[0].steps[0] = { ...results[2].attempts[0].steps[0], phase: 'beforeEach' };
  r.run.results = [...results, setup];
  const count = (s) => results.filter((x) => x.status === s).length;
  r.run.summary = { ...r.run.summary, passed: count('passed'), flaky: count('flaky'), failed: count('failed'), skipped: 0 };
  r.run.status = count('failed') ? 'failed' : 'passed';
  mkdirSync(dirname(join(out, 'results', VIDEO)), { recursive: true });
  writeFileSync(join(out, 'results', VIDEO), 'not a real video');
  writeFileSync(join(out, 'report.json'), JSON.stringify(r));
  await archive(dir, { source: i % 2 ? 'reporter' : 'hook' });
}

// one `e2e explore` run with findings
{
  const r = structuredClone(base);
  r.run.id = '018f0f5c-7b2a-7abc-8abc-0000000000ee';
  r.run.startedAt = '2026-10-04T08:00:00.000Z';
  r.run.finishedAt = '2026-10-04T08:03:00.000Z';
  r.run.status = 'failed';
  r.run.results = [];
  r.run.summary = { ...r.run.summary, passed: 0, failed: 0, flaky: 0, skipped: 0 };
  r.run.vcs = { commit: 'e'.repeat(40), branch: 'main', dirty: false };
  r.run.explore = {
    goal: 'Explore the checkout flow like a first-time buyer and report anything off',
    budgets: { maxSteps: 10, timeoutMs: 600000 }, ended: 'finished',
    summary: 'Checkout works end to end, but the cart total ignores quantity changes and the coupon field accepts expired codes.',
    steps: [
      { index: 1, title: 'Browse catalog', instruction: 'open the catalog and pick a product', status: 'passed', startedAt: r.run.startedAt, durationMs: 31000 },
      { index: 2, title: 'Cart quantities', instruction: 'change the quantity in the cart', status: 'failed', startedAt: r.run.startedAt, durationMs: 19000, summary: 'total did not update' },
      { index: 3, title: 'Coupon', instruction: 'apply an expired coupon', status: 'passed', startedAt: r.run.startedAt, durationMs: 12000 },
    ],
    findings: [
      { id: 'f1', index: 0, step: 2, kind: 'issue', severity: 4, title: 'Cart total ignores quantity', expected: 'total = price × quantity', actual: 'total stays at one item', reproduction: ['add shoes to cart', 'set quantity to 3', 'look at the total'], path: '/cart', reportedAt: r.run.startedAt },
      { id: 'f2', index: 1, step: 3, kind: 'warning', severity: 2, title: 'Expired coupon accepted', expected: 'an error message', actual: 'discount applied', reproduction: ['open cart', 'enter SUMMER2025'], path: '/cart', reportedAt: r.run.startedAt },
    ],
  };
  writeFileSync(join(dir, '.e2e', 'report.json'), JSON.stringify(r));
  await archive(dir, { source: 'hook' });
}
// Long-term rollups from the months before (their run folders long pruned by retention), so the
// Trends, calendar, MTTR and lifecycle pages have history to show.
{
  const index = emptyIndex();
  const days = {};
  let n = 0;
  const day0 = Date.parse('2026-05-20T08:00:00Z');
  for (let d = 0; d < 134; d++) {
    const date = new Date(day0 + d * 86_400_000);
    if (date.getUTCDay() === 0 || (date.getUTCDay() === 6 && d % 3)) continue; // quiet weekends
    for (let k = 0; k < (d % 4 === 0 ? 2 : 1); k++) {
      n++;
      const at = new Date(day0 + d * 86_400_000 + k * 5 * 3600_000).toISOString();
      const names = ['opens app', 'checkout', 'account', ...(d < 90 ? ['search'] : []), ...(d > 60 ? ['wishlist'] : [])];
      const results = names.map((name, j) => {
        const failing = (name === 'checkout' && ((d > 30 && d < 34) || (d > 70 && d < 72) || (d > 100 && d < 109))) || (name === 'opens app' && (d * 7 + k) % 11 === 0) || (name === 'search' && d > 80 && d < 86);
        const flaky = !failing && name === 'opens app' && (d * 5 + k) % 9 === 0;
        return { id: hex(900000 + n * 10 + j), testId: `tests/example.e2e.ts::${encodeURIComponent(name)}`, titlePath: [name], targetId: 'web', status: failing ? 'failed' : flaky ? 'flaky' : 'passed', source: { file: 'tests/example.e2e.ts', line: 3 + j * 12 }, attempts: [{ durationMs: 900 + j * 300 + (d % 7) * 40 }] };
      });
      const failed = results.filter((r) => r.status === 'failed').length;
      const meta = { runId: `018f0f5c-0000-7abc-8abc-${String(n).padStart(12, '0')}`, startedAt: at, status: failed ? 'failed' : 'passed', durationMs: 50_000 + (d % 9) * 2_000, tokens: { input: 300, output: 60 }, git: { branch: 'main', commit: 'f'.repeat(40) } };
      applyRun(index, days, { meta, report: { run: { results } } });
    }
  }
  mkdirSync(join(dir, '.e2e-dashboard/longterm'), { recursive: true });
  writeFileSync(join(dir, '.e2e-dashboard/longterm/index.json'), JSON.stringify(index));
  writeFileSync(join(dir, '.e2e-dashboard/longterm/days-2026.json'), JSON.stringify(days));
  writeFileSync(join(dir, '.e2e-dashboard/events.json'), JSON.stringify([
    { id: 'ev-000000000001', kind: 'deploy', label: 'Checkout v2 lên staging', at: '2026-06-21T10:00:00.000Z', url: null },
    { id: 'ev-000000000002', kind: 'incident', label: 'Payment sandbox chập chờn', at: '2026-09-01T07:30:00.000Z', url: null },
    { id: 'ev-000000000003', kind: 'release', label: 'v1.4', at: '2026-09-15T09:00:00.000Z', url: null },
  ]));
}
console.log(dir);
