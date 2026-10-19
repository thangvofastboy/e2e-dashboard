// P2: người dùng viết prompt tự do ("đăng nhập bằng {{E2E_ADMIN_USER}} / {{E2E_ADMIN_PASSWORD}}…"), agent của runner `e2e` làm theo
// trong trình duyệt ẩn, rồi ta lưu cookie / localStorage thành phiên đăng nhập.
// Không để AI sinh mã rồi chạy: dashboard sinh một test tạm theo khuôn cố định, prompt và URL chỉ nằm trong chuỗi JSON,
// agent chỉ làm được những gì bộ công cụ của runner cho phép. Bí mật là handle (`secrets.get`): model chỉ thấy tên.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findConfig } from '../bin/project.mjs';
import { installedBrowsers } from './browsers.mjs';
import { aiStatus as projectAiStatus } from './e2eai.mjs';
import { resolveE2eBin } from './runner.mjs';
import { slugify } from './recorder-spec.mjs';

const fail = (status, message) => Object.assign(new Error(message), { status });
const MAX_PROMPT = 4000;
const MIN_SECRET = 6; // ngưỡng của runner cho một secret
const TIMEOUT_MS = 180_000;
const TAIL = 2000;
const ERR_MAX = 300;

// chỉ biến bắt đầu bằng E2E_: prompt không đọc được biến môi trường tuỳ ý (AWS_*, token của máy…)
export const PLACEHOLDER = /\{\{\s*(E2E_[A-Z0-9_]{1,60})\s*\}\}/g;
export const secretKey = (name) => name.toLowerCase().replace(/_/g, '-');
export const paramKey = (name) => name.toLowerCase();

export function extractPlaceholders(prompt) {
  const out = [];
  for (const m of String(prompt ?? '').matchAll(PLACEHOLDER)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

export function parseDotenv(text) {
  const out = {};
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

// môi trường thắng .env (như dotenv); chỉ trả tên khi thiếu hoặc quá ngắn
export function resolveSecrets(names, { env, dotenv }) {
  const values = {};
  const missing = [];
  const short = [];
  for (const n of names) {
    const v = env[n] ?? dotenv[n];
    if (v === undefined || v === '') missing.push(n);
    else if (v.length < MIN_SECRET) short.push(n);
    else values[n] = v;
  }
  return { values, missing, short };
}

export function buildInstruction(prompt) {
  const body = String(prompt).replace(PLACEHOLDER, (_m, n) => `params.${paramKey(n)}`);
  return `${body}\n\nLưu ý: các giá trị bí mật chỉ có trong params, hãy nhập bằng công cụ type_secret và không đoán giá trị. Khi đã làm xong các việc trên, kết thúc bước ngay.`;
}

// Test tạm: mở trang, để agent làm theo prompt (hoặc `actCode` trong test), rồi ghi cookie + localStorage ra file
export function buildPrepareTest({ path, instruction, names, actCode }) {
  const params = names.length ? `, { params: { ${names.map((n) => `${paramKey(n)}: secrets.get(${JSON.stringify(secretKey(n))})`).join(', ')} } }` : '';
  const act = actCode ?? `await agent.act(${JSON.stringify(instruction)}${params});`;
  return `import { test } from '@e2e-dev/web';
import { secrets } from 'e2e';
import { writeFileSync } from 'node:fs';

test('prepare session', async ({ app, ${actCode ? 'screen' : 'agent'}, browser }) => {
  await app.open(${JSON.stringify(path)});
  ${act}
  const cookies = await browser.cookies();
  const origin = await browser.evaluate(() => location.origin);
  const local = await browser.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
  writeFileSync(String(process.env.E2E_PREPARE_OUT), JSON.stringify({ cookies, origin, local: JSON.parse(local) }));
});
`;
}

// Config bọc config thật của project (giữ engine, khối AI…) nhưng: chỉ reporter `list` (run này không vào lịch sử),
// output riêng, URL là trang người dùng nhập, và thêm các secret lấy từ biến môi trường của tiến trình con.
export function buildPrepareConfig({ projectConfigPath }) {
  return `import base from ${JSON.stringify(projectConfigPath)};

const b: any = base;
const names = (process.env.E2E_PREPARE_NAMES ?? '').split(',').filter(Boolean);
const prepared = Object.fromEntries(names.map((n) => [n.toLowerCase().replace(/_/g, '-'), process.env[n] ?? '']));

export default {
  ...b,
  reporters: ['list'],
  retries: 0,
  tests: ['prepare.e2e.ts'],
  output: process.env.E2E_PREPARE_OUTPUT,
  trace: 'off',
  targets: [{ ...(b.targets?.[0] ?? {}), app: { url: process.env.E2E_PREPARE_URL } }],
  secrets: { ...(b.secrets ?? {}), ...prepared },
};
`;
}

// file ghi từ test tạm → storageState; mặc định an toàn cho thuộc tính thiếu, bỏ mục sai kiểu
export function stateFromRun(raw) {
  const cookies = Array.isArray(raw?.cookies)
    ? raw.cookies
      .filter((c) => c && typeof c.name === 'string' && typeof c.value === 'string' && typeof c.domain === 'string')
      .map((c) => ({
        name: c.name, value: c.value, domain: c.domain, path: typeof c.path === 'string' ? c.path : '/',
        expires: typeof c.expires === 'number' ? c.expires : -1, httpOnly: c.httpOnly === true, secure: c.secure === true,
        sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax',
      }))
    : [];
  const local = raw?.local && typeof raw.local === 'object' && !Array.isArray(raw.local)
    ? Object.entries(raw.local).filter(([, v]) => typeof v === 'string').map(([name, value]) => ({ name, value }))
    : [];
  return { cookies, origins: local.length && typeof raw.origin === 'string' ? [{ origin: raw.origin, localStorage: local }] : [] };
}

export function createPreparer({ projectRoot, spawnImpl = spawn, env = process.env, aiStatus = projectAiStatus, resolveBin = resolveE2eBin, browsers = installedBrowsers, saveAuth, timeoutMs = TIMEOUT_MS }) {
  let busy = false;

  // `_act`: chỉ cho test, thay lệnh agent.act bằng các bước cố định để kiểm chứng đường ống mà không cần AI
  async function run({ name, url, prompt, _act }) {
    const slug = slugify(name);
    if (!slug) throw fail(400, 'Tên phiên không hợp lệ: cần ít nhất một chữ cái hoặc số');
    const text = typeof prompt === 'string' ? prompt.trim() : '';
    if (!text) throw fail(400, 'Cần viết prompt cho AI');
    if (text.length > MAX_PROMPT) throw fail(400, `Prompt tối đa ${MAX_PROMPT} ký tự`);
    if (busy) throw fail(409, 'Đang chạy một lần chuẩn bị khác, đợi xong rồi thử lại');
    busy = true;
    let work = null;
    try {
      if ((await aiStatus(projectRoot)).provider === 'none') throw fail(400, 'Chưa cấu hình AI cho runner e2e: bật ở Cài đặt → AI rồi thử lại');
      const bin = resolveBin(projectRoot);
      if (!bin) throw fail(400, 'Project chưa cài e2e (node_modules/e2e)');
      if (browsers(env).chromium === false) throw fail(400, 'Chưa cài trình duyệt chromium: chạy `npx @e2e-dev/web install chromium`');
      const projectConfigPath = findConfig(projectRoot);
      if (!projectConfigPath) throw fail(400, 'Project chưa có e2e.config.*');
      const names = extractPlaceholders(text);
      let dotenv = {};
      try {
        dotenv = parseDotenv(readFileSync(join(projectRoot, '.env'), 'utf8'));
      } catch {}
      const { values, missing, short } = resolveSecrets(names, { env, dotenv });
      if (missing.length) throw fail(400, `Chưa đặt biến ${missing.join(', ')}: thêm vào .env của project hoặc môi trường`);
      if (short.length) throw fail(400, `Giá trị của ${short.join(', ')} ngắn hơn ${MIN_SECRET} ký tự: runner không chấp nhận`);

      const u = new URL(url);
      const root = join(projectRoot, '.e2e-dashboard', 'prepare');
      mkdirSync(root, { recursive: true });
      work = mkdtempSync(join(root, 'p-'));
      const cfg = join(work, 'e2e.config.ts');
      const out = join(work, 'state.json');
      writeFileSync(cfg, buildPrepareConfig({ projectConfigPath }));
      writeFileSync(join(work, 'prepare.e2e.ts'), buildPrepareTest({ path: `${u.pathname}${u.search}`, instruction: buildInstruction(text), names, actCode: _act }));

      const secretValues = Object.values(values);
      const scrub = (m) => secretValues.reduce((acc, v) => acc.split(v).join('«ẩn»'), String(m)).replace(/\bhttps?:\/\/[^\s"']+/g, '«url»').trim().slice(-ERR_MAX);
      const childEnv = { ...env, ...values, E2E_PREPARE_NAMES: names.join(','), E2E_PREPARE_URL: u.origin, E2E_PREPARE_OUT: out, E2E_PREPARE_OUTPUT: join(work, 'out') };
      await new Promise((resolve, reject) => {
        let tail = '';
        let done = false;
        const finish = (err) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (err) reject(err);
          else resolve();
        };
        let child;
        try {
          child = spawnImpl(process.execPath, [bin, 'run', '--config', cfg], { cwd: projectRoot, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (e) {
          return reject(fail(502, `Không chạy được runner e2e: ${scrub(e.message)}`));
        }
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          finish(fail(502, `Hết thời gian chờ AI (${Math.round(timeoutMs / 60_000)} phút): prompt có quá dài hoặc trang không phản hồi không?`));
        }, timeoutMs);
        const collect = (b) => { tail = (tail + b).slice(-TAIL); };
        child.stdout?.on('data', collect);
        child.stderr?.on('data', collect);
        child.on('error', (e) => finish(fail(502, `Không chạy được runner e2e: ${scrub(e.message)}`)));
        child.on('close', (code) => finish(code === 0 ? null : fail(502, `AI chuẩn bị thất bại (mã ${code}): ${scrub(tail) || 'không có thông báo'}`)));
      });
      let raw = null;
      try {
        raw = JSON.parse(readFileSync(out, 'utf8'));
      } catch {}
      const state = stateFromRun(raw);
      if (!state.cookies.length && !state.origins.length) throw fail(502, 'Không lấy được phiên sau khi AI chạy xong: bạn đã đăng nhập chưa? Thử viết prompt rõ hơn');
      saveAuth(slug, state);
      return { name: slug };
    } finally {
      if (work) rmSync(work, { recursive: true, force: true }); // chứa file ghi cookie
      busy = false;
    }
  }

  return { run };
}
