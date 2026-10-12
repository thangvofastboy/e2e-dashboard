// Chọn trình duyệt khi chạy test (chromium mặc định, đổi ở Cài đặt). Runner `e2e` không có cờ --browser: trình duyệt
// nằm trong config `web({ browser })`, nên dashboard truyền E2E_BROWSER cho tiến trình chạy và config đọc nó:
//   engine: web({ browser: process.env.E2E_BROWSER ?? 'chromium', … })
// `/e2e-dashboard setup` tự thêm dòng đó (như gắn reporter). Trình duyệt phải cài: npx @e2e-dev/web install firefox webkit
import { readdirSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export const BROWSERS = ['chromium', 'firefox', 'webkit'];
export const validBrowser = (b) => BROWSERS.includes(b);

// Playwright cài trình duyệt vào PLAYWRIGHT_BROWSERS_PATH hoặc thư mục cache mặc định theo hệ điều hành
export function browsersDir(env = process.env, os = platform()) {
  if (env.PLAYWRIGHT_BROWSERS_PATH && env.PLAYWRIGHT_BROWSERS_PATH !== '0') return env.PLAYWRIGHT_BROWSERS_PATH;
  if (env.PLAYWRIGHT_BROWSERS_PATH === '0') return null; // cài trong node_modules: không đoán được
  if (os === 'darwin') return join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (os === 'win32') return join(env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright');
  return join(env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'ms-playwright');
}

// { chromium: true|false|null, … } — null = không biết (không tìm được thư mục cài)
export function installedBrowsers(env = process.env, os = platform()) {
  const dir = browsersDir(env, os);
  let names = null;
  try {
    names = dir ? readdirSync(dir) : null;
  } catch {
    names = [];
  }
  return Object.fromEntries(BROWSERS.map((b) => [b, names ? names.some((n) => new RegExp(`^${b}(_headless_shell)?-\\d+$`).test(n)) : null]));
}

export const configReadsBrowser = (source) => /E2E_BROWSER/.test(source);

// thêm `browser: process.env.E2E_BROWSER ?? 'chromium'` vào web({...}) (hoặc web()) — giữ nguyên mọi thứ khác
export function patchBrowser(source) {
  if (configReadsBrowser(source)) return { source, patched: false, reason: 'already' };
  const LINE = "browser: process.env.E2E_BROWSER ?? 'chromium'";
  if (/\bweb\(\s*\)/.test(source)) return { source: source.replace(/\bweb\(\s*\)/, `web({ ${LINE} })`), patched: true };
  if (/\bweb\(\s*\{/.test(source)) return { source: source.replace(/\bweb\(\s*\{/, (m) => `${m} ${LINE},`), patched: true };
  return { source, patched: false, reason: 'unknown-shape' };
}

export function configSupport(configPath) {
  try {
    return configReadsBrowser(readFileSync(configPath, 'utf8'));
  } catch {
    return false;
  }
}
