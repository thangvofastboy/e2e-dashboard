// Trang Cài đặt hệ thống: file env của project (xem / sửa trực tiếp), key của dashboard trong
// ~/.e2e-dashboard/config.json (không nằm trong repo) và tình trạng setup.
import { readFile, writeFile, rename, rm, lstat, copyFile, appendFile, mkdir, chmod } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { homeDir } from './projects.mjs';
import { serial } from './jsonstate.mjs';
import { sqliteSupport, indexEnabled } from './runindex.mjs';
import { AI_EFFORTS, validModel } from './ai.mjs';

// Chỉ ba file này, không nhận đường dẫn tuỳ ý từ trình duyệt
export const ENV_FILES = ['.env', '.env.local', '.env.example'];
const SECRET_FILES = new Set(['.env', '.env.local']); // phải được git bỏ qua
export const MAX_ENV_BYTES = 64 * 1024;

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

async function refuseSymlink(p) {
  const st = await lstat(p).catch(() => null);
  if (st?.isSymbolicLink()) throw bad(`Từ chối ghi qua symlink: ${p}`);
}

// ghi file tạm rồi đổi tên: không bao giờ để lại file ghi dở; file secret mới tạo chỉ chủ sở hữu đọc được
async function atomicWrite(path, content, mode) {
  const tmp = `${path}.tmp-${randomBytes(4).toString('hex')}`;
  try {
    await writeFile(tmp, content, { mode });
    const st = await lstat(path).catch(() => null);
    if (st) await chmod(tmp, st.mode & 0o777); // giữ quyền của file cũ
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

// git status 1 = repo nhưng file chưa bị ignore (0 = đã ignore, 128 = không phải repo / không có git)
export function isIgnored(root, name) {
  // --no-index: file đã bị track vẫn xét theo .gitignore (không thì mỗi lần lưu lại thêm một dòng)
  const s = spawnSync('git', ['check-ignore', '-q', '--no-index', name], { cwd: root, timeout: 3000 }).status;
  return s === 1 ? false : s === 0 ? true : null;
}

// file đã từng commit: thêm vào .gitignore không gỡ được khỏi git, phải git rm --cached
export const isTracked = (root, name) => spawnSync('git', ['ls-files', '--error-unmatch', name], { cwd: root, timeout: 3000, stdio: 'ignore' }).status === 0;

export async function ensureIgnored(root, name) {
  if (isIgnored(root, name) !== false) return false;
  const gi = join(root, '.gitignore');
  await refuseSymlink(gi);
  const cur = existsSync(gi) ? await readFile(gi, 'utf8') : '';
  await appendFile(gi, `${cur && !cur.endsWith('\n') ? '\n' : ''}${name}\n`);
  return true;
}

// .env thiếu là lỗi hay gặp nhất khi chạy test lần đầu: tạo từ .env.example (không ghi đè) và git-ignore nó.
export async function ensureEnvFile(root) {
  const env = join(root, '.env');
  const example = join(root, '.env.example');
  if (existsSync(env)) return [];
  if (!existsSync(example)) return ['Project chưa có .env (và không có .env.example để tạo) — test cần biến môi trường sẽ fail.'];
  await refuseSymlink(env);
  await copyFile(example, env);
  await chmod(env, 0o600).catch(() => {});
  await ensureIgnored(root, '.env');
  return ['Đã tạo .env từ .env.example — điền giá trị thật vào .env (file này không được commit).'];
}

// Hai dạng hay gặp: dotenv `KEY=value` và cặp `"key":"value"` (vài cặp trên một dòng). Dòng `#` là chú thích.
const DOT = /^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*=\s*(.*)$/;
const PAIR = /"([\w.-]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
export function parseEnv(text = '') {
  const out = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    const pairs = [...line.matchAll(PAIR)];
    if (pairs.length) for (const m of pairs) out.set(m[1], m[2]);
    else {
      const m = DOT.exec(line);
      if (m) out.set(m[1], m[2].trim().replace(/^(['"])(.*)\1$/, '$2'));
    }
  }
  return out;
}

const PLACEHOLDER = /^(<.*>|changeme|todo|xxx+|your[_-].*|\.\.\.)$/i;
export const valueState = (v) => (v == null ? 'missing' : !v.trim() ? 'empty' : PLACEHOLDER.test(v.trim()) ? 'placeholder' : 'set');

// Trạng thái từng key, không trả giá trị: .env.local đè .env (cả dotenv lẫn crm-automation-test đọc theo thứ tự này)
export async function envSummary(root) {
  const read = async (n) => (existsSync(join(root, n)) ? readFile(join(root, n), 'utf8').catch(() => '') : null);
  const [env, local, example] = await Promise.all(ENV_FILES.map(read));
  const maps = { '.env': parseEnv(env ?? ''), '.env.local': parseEnv(local ?? ''), '.env.example': parseEnv(example ?? '') };
  const keys = [...new Set([...maps['.env.example'].keys(), ...maps['.env'].keys(), ...maps['.env.local'].keys()])];
  const files = ENV_FILES.map((name, i) => ({
    name, exists: [env, local, example][i] != null, bytes: Buffer.byteLength([env, local, example][i] ?? ''),
    secret: SECRET_FILES.has(name), ignored: SECRET_FILES.has(name) ? isIgnored(root, name) : null, tracked: SECRET_FILES.has(name) && isTracked(root, name),
  }));
  return {
    files,
    keys: keys.map((key) => {
      const from = ['.env.local', '.env'].find((f) => maps[f].has(key) && valueState(maps[f].get(key)) === 'set') ?? ['.env.local', '.env'].find((f) => maps[f].has(key)) ?? null;
      return { key, state: valueState(from ? maps[from].get(key) : undefined), from, inExample: maps['.env.example'].has(key) };
    }),
  };
}

const checkName = (name) => {
  if (!ENV_FILES.includes(name)) throw bad('Chỉ đọc / ghi được .env, .env.local, .env.example');
  return name;
};

export async function readEnvFile(root, name) {
  const p = join(root, checkName(name));
  if (!existsSync(p)) return { name, exists: false, content: '' };
  const st = await lstat(p);
  if (st.isSymbolicLink()) throw bad('Không đọc file env là symlink');
  if (st.size > MAX_ENV_BYTES) throw bad(`File lớn hơn ${MAX_ENV_BYTES / 1024}KB`);
  return { name, exists: true, content: await readFile(p, 'utf8') };
}

export async function writeEnvFile(root, name, content) {
  const p = join(root, checkName(name));
  if (typeof content !== 'string') throw bad('content phải là chuỗi');
  if (Buffer.byteLength(content) > MAX_ENV_BYTES) throw bad(`Nội dung lớn hơn ${MAX_ENV_BYTES / 1024}KB`);
  await refuseSymlink(p);
  await atomicWrite(p, content.endsWith('\n') || !content ? content : `${content}\n`, SECRET_FILES.has(name) ? 0o600 : 0o644);
  const ignoredNow = SECRET_FILES.has(name) ? await ensureIgnored(root, name) : false;
  return { name, saved: true, addedToGitignore: ignoredNow };
}

// ----- key của dashboard: ~/.e2e-dashboard/config.json (của người dùng, không theo repo) -----
const mask = (v) => (typeof v === 'string' && v ? `••••${v.length > 8 ? v.slice(-4) : ''}` : null);
const WEBHOOK_EVENTS = ['run-failed', 'digest', 'report', 'alert'];
const userFile = (env) => join(homeDir(env), 'config.json');

// đồng bộ: selfheal.mjs đọc mỗi lần có lỗi (file nhỏ)
export function readUserConfig(env = process.env) {
  try {
    const c = JSON.parse(readFileSync(userFile(env), 'utf8'));
    return c && typeof c === 'object' && !Array.isArray(c) ? c : {};
  } catch {
    return {};
  }
}

async function readUser(env, { strict = false } = {}) {
  let text;
  try {
    text = await readFile(userFile(env), 'utf8');
  } catch {
    return {}; // chưa có file
  }
  try {
    const c = JSON.parse(text);
    if (c && typeof c === 'object' && !Array.isArray(c)) return c;
  } catch {
    // hỏng: bên dưới
  }
  // ghi đè một config hỏng sẽ mất key / webhook đang có: báo để người dùng sửa tay
  if (strict && text.trim()) throw bad(`${userFile(env)} không phải JSON hợp lệ — sửa tay rồi lưu lại`, 409);
  return {};
}

export async function userSummary(env = process.env) {
  const c = await readUser(env);
  return {
    path: userFile(env),
    linear: { apiKey: mask(c.linear?.apiKey), team: typeof c.linear?.team === 'string' ? c.linear.team : '', fromEnv: Boolean(env.LINEAR_API_KEY) },
    webhooks: (Array.isArray(c.webhooks) ? c.webhooks : []).map((w) => {
      let host = '?';
      try {
        host = new URL(w.url).host;
      } catch {
        // URL hỏng: vẫn liệt kê để xoá được
      }
      return { host, events: Array.isArray(w.events) ? w.events : WEBHOOK_EVENTS };
    }),
    events: WEBHOOK_EVENTS,
    ai: { autoSummary: c.ai?.autoSummary !== false, autoBugLog: c.ai?.autoBugLog === true, model: validModel(c.ai?.model) ? c.ai.model : '', effort: AI_EFFORTS.includes(c.ai?.effort) ? c.ai.effort : '', efforts: AI_EFFORTS },
    selfHeal: { enabled: c.selfHeal?.enabled === true, repo: typeof c.selfHeal?.repo === 'string' ? c.selfHeal.repo : '', maxPerDay: Number.isInteger(c.selfHeal?.maxPerDay) ? c.selfHeal.maxPerDay : 3 },
  };
}

export function writeUser(env, patch = {}) {
  // một lần ghi mỗi lúc: hai lần lưu song song không làm mất thay đổi của nhau
  return serial(userFile(env), () => writeUserNow(env, patch));
}

async function writeUserNow(env, patch) {
  const c = await readUser(env, { strict: true });
  if (patch.linearApiKey !== undefined) {
    if (patch.linearApiKey !== null && !/^[\w-]{10,200}$/.test(patch.linearApiKey)) throw bad('Linear API key không hợp lệ');
    c.linear = { ...(c.linear ?? {}), apiKey: patch.linearApiKey ?? undefined };
  }
  if (patch.linearTeam !== undefined) {
    if (patch.linearTeam && !/^[\w-]{1,40}$/.test(patch.linearTeam)) throw bad('Linear team không hợp lệ');
    c.linear = { ...(c.linear ?? {}), team: patch.linearTeam || undefined };
  }
  if (patch.addWebhook) {
    const { url, events } = patch.addWebhook;
    let u;
    try {
      u = new URL(url);
    } catch {
      throw bad('URL webhook không hợp lệ');
    }
    if (u.protocol !== 'https:') throw bad('Webhook phải dùng https');
    const ev = (Array.isArray(events) ? events : []).filter((e) => WEBHOOK_EVENTS.includes(e));
    c.webhooks = [...(Array.isArray(c.webhooks) ? c.webhooks : []), { url: u.href, events: ev.length ? ev : WEBHOOK_EVENTS }];
  }
  if (typeof patch.autoSummary === 'boolean') c.ai = { ...(c.ai ?? {}), autoSummary: patch.autoSummary };
  if (typeof patch.autoBugLog === 'boolean') c.ai = { ...(c.ai ?? {}), autoBugLog: patch.autoBugLog };
  if (patch.aiModel !== undefined) {
    if (patch.aiModel && !validModel(patch.aiModel)) throw bad('Tên model không hợp lệ');
    c.ai = { ...(c.ai ?? {}), model: patch.aiModel || undefined };
  }
  if (patch.aiEffort !== undefined) {
    if (patch.aiEffort && !AI_EFFORTS.includes(patch.aiEffort)) throw bad('Effort không hợp lệ');
    c.ai = { ...(c.ai ?? {}), effort: patch.aiEffort || undefined };
  }
  if (patch.selfHeal && typeof patch.selfHeal === 'object') {
    const { enabled, repo, maxPerDay } = patch.selfHeal;
    const next = { ...(c.selfHeal ?? {}) };
    if (enabled !== undefined) next.enabled = enabled === true;
    if (repo !== undefined) {
      if (repo && (!isAbsolute(repo) || !existsSync(join(repo, '.git')))) throw bad('Đường dẫn repo e2e-dashboard phải là thư mục git (đường dẫn tuyệt đối)');
      // tự sửa lỗi chạy npm test và push trong repo này: chỉ nhận đúng repo e2e-dashboard
      if (repo) {
        let name = null;
        try {
          name = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).name;
        } catch {
          // không có package.json
        }
        if (name !== 'e2e-dashboard') throw bad('Thư mục này không phải repo e2e-dashboard (package.json "name" khác)');
      }
      next.repo = repo || undefined;
    }
    if (maxPerDay !== undefined) {
      if (!Number.isInteger(maxPerDay) || maxPerDay < 1 || maxPerDay > 20) throw bad('Số PR mỗi ngày: 1–20');
      next.maxPerDay = maxPerDay;
    }
    if (next.enabled && !next.repo) throw bad('Cần đường dẫn repo e2e-dashboard trước khi bật tự sửa lỗi');
    c.selfHeal = next;
  }
  if (Number.isInteger(patch.removeWebhook)) c.webhooks = (Array.isArray(c.webhooks) ? c.webhooks : []).filter((_, i) => i !== patch.removeWebhook);
  await mkdir(homeDir(env), { recursive: true });
  await refuseSymlink(userFile(env));
  await atomicWrite(userFile(env), `${JSON.stringify(c, null, 2)}\n`, 0o600);
  return userSummary(env);
}

// ----- tình trạng setup -----
let toolCache = null; // ponytail: đo một lần mỗi server; cài thêm CLI thì khởi động lại dashboard
function tool(cmd, args = ['--version']) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 5000 });
  return r.status === 0 ? (r.stdout || r.stderr).trim().split('\n')[0].slice(0, 80) : null;
}
export function tools() {
  toolCache ??= { claude: tool('claude'), gh: tool('gh'), git: tool('git') };
  return toolCache;
}

export async function setupStatus(root, { reporter }) {
  const summary = await envSummary(root);
  const missing = summary.keys.filter((k) => k.state !== 'set').length;
  const env = summary.files.find((f) => f.name === '.env');
  const t = tools();
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const nodeOk = nodeMajor >= 22;
  const sqliteOn = await indexEnabled(root);
  const e2e = existsSync(join(root, 'node_modules', 'e2e', 'package.json'));
  return [
    { id: 'reporter', ok: Boolean(reporter?.installed), label: 'Reporter e2e-dashboard', detail: reporter?.installed ? `v${reporter.version}${reporter.version !== reporter.latest ? ` (mới nhất v${reporter.latest})` : ''}` : 'Chưa cài: bấm Chạy setup', fix: 'setup' },
    { id: 'env', ok: env.exists && !missing, label: 'File .env', detail: !env.exists ? 'Chưa có: Chạy setup sẽ tạo từ .env.example' : missing ? `${missing} key chưa điền giá trị thật` : 'Đủ key', fix: env.exists ? null : 'setup' },
    { id: 'ignore', ok: env.ignored !== false && !env.tracked, label: '.env không bị commit', detail: env.tracked ? 'Đang bị git track (secret đã vào lịch sử): chạy git rm --cached .env rồi commit, và đổi các secret đã lộ' : env.ignored === false ? 'Git chưa bỏ qua .env: Chạy setup để thêm vào .gitignore' : 'Đã có trong .gitignore', fix: env.tracked ? null : 'setup' },
    { id: 'e2e', ok: e2e, label: 'e2e CLI trong node_modules', detail: e2e ? 'Đã cài' : 'Chưa cài: chạy npm install', fix: null },
    { id: 'node', ok: nodeOk, label: 'Node.js', detail: `${process.version}${nodeOk ? '' : ': cần Node ≥ 22'}`, fix: null },
    { id: 'index', ok: sqliteOn, label: 'Chỉ mục SQLite', detail: sqliteOn ? 'Đang bật: .e2e-dashboard/cache/index.sqlite' : sqliteSupport().ok ? 'Đang tắt (bật ở mục Hệ thống bên dưới để nhanh hơn với lịch sử lớn)' : `Đang tắt. ${sqliteSupport().reason}`, fix: null, optional: true },
    { id: 'claude', ok: Boolean(t.claude), label: 'Claude Code CLI (cho tính năng AI)', detail: t.claude ?? 'Không thấy lệnh claude trên PATH', fix: null },
    { id: 'gh', ok: Boolean(t.gh), label: 'GitHub CLI (cho đồng bộ CI)', detail: t.gh ?? 'Không thấy lệnh gh (chỉ cần khi dùng đồng bộ CI)', fix: null, optional: true },
  ];
}

// model / effort cho mọi lệnh claude của dashboard: cài đặt của người dùng (trang Cài đặt hệ thống) đè ai.model của project
export function aiPrefs(env = process.env, projectCfg = {}) {
  const u = readUserConfig(env).ai ?? {};
  return { model: validModel(u.model) ? u.model : validModel(projectCfg.ai?.model) ? projectCfg.ai.model : undefined, effort: AI_EFFORTS.includes(u.effort) ? u.effort : undefined };
}
