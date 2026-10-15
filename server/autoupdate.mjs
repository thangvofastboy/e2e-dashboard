// Tự cập nhật plugin: bật auto-update cho marketplace e2e-dashboard trong settings.json của Claude Code.
// Claude Code mặc định tắt auto-update với marketplace bên thứ ba; khi bật, sau tin nhắn đầu tiên của một phiên nó
// làm mới marketplace và tải bản mới (áp dụng sau /reload-plugins hoặc lần mở sau).
// Cấu hình (theo tài liệu Claude Code): { "extraKnownMarketplaces": { "<tên>": { "source": {...}, "autoUpdate": true } } }
import { readFile, writeFile, rename, mkdir, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export const MARKETPLACE = 'e2e-dashboard';
export const SOURCE = { source: 'github', repo: 'thangvofastboy/e2e-dashboard' };

export const settingsPath = (env = process.env) => join(env.CLAUDE_CONFIG_DIR || join(env.HOME || env.USERPROFILE || homedir(), '.claude'), 'settings.json');

async function readSettingsFile(path) {
  if (!existsSync(path)) return {};
  const text = await readFile(path, 'utf8');
  if (!text.trim()) return {};
  const data = JSON.parse(text); // hỏng thì ném lỗi: không ghi đè file người dùng
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('settings.json không phải object JSON');
  return data;
}

export async function autoUpdateStatus(env = process.env) {
  const path = settingsPath(env);
  try {
    const s = await readSettingsFile(path);
    const v = s.extraKnownMarketplaces?.[MARKETPLACE]?.autoUpdate;
    // off: người dùng đã chủ động tắt (autoUpdate: false) — đừng nhắc bật lại
    return { path, enabled: v === true, off: v === false, error: null };
  } catch (e) {
    return { path, enabled: false, error: `Không đọc được ${path}: ${e.message}` };
  }
}

// on: true bật, false tắt. Giữ nguyên mọi khoá khác; ghi qua file tạm rồi đổi tên
export async function setAutoUpdate(on, env = process.env) {
  const path = settingsPath(env);
  if (existsSync(path) && (await lstat(path)).isSymbolicLink()) throw new Error(`Từ chối ghi qua symlink: ${path}`);
  let s;
  try {
    s = await readSettingsFile(path);
  } catch (e) {
    throw new Error(`Không sửa ${path} vì file không đọc được (${e.message}); thêm tay: "extraKnownMarketplaces": { "${MARKETPLACE}": { "autoUpdate": true } }`);
  }
  const markets = s.extraKnownMarketplaces && typeof s.extraKnownMarketplaces === 'object' ? s.extraKnownMarketplaces : {};
  const cur = markets[MARKETPLACE] && typeof markets[MARKETPLACE] === 'object' ? markets[MARKETPLACE] : {};
  if ((cur.autoUpdate === true) === on && (on ? cur.source : true)) return { path, enabled: on, changed: false };
  s.extraKnownMarketplaces = { ...markets, [MARKETPLACE]: { ...cur, source: cur.source ?? SOURCE, autoUpdate: on } };
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${randomBytes(6).toString('hex')}`;
  await writeFile(tmp, `${JSON.stringify(s, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, path);
  return { path, enabled: on, changed: true };
}
