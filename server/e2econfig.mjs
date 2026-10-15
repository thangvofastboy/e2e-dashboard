// Cấu hình e2e.config.ts: đọc các giá trị chính (engine, URL app, lệnh khởi động app, model, reporter, trình duyệt),
// sửa URL app và lệnh dev server, và dựng lệnh `e2e init` để tạo config cho project chưa có.
// Chỉ sửa bằng thay thế văn bản ở những dạng nhận ra được (dạng `e2e init` sinh ra); dạng lạ thì báo để sửa tay.
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { basename } from 'node:path';
import { findConfig } from '../bin/project.mjs';
import { jsPm } from './quicksetup.mjs';

export const GATEWAYS = ['vercel', 'openrouter', 'openai-compatible', 'chatgpt', 'copilot', 'opencode-console', 'grok', 'none'];
export const ENGINES = ['web', 'mobile', 'none'];

const MODEL_IMPORTS = [
  [/from\s+['"]ai['"]/, 'Vercel AI Gateway'],
  [/openrouter/i, 'OpenRouter'],
  [/openai-compatible|createOpenAICompatible/, 'OpenAI-compatible'],
  [/chatgpt|codex/i, 'ChatGPT'],
  [/copilot/i, 'GitHub Copilot'],
  [/opencode/i, 'OpenCode Console'],
  [/grok|spacexai|xai/i, 'Grok'],
  [/@ai-sdk\/anthropic/, 'Anthropic'],
  [/@ai-sdk\/openai/, 'OpenAI'],
  [/@ai-sdk\/google/, 'Google'],
];

const str = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
// `url: process.env.APP_URL ?? '…'` (dạng e2e init) hoặc `url: '…'`
const URL_ENV = /(url\s*:\s*process\.env\.(\w+)\s*\?\?\s*)(['"`])([^'"`]*)\3/;
const URL_LIT = /(\burl\s*:\s*)(['"`])([^'"`]*)\2/;
// lệnh một dòng: `command: { executable: 'npm', args: ['run', 'dev'] },` có thể đang bị comment
const CMD_LINE = /^([ \t]*)(\/\/\s*)?command\s*:\s*\{[^\n]*\}\s*,?[ \t]*$/m;
const CMD_HINT = /^[ \t]*\/\/\s*Or let the runner start the dev server:[ \t]*\n/m;

export function readE2eConfig(source) {
  const engine = /from\s+['"]@e2e-dev\/mobile['"]/.test(source) ? 'mobile' : /from\s+['"]@e2e-dev\/web['"]/.test(source) ? 'web' : null;
  const env = URL_ENV.exec(source);
  const lit = env ? null : URL_LIT.exec(source);
  const cmd = CMD_LINE.exec(source);
  let command = null;
  if (cmd && !cmd[2]) {
    const exe = /executable\s*:\s*(['"`])([^'"`]*)\1/.exec(cmd[0]);
    const args = /args\s*:\s*\[([^\]]*)\]/.exec(cmd[0]);
    const list = args ? [...args[1].matchAll(/(['"`])([^'"`]*)\1/g)].map((m) => m[2]) : [];
    command = exe ? [exe[2], ...list].join(' ') : cmd[0].trim();
  }
  const model = /\bagents\s*:/.test(source) ? (MODEL_IMPORTS.find(([re]) => re.test(source))?.[1] ?? 'Có (không rõ nhà cung cấp)') : null;
  return {
    engine,
    appUrl: env ? env[4] : lit ? lit[3] : null,
    appUrlEnv: env ? env[2] : null,
    command,
    model,
    reporter: source.includes('e2e-dashboard.reporter'),
    browserEnv: /process\.env\.E2E_BROWSER/.test(source),
    targets: (source.match(/\bengine\s*:/g) ?? []).length,
  };
}

export function validAppUrl(u) {
  try {
    const x = new URL(u);
    return (x.protocol === 'http:' || x.protocol === 'https:') && !x.username && !x.password;
  } catch {
    return false;
  }
}

// "npm run dev" → { executable: 'npm', args: ['run', 'dev'] }. Không hỗ trợ dấu nháy / biến shell: tách theo khoảng trắng
export function parseCommand(cmd) {
  const s = String(cmd ?? '').trim();
  if (!s) return null;
  if (/["'`$;|&<>\\]/.test(s)) throw new Error('Lệnh khởi động chỉ gồm chương trình và tham số cách nhau bằng khoảng trắng (không nháy, không ; | & $)');
  const [executable, ...args] = s.split(/\s+/);
  return { executable, args };
}

// sửa URL app / lệnh khởi động. command: chuỗi rỗng = bỏ (comment lại), undefined = giữ nguyên
export function patchE2eConfig(source, { appUrl, command } = {}) {
  let out = source;
  const changed = [];
  const problems = [];
  if (appUrl !== undefined && appUrl !== null && appUrl !== '') {
    if (!validAppUrl(appUrl)) problems.push(`URL không hợp lệ: ${appUrl} (cần http:// hoặc https://)`);
    else if (URL_ENV.test(out)) {
      if (URL_ENV.exec(out)[4] !== appUrl) {
        out = out.replace(URL_ENV, (_m, head) => `${head}${str(appUrl)}`);
        changed.push('URL app');
      }
    } else if (URL_LIT.test(out)) {
      if (URL_LIT.exec(out)[3] !== appUrl) {
        out = out.replace(URL_LIT, (_m, head) => `${head}${str(appUrl)}`);
        changed.push('URL app');
      }
    } else problems.push('Không thấy `url:` trong app của target: thêm tay app: { url: … }');
  }
  let parsed;
  try {
    parsed = command === undefined || command === null ? undefined : parseCommand(command);
  } catch (e) {
    problems.push(e.message);
    command = undefined;
  }
  if (command !== undefined && command !== null) {
    const m = CMD_LINE.exec(out);
    if (!parsed) {
      if (m && !m[2]) {
        out = out.replace(CMD_LINE, (line, indent) => `${indent}// ${line.slice(indent.length)}`);
        changed.push('bỏ lệnh khởi động');
      }
    } else {
      const line = `command: { executable: ${str(parsed.executable)}, args: [${parsed.args.map(str).join(', ')}] },`;
      if (m) {
        const next = `${m[1]}${line}`;
        if (m[0] !== next) {
          out = out.replace(CMD_LINE, next).replace(CMD_HINT, '');
          changed.push('lệnh khởi động');
        }
      } else {
        // chèn ngay sau dòng url của app
        const urlLine = /^([ \t]*)url\s*:[^\n]*\n/m.exec(out);
        if (urlLine) {
          out = out.replace(urlLine[0], `${urlLine[0]}${urlLine[1]}${line}\n`);
          changed.push('lệnh khởi động');
        } else problems.push('Không thấy `url:` để chèn lệnh khởi động: thêm tay command: { executable, args } vào app');
      }
    }
  }
  return { source: out, changed, problems };
}

// lệnh `e2e init` không hỏi gì: config web, skill + MCP cho Claude Code, chưa cài thư viện (Quick Setup cài sau)
export function e2eInitArgv(root, { engine = 'web', gateway = 'vercel', os = process.platform } = {}) {
  if (!ENGINES.includes(engine)) throw new Error(`engine phải là một trong: ${ENGINES.join(', ')}`);
  if (!GATEWAYS.includes(gateway)) throw new Error(`gateway phải là một trong: ${GATEWAYS.join(', ')}`);
  const flags = ['init', '--yes', '--engine', engine, '--gateway', gateway, '--skills', '.claude/skills', '--mcp', '.mcp.json', '--no-install'];
  const js = jsPm(root, os);
  const ext = os === 'win32' ? '.cmd' : '';
  if (js.name === 'pnpm') return [`pnpm${ext}`, 'dlx', 'e2e', ...flags];
  if (js.name === 'bun') return ['bunx', 'e2e', ...flags];
  return [`npx${ext}`, '--yes', 'e2e', ...flags];
}

export async function e2eConfigStatus(root) {
  const path = findConfig(root);
  if (!path) return { exists: false, path: null };
  const source = await readFile(path, 'utf8');
  return { exists: true, path, file: basename(path), ...readE2eConfig(source) };
}

export async function updateE2eConfig(root, changes) {
  const path = findConfig(root);
  if (!path) throw Object.assign(new Error('Project chưa có e2e.config.*'), { status: 404 });
  if ((await lstat(path)).isSymbolicLink()) throw new Error(`Từ chối ghi qua symlink: ${path}`);
  const r = patchE2eConfig(await readFile(path, 'utf8'), changes);
  if (r.changed.length) await writeFile(path, r.source);
  return { changed: r.changed, problems: r.problems, ...(await e2eConfigStatus(root)) };
}
