// Một phiên `playwright-core codegen` (headed): mở browser cho người dùng thao tác, ghi ra file tạm, đọc lại khi xong.
// Hai loại phiên: `record` (ghi thao tác ra file spec) và `login` (chỉ lưu phiên đăng nhập bằng --save-storage để các lần
// record sau mở ra đã đăng nhập bằng --load-storage). Chạy CLI của chính project bằng node (không npx); spawn truyền argv
// dạng mảng, không qua shell, với cwd là gốc project để đường dẫn tương đối trong spec mang đi được.
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedBrowsers } from './browsers.mjs';
import { slugify } from './recorder-spec.mjs';

const fail = (status, message) => Object.assign(new Error(message), { status });
const ERR_MAX = 300;
const KILL_AFTER_MS = 5000; // SIGINT không có tác dụng thì SIGKILL
const ENV_CHECK_TTL_MS = 10_000; // status() bị poll mỗi ~1,5 giây: không đọc lại thư mục trình duyệt mỗi lần
const MAX_SPEC_CHARS = 1_000_000; // file codegen lớn hơn thế không đưa vào bộ nhớ
const AUTH_NAME = /^[a-z0-9-]{1,60}$/;
const AUTH_FILE = /^([a-z0-9-]{1,60})\.json$/;
export const AUTH_DIR_REL = '.e2e-dashboard/auth'; // đã nằm trong .gitignore: file phiên chứa cookie / token
const LINK_SCRIPT = fileURLToPath(new URL('./recorder-link-login.mjs', import.meta.url));
const LINK_TIMEOUT_MS = 60_000;

// Linux cần server hiển thị; macOS/Windows luôn coi là có màn hình
export const hasDisplay = (env, os) => (os === 'linux' ? Boolean(env.DISPLAY || env.WAYLAND_DISPLAY) : true);

// Không có scheme thì tự thêm: localhost / 127.0.0.1 → http, còn lại → https (người dùng hay gõ `localhost:3000`)
const BARE_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i;
export function validateRecordUrl(u) {
  if (typeof u !== 'string' || !u || /\s/.test(u)) throw fail(400, 'URL không hợp lệ');
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : `${BARE_LOCAL.test(u) ? 'http' : 'https'}://${u}`);
  } catch {
    throw fail(400, 'URL không hợp lệ');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw fail(400, 'URL chỉ chấp nhận http hoặc https');
  return url.href;
}

// storageState không có cookie lẫn localStorage nào = chưa đăng nhập (hoặc file hỏng)
function stateProblem(text) {
  let s;
  try {
    s = JSON.parse(text);
  } catch {
    return 'File phiên không hợp lệ';
  }
  return s?.cookies?.length || s?.origins?.length ? null : 'Chưa thấy cookie hay localStorage nào: bạn đã đăng nhập chưa?';
}

export function createRecorder({ projectRoot, spawnImpl = spawn, env = process.env, os = platform(), tmpRoot = tmpdir(), ttlMs = 3_600_000, now = Date.now, browsers = installedBrowsers, linkScript = LINK_SCRIPT, linkTimeoutMs = LINK_TIMEOUT_MS }) {
  const cli = join(projectRoot, 'node_modules', 'playwright-core', 'cli.js');
  const authDir = join(projectRoot, '.e2e-dashboard', 'auth');
  const authPath = (name) => join(authDir, `${name}.json`);
  let session = null; // { id, kind, name, url, auth, dir, file, child, state, error, specText, doneAt, stopping, stderr, closed }

  // lý do không ghi được trên máy này; null = ghi được. Kết quả nhớ ENV_CHECK_TTL_MS; start() luôn kiểm tra lại
  // để cài chromium xong bấm Record là chạy được ngay.
  let checked = { at: -Infinity, reason: null };
  const blocker = ({ fresh = false } = {}) => {
    if (!fresh && now() - checked.at < ENV_CHECK_TTL_MS) return checked.reason;
    let reason = null;
    if (!hasDisplay(env, os)) reason = 'Cần máy có màn hình: không thấy DISPLAY hoặc WAYLAND_DISPLAY';
    else if (!existsSync(cli)) reason = 'Project chưa có playwright-core (node_modules/playwright-core): cài @e2e-dev/web trước';
    else if (browsers(env, os).chromium === false) reason = 'Chưa cài trình duyệt chromium: chạy `npx @e2e-dev/web install chromium`';
    checked = { at: now(), reason };
    return reason;
  };
  const drop = () => {
    if (session) rmSync(session.dir, { recursive: true, force: true });
    session = null;
  };
  const expire = () => {
    if (session?.state === 'done' && now() - session.doneAt > ttlMs) drop();
  };

  const status = () => {
    expire();
    const reason = blocker();
    const base = { canRecord: reason === null, reason };
    if (!session) return { state: 'idle', ...base };
    const { state, kind, id, name, url, auth, error } = session;
    return { state, kind, ...base, id, name, url, ...(auth ? { auth } : {}), ...(error ? { error } : {}) };
  };

  // ghi phiên đăng nhập vào auth/: thư mục 0700, file 0600, ghi qua file tạm rồi rename để không đè dở phiên cũ
  function persistAuth(name, text) {
    mkdirSync(authDir, { recursive: true, mode: 0o700 });
    chmodSync(authDir, 0o700);
    const tmpFile = join(authDir, `.${name}.${randomBytes(4).toString('hex')}.tmp`);
    writeFileSync(tmpFile, text, { mode: 0o600 });
    renameSync(tmpFile, authPath(name));
    chmodSync(authPath(name), 0o600);
  }

  // dùng chung cho record và login: dựng phiên, spawn, theo dõi kết thúc
  function launch({ kind, name, url, auth, argv, file }) {
    const dir = mkdtempSync(join(tmpRoot, 'e2ed-rec-'));
    const s = { id: randomUUID(), kind, name, url, auth, dir, file: join(dir, file), child: null, state: 'recording', error: null, specText: null, doneAt: 0, stopping: false, stderr: '', closed: null };
    session = s;
    try {
      s.child = spawnImpl(process.execPath, [cli, 'codegen', ...argv(s.file), url], { stdio: ['ignore', 'ignore', 'pipe'], cwd: projectRoot });
    } catch (e) {
      drop();
      throw fail(500, `Không chạy được codegen: ${e.message}`);
    }
    s.closed = new Promise((resolve) => {
      const settle = (code, spawnError) => {
        if (session !== s || s.state !== 'recording') return resolve();
        let text = '';
        try {
          text = readFileSync(s.file, 'utf8');
        } catch {}
        // đã bấm Dừng thì mã thoát (SIGINT = 130) không còn ý nghĩa: có nội dung là đủ
        const clean = s.stopping || code === 0;
        const problem = text.length > MAX_SPEC_CHARS ? 'File ghi quá lớn (hơn 1 MB): chia nhỏ phiên record' : null;
        if (problem) {
          Object.assign(s, { state: 'failed', error: problem });
        } else if (text.trim() && clean && s.kind === 'login') {
          const bad = stateProblem(text);
          if (bad) Object.assign(s, { state: 'failed', error: bad });
          else {
            persistAuth(s.auth, text);
            Object.assign(s, { state: 'done', doneAt: now() });
          }
        } else if (text.trim() && clean) {
          Object.assign(s, { state: 'done', specText: text, doneAt: now() });
        } else {
          s.state = 'failed';
          s.error = (spawnError ?? s.stderr.trim()) || (code ? `codegen thoát với mã ${code}` : 'Phiên record không ghi được thao tác nào');
        }
        if (s.kind === 'login') rmSync(s.file, { force: true }); // file tạm chứa cookie: xoá ngay dù thành công hay không
        resolve();
      };
      s.child.stderr?.on('data', (b) => { s.stderr = (s.stderr + b).slice(-ERR_MAX); });
      s.child.on('error', (e) => settle(null, e.message.slice(-ERR_MAX)));
      s.child.on('close', (code) => settle(code));
    });
    return { id: s.id };
  }

  // kiểm tra chung trước khi mở một phiên mới; trả URL chuẩn hoá
  function admit(url) {
    expire();
    const u = validateRecordUrl(url);
    const reason = blocker({ fresh: true });
    if (reason) throw fail(400, reason);
    if (session?.state === 'recording') throw fail(409, 'Đang có một phiên record');
    drop();
    return u;
  }

  async function start({ url, name, auth }) {
    const wantAuth = auth !== undefined && auth !== null && auth !== '';
    if (wantAuth && (typeof auth !== 'string' || !AUTH_NAME.test(auth))) throw fail(400, 'Tên phiên đăng nhập không hợp lệ');
    if (wantAuth && !existsSync(authPath(auth))) throw fail(400, `Chưa có phiên đăng nhập "${auth}": đăng nhập trước`);
    const u = admit(url);
    return launch({
      kind: 'record', name, url: u, auth: wantAuth ? auth : undefined, file: 'rec.spec.ts',
      argv: (file) => ['--target', 'playwright-test', ...(wantAuth ? ['--load-storage', `${AUTH_DIR_REL}/${auth}.json`] : []), '-o', file],
    });
  }

  // Mở browser để người dùng đăng nhập; không ghi thao tác, chỉ lưu cookie / localStorage thành phiên tên `name`
  async function login({ url, name }) {
    const slug = slugify(name);
    if (!slug) throw fail(400, 'Tên phiên không hợp lệ: cần ít nhất một chữ cái hoặc số');
    const u = admit(url);
    return launch({ kind: 'login', name: slug, url: u, auth: slug, file: 'auth.json', argv: (file) => ['--save-storage', file] });
  }

  // Dựng phiên từ cookie đã có: không mở trình duyệt, không cần màn hình
  function saveAuth(name, state) {
    checkAuthName(name);
    const bad = stateProblem(JSON.stringify(state ?? null));
    if (bad) throw fail(400, bad);
    persistAuth(name, JSON.stringify(state, null, 2));
    return { name };
  }

  // Dựng phiên bằng cách mở `link` (đăng nhập một lần) trong chromium headless (có thể kèm cookie dán sẵn) rồi lưu storageState.
  // Cookie và link là bí mật: đi qua file tạm 0600 (không qua argv), lỗi trả ra đã bị che, file tạm xoá ngay.
  let preparing = false;
  async function prepareLink({ name, url, link, cookies = [] }) {
    const slug = slugify(name);
    if (!slug) throw fail(400, 'Tên phiên không hợp lệ: cần ít nhất một chữ cái hoặc số');
    if (preparing) throw fail(409, 'Đang dựng một phiên khác, đợi xong rồi thử lại');
    if (!existsSync(cli)) throw fail(400, 'Project chưa có playwright-core (node_modules/playwright-core): cài @e2e-dev/web trước');
    if (browsers(env, os).chromium === false) throw fail(400, 'Chưa cài trình duyệt chromium: chạy `npx @e2e-dev/web install chromium`');
    preparing = true;
    const dir = mkdtempSync(join(tmpRoot, 'e2ed-prep-'));
    try {
      const input = join(dir, 'input.json');
      const out = join(dir, 'state.json');
      writeFileSync(input, JSON.stringify({ url, link, cookies }), { mode: 0o600 });
      const secrets = [link, ...cookies.map((c) => c.value)].filter((v) => typeof v === 'string' && v.length >= 3);
      const scrub = (m) => secrets.reduce((acc, v) => acc.split(v).join('«ẩn»'), String(m)).replace(/\bhttps?:\/\/[^\s"']+/g, '«url»').slice(-ERR_MAX);
      await new Promise((resolve, reject) => {
        let stderr = '';
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
          child = spawnImpl(process.execPath, [linkScript, input, out, projectRoot], { stdio: ['ignore', 'ignore', 'pipe'], cwd: projectRoot });
        } catch (e) {
          return reject(fail(502, `Không chạy được trình duyệt: ${scrub(e.message)}`));
        }
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          finish(fail(502, 'Hết thời gian chờ mở link (60 giây): link có hết hạn hoặc bị chặn không?'));
        }, linkTimeoutMs);
        child.stderr?.on('data', (b) => { stderr = (stderr + b).slice(-2000); });
        child.on('error', (e) => finish(fail(502, `Không chạy được trình duyệt: ${scrub(e.message)}`)));
        child.on('close', (code) => finish(code === 0 ? null : fail(502, `Mở link thất bại: ${scrub(stderr.trim()) || `mã thoát ${code}`}`)));
      });
      let text = '';
      try {
        text = readFileSync(out, 'utf8');
      } catch {}
      const bad = text.trim() ? stateProblem(text) : 'Không lấy được phiên từ link: bạn đã đăng nhập chưa?';
      if (bad) throw fail(502, bad);
      persistAuth(slug, text);
      return { name: slug };
    } finally {
      rmSync(dir, { recursive: true, force: true }); // input.json và state.json chứa cookie
      preparing = false;
    }
  }

  async function stop() {
    const s = session;
    if (s?.state === 'recording') {
      s.stopping = true;
      s.child.kill('SIGINT'); // SIGINT mới lưu --save-storage; SIGTERM bỏ phiên
      const t = setTimeout(() => s.child.kill('SIGKILL'), KILL_AFTER_MS);
      t.unref?.();
      await s.closed;
      clearTimeout(t);
    }
    return status();
  }

  const checkAuthName = (name) => {
    if (typeof name !== 'string' || !AUTH_NAME.test(name)) throw fail(400, 'Tên phiên đăng nhập không hợp lệ');
    return name;
  };

  return {
    start,
    login,
    saveAuth,
    prepareLink,
    stop,
    status,
    result() {
      expire();
      return session?.state === 'done' && session.kind === 'record'
        ? { id: session.id, name: session.name, url: session.url, specText: session.specText, auth: session.auth ?? null }
        : null;
    },
    clear() {
      if (session && session.state !== 'recording') drop();
    },
    close() {
      if (session?.state === 'recording') session.child.kill('SIGTERM');
      drop();
    },
    // chỉ tên + thời điểm lưu; nội dung file (cookie / token) không bao giờ đi ra ngoài module này
    listAuth() {
      let names = [];
      try {
        names = readdirSync(authDir);
      } catch {}
      return names
        .map((f) => AUTH_FILE.exec(f)?.[1])
        .filter(Boolean)
        .sort()
        .map((name) => ({ name, savedAt: statSync(authPath(name)).mtime.toISOString() }));
    },
    removeAuth(name) {
      checkAuthName(name);
      if (!existsSync(authPath(name))) throw fail(404, `Không có phiên đăng nhập "${name}"`);
      rmSync(authPath(name), { force: true });
    },
  };
}
