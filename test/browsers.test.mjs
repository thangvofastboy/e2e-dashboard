import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { patchBrowser, configReadsBrowser, installedBrowsers, browsersDir } from '../server/browsers.mjs';
import { createRunner } from '../server/runner.mjs';
import { createLive } from '../server/live.mjs';

test('setup adds browser: process.env.E2E_BROWSER to web({…}) once, keeps the rest', () => {
  const src = "import { web } from '@e2e-dev/web';\nexport default { targets: [{ engine: web({ viewport: { width: 1600, height: 900 } }) }] };\n";
  const r = patchBrowser(src);
  assert.equal(r.patched, true);
  assert.match(r.source, /web\(\{ browser: process\.env\.E2E_BROWSER \?\? 'chromium', viewport: \{ width: 1600/);
  assert.equal(patchBrowser(r.source).reason, 'already');
  assert.match(patchBrowser('engine: web()').source, /web\(\{ browser: process\.env\.E2E_BROWSER \?\? 'chromium' \}\)/);
  assert.equal(patchBrowser('export default makeConfig();').reason, 'unknown-shape');
  assert.equal(configReadsBrowser(r.source), true);
});

test('installed browsers come from the Playwright cache dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pw-'));
  for (const n of ['chromium-1243', 'chromium_headless_shell-1243', 'firefox-1490', 'ffmpeg-1011']) mkdirSync(join(dir, n));
  assert.deepEqual(installedBrowsers({ PLAYWRIGHT_BROWSERS_PATH: dir }), { chromium: true, firefox: true, webkit: false });
  assert.deepEqual(installedBrowsers({ PLAYWRIGHT_BROWSERS_PATH: '0' }), { chromium: null, firefox: null, webkit: null });
  assert.match(browsersDir({}, 'darwin'), /Library\/Caches\/ms-playwright$/);
});

test('runner passes the chosen browser as E2E_BROWSER (and nothing for an unknown one)', () => {
  const envs = [];
  const spawnImpl = (cmd, args, opts) => {
    envs.push(opts.env);
    const c = new EventEmitter();
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    c.pid = 1;
    return c;
  };
  const mk = () => createRunner({ projectRoot: '/p', live: createLive(), spawnImpl, resolveBin: () => '/p/node_modules/e2e/bin.js' });
  mk().start({ browser: 'firefox' });
  mk().start({ browser: 'edge; rm' });
  assert.equal(envs[0].E2E_BROWSER, 'firefox');
  assert.equal(envs[1].E2E_BROWSER, process.env.E2E_BROWSER);
});
