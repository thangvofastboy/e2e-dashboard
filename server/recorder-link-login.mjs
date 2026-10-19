// Chạy như tiến trình con (do recorder-session spawn): mở link đăng nhập một lần bằng chromium headless, rồi lưu storageState.
//   node recorder-link-login.mjs <input.json> <out.json> <projectRoot>
// input.json = { link, cookies } do server ghi (0600) — cookie và link là bí mật nên không đi qua argv.
// playwright-core lấy từ node_modules của project (cùng bản với codegen), không phải của dashboard.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [inputFile, outFile, projectRoot] = process.argv.slice(2);
const { link, cookies } = JSON.parse(readFileSync(inputFile, 'utf8'));
const { chromium } = createRequire(join(projectRoot, 'package.json'))('playwright-core');

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  if (cookies?.length) await context.addCookies(cookies);
  const page = await context.newPage();
  await page.goto(link, { waitUntil: 'load', timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {}); // trang còn gọi API nền cũng không sao
  await context.storageState({ path: outFile });
} finally {
  await browser.close();
}
