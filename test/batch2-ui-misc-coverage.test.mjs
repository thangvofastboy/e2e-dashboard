import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverageBodyHtml } from '../ui/views/coverage.js';
import { machineHtml, projectSourcesHtml } from '../ui/views/system.js';

const c = {
  total: 3, covered: 1, share: 1 / 3, untested: ['/a', '/b'], source: '../app', sourceFiles: 5,
  rows: [{ route: '/a', source: 'app/', tested: false }, { route: '/b', source: 'app/', tested: false }, { route: '/c', source: 'app/', tested: true, tests: 1, visits: 2, failures: 0 }],
  domains: [{ host: 'api.<x>.com', count: 2, sample: 'src/a.ts' }],
  extraTested: ['/ghost'],
  ignored: { routes: ['/admin'], domains: ['cdn.example.com'] },
};

test('mặc định tab Route: tablist, aria-selected, số lượng trên tab', () => {
  const html = coverageBodyHtml(c);
  assert.match(html, /role="tablist"/);
  assert.match(html, /data-cov-tab="route"[^>]*aria-selected="true"[^>]*>Route <span class="cnt">3<\/span>/);
  assert.match(html, /data-cov-tab="domain"[^>]*aria-selected="false"[^>]*>Domain trong source <span class="cnt">1<\/span>/);
  assert.match(html, /id="cov-pane-route" role="tabpanel"[^>]*>/);
  assert.match(html, /id="cov-pane-domain" role="tabpanel"[^>]*hidden/);
});

test('tab Route chứa KPI, bảng route, route thừa và route bỏ qua; tab Domain chứa domain', () => {
  const html = coverageBodyHtml(c, 'domain');
  const [route, domain] = html.split('id="cov-pane-domain"');
  assert.match(route, /class="kpis"/);
  assert.match(route, /\/ghost/);
  assert.match(route, /\/admin/);
  assert.doesNotMatch(route, /cdn\.example\.com/);
  assert.match(domain, /api\.&lt;x&gt;\.com/);
  assert.match(domain, /cdn\.example\.com/);
  assert.doesNotMatch(domain, /class="kpis"/);
  assert.match(html, /id="cov-pane-route" role="tabpanel"[^>]*hidden/);
});

test('tab lạ quay về Route', () => {
  assert.match(coverageBodyHtml(c, 'xyz'), /data-cov-tab="route"[^>]*aria-selected="true"/);
});

test('bảng máy: escape mọi giá trị, thiếu /api/resources thì ghi không đo được', () => {
  const sys = { hostname: '<h>', platform: 'linux 6.1', arch: 'x64', node: 'v22.1.0' };
  const res = { machine: { cores: 8, cpuModel: 'Intel <i7>', memTotalMb: 16384, diskTotalGb: 500, diskFreeGb: 120.5 } };
  const html = machineHtml(sys, res, { chromium: true, firefox: false, webkit: null });
  assert.match(html, /&lt;h&gt;/);
  assert.match(html, /Intel &lt;i7&gt; × 8/);
  assert.match(html, /16 GB/);
  assert.match(html, /120\.5 GB trống \/ 500 GB/);
  assert.match(html, /chromium/);
  assert.doesNotMatch(html, /firefox/);
  const none = machineHtml({ platform: 'linux', node: 'v22' }, null, null);
  assert.match(none, /không đo được/);
  assert.match(none, /<td>Hostname<\/td><td>—<\/td>/);
});

test('form Dự án: escape đường dẫn, mô tả và prompt; giới hạn hiện ra', () => {
  const html = projectSourcesHtml({ sources: [{ path: '../be"<x>', description: 'API </textarea><b>' }], prompt: 'rule <i>' });
  assert.match(html, /value="\.\.\/be&quot;&lt;x&gt;"/);
  assert.match(html, /API &lt;\/textarea&gt;&lt;b&gt;/);
  assert.match(html, /rule &lt;i&gt;/);
  assert.match(html, /maxlength="8000"/);
  assert.match(html, /maxlength="500"/);
  assert.match(html, /data-src-add/);
});
