// Cài đặt chỉnh trên UI (trang Tự động & lưu trữ), lưu ở .e2e-dashboard/settings.json.
// workers: số worker mặc định cho run do dashboard khởi động; null = để e2e tự chọn theo máy.
import { availableParallelism } from 'node:os';
import { realpath, stat, lstat } from 'node:fs/promises';
import { resolve, isAbsolute, sep } from 'node:path';
import { readState, writeState, serial } from './jsonstate.mjs';
import { validBrowser } from './browsers.mjs';

const FILE = 'settings.json';

// mặc định của e2e ngoài CI khi config không đặt workers: một nửa số core, tối thiểu 1
export const autoWorkers = (cores = availableParallelism()) => Math.max(1, Math.floor(cores / 2));

export const validWorkers = (v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 1024);

const EMAIL = /^[^\s@,]{1,64}@[^\s@,]{1,255}$/;
const LINEAR_MAX = 20;
const STATUS_MAX = 60;

// Email và status do người dùng nhập (tab Tích hợp): chuẩn hoá rồi kiểm tra; sai thì 400
export function normalizeLinear(input) {
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  const emails = [...new Set((Array.isArray(input?.emails) ? input.emails : []).map((e) => String(e ?? '').trim().toLowerCase()).filter(Boolean))];
  const statuses = [...new Set((Array.isArray(input?.statuses) ? input.statuses : []).map((s) => String(s ?? '').trim()).filter(Boolean))];
  if (emails.length > LINEAR_MAX || statuses.length > LINEAR_MAX) throw bad(`Tối đa ${LINEAR_MAX} email và ${LINEAR_MAX} status`);
  if (!emails.every((e) => EMAIL.test(e))) throw bad('Email không đúng định dạng');
  if (!statuses.every((s) => s.length <= STATUS_MAX)) throw bad(`Status tối đa ${STATUS_MAX} ký tự`);
  return { emails, statuses };
}

// file state có thể bị sửa tay: không hợp lệ thì coi như chưa cấu hình, không làm hỏng cả trang cài đặt
const linearOrEmpty = (v) => {
  try {
    return normalizeLinear(v);
  } catch {
    return { emails: [], statuses: [] };
  }
};

const SOURCES_MAX = 20;
const DESC_MAX = 500;
const PROMPT_MAX = 8000;
const inside = (dir, p) => p === dir || p.startsWith(dir.endsWith(sep) ? dir : dir + sep);

// Thư mục nguồn của dự án (tab Dự án): path tương đối với project hoặc tuyệt đối, phải là thư mục có thật.
// Tương đối thì sau khi theo symlink vẫn phải nằm trong project; tuyệt đối thì bản thân nó không được là symlink.
export async function normalizeSources(root, input) {
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  if (!Array.isArray(input)) throw bad('sources phải là danh sách');
  if (input.length > SOURCES_MAX) throw bad(`Tối đa ${SOURCES_MAX} thư mục nguồn`);
  const realRoot = await realpath(root);
  const out = [];
  for (const s of input) {
    const path = String(s?.path ?? '').trim();
    const description = String(s?.description ?? '').trim();
    if (!path || path.includes('\0')) throw bad('Thiếu đường dẫn thư mục');
    if (description.length > DESC_MAX) throw bad(`Mô tả tối đa ${DESC_MAX} ký tự`);
    const abs = resolve(root, path);
    let real;
    try {
      real = await realpath(abs);
      if (!(await stat(real)).isDirectory()) throw new Error();
      if (isAbsolute(path) ? (await lstat(abs)).isSymbolicLink() : !inside(realRoot, real)) throw new Error();
    } catch {
      throw bad(`Thư mục không hợp lệ: ${path}`);
    }
    out.push({ path, description });
  }
  return out;
}

const validPrompt = (p) => typeof p === 'string' && p.length <= PROMPT_MAX;

export async function readSettings(root) {
  const s = await readState(root, FILE, {});
  // file sửa tay: sources hỏng thì coi như chưa cấu hình
  const sources = Array.isArray(s?.sources) && s.sources.length ? await normalizeSources(root, s.sources).catch(() => []) : [];
  // sqlite: dùng chỉ mục SQLite (cache/index.sqlite) — mặc định tắt, bật ở trang Cài đặt hệ thống (cần Node ≥ 22.13)
  // headed: mở trình duyệt khi chạy (mặc định tắt); sources / prompt: bối cảnh dự án gửi kèm mọi lần gọi AI
  return { workers: validWorkers(s?.workers) ? s.workers : null, sqlite: s?.sqlite === true, browser: validBrowser(s?.browser) ? s.browser : 'chromium', headed: s?.headed === true, linear: linearOrEmpty(s?.linear), sources, prompt: validPrompt(s?.prompt) ? s.prompt : '' };
}

export function writeSettings(root, patch) {
  return serial(`${root}:${FILE}`, async () => {
    if (patch?.workers !== undefined && !validWorkers(patch.workers)) throw Object.assign(new Error('invalid workers'), { status: 400 });
    if (patch?.sqlite !== undefined && typeof patch.sqlite !== 'boolean') throw Object.assign(new Error('invalid sqlite'), { status: 400 });
    if (patch?.browser !== undefined && !validBrowser(patch.browser)) throw Object.assign(new Error('invalid browser'), { status: 400 });
    if (patch?.headed !== undefined && typeof patch.headed !== 'boolean') throw Object.assign(new Error('invalid headed'), { status: 400 });
    if (patch?.prompt !== undefined && !validPrompt(patch.prompt)) throw Object.assign(new Error(`Prompt phải là chuỗi tối đa ${PROMPT_MAX} ký tự`), { status: 400 });
    const linear = patch?.linear !== undefined ? normalizeLinear(patch.linear) : undefined;
    const sources = patch?.sources !== undefined ? await normalizeSources(root, patch.sources) : undefined;
    const pick = (k, v = patch?.[k]) => (v !== undefined ? { [k]: v } : {});
    const next = { ...(await readSettings(root)), ...pick('workers'), ...pick('sqlite'), ...pick('browser'), ...pick('headed'), ...pick('linear', linear), ...pick('sources', sources), ...pick('prompt') };
    await writeState(root, FILE, next);
    return next;
  });
}
