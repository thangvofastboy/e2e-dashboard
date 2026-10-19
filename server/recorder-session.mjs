// Một phiên `playwright-core codegen` (headed): mở browser cho người dùng thao tác, ghi ra file tạm, đọc lại khi xong.
// Chạy CLI của chính project bằng node (không npx); spawn truyền argv dạng mảng, không qua shell.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { installedBrowsers } from './browsers.mjs';

const fail = (status, message) => Object.assign(new Error(message), { status });
const ERR_MAX = 300;
const KILL_AFTER_MS = 5000; // SIGINT không có tác dụng thì SIGKILL
const ENV_CHECK_TTL_MS = 10_000; // status() bị poll mỗi ~1,5 giây: không đọc lại thư mục trình duyệt mỗi lần
const MAX_SPEC_CHARS = 1_000_000; // file codegen lớn hơn thế không đưa vào bộ nhớ

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

export function createRecorder({ projectRoot, spawnImpl = spawn, env = process.env, os = platform(), tmpRoot = tmpdir(), ttlMs = 3_600_000, now = Date.now, browsers = installedBrowsers }) {
  const cli = join(projectRoot, 'node_modules', 'playwright-core', 'cli.js');
  let session = null; // { id, name, url, dir, file, child, state, error, specText, doneAt, stopping, stderr, closed }

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
    const { state, id, name, url, error } = session;
    return { state, ...base, id, name, url, ...(error ? { error } : {}) };
  };

  async function start({ url, name }) {
    expire();
    const u = validateRecordUrl(url);
    const reason = blocker({ fresh: true });
    if (reason) throw fail(400, reason);
    if (session?.state === 'recording') throw fail(409, 'Đang có một phiên record');
    drop();
    const dir = mkdtempSync(join(tmpRoot, 'e2ed-rec-'));
    const file = join(dir, 'rec.spec.ts');
    const s = { id: randomUUID(), name, url: u, dir, file, child: null, state: 'recording', error: null, specText: null, doneAt: 0, stopping: false, stderr: '', closed: null };
    session = s;
    try {
      s.child = spawnImpl(process.execPath, [cli, 'codegen', '--target', 'playwright-test', '-o', file, u], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
      drop();
      throw fail(500, `Không chạy được codegen: ${e.message}`);
    }
    s.closed = new Promise((resolve) => {
      const settle = (code, spawnError) => {
        if (session !== s || s.state !== 'recording') return resolve();
        let text = '';
        try {
          text = readFileSync(file, 'utf8');
        } catch {}
        // đã bấm Dừng thì mã thoát (SIGINT = 130) không còn ý nghĩa: có nội dung là đủ
        if (text.length > MAX_SPEC_CHARS) {
          s.state = 'failed';
          s.error = 'File ghi quá lớn (hơn 1 MB): chia nhỏ phiên record';
        } else if (text.trim() && (s.stopping || code === 0)) {
          Object.assign(s, { state: 'done', specText: text, doneAt: now() });
        } else {
          s.state = 'failed';
          s.error = (spawnError ?? s.stderr.trim()) || (code ? `codegen thoát với mã ${code}` : 'Phiên record không ghi được thao tác nào');
        }
        resolve();
      };
      s.child.stderr?.on('data', (b) => { s.stderr = (s.stderr + b).slice(-ERR_MAX); });
      s.child.on('error', (e) => settle(null, e.message.slice(-ERR_MAX)));
      s.child.on('close', (code) => settle(code));
    });
    return { id: s.id };
  }

  async function stop() {
    const s = session;
    if (s?.state === 'recording') {
      s.stopping = true;
      s.child.kill('SIGINT');
      const t = setTimeout(() => s.child.kill('SIGKILL'), KILL_AFTER_MS);
      t.unref?.();
      await s.closed;
      clearTimeout(t);
    }
    return status();
  }

  return {
    start,
    stop,
    status,
    result() {
      expire();
      return session?.state === 'done' ? { id: session.id, name: session.name, url: session.url, specText: session.specText } : null;
    },
    clear() {
      if (session && session.state !== 'recording') drop();
    },
    close() {
      if (session?.state === 'recording') session.child.kill('SIGTERM');
      drop();
    },
  };
}
