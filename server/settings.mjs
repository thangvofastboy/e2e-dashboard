// Cài đặt chỉnh trên UI (trang Tự động & lưu trữ), lưu ở .e2e-dashboard/settings.json.
// workers: số worker mặc định cho run do dashboard khởi động; null = để e2e tự chọn theo máy.
import { availableParallelism } from 'node:os';
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

export async function readSettings(root) {
  const s = await readState(root, FILE, {});
  // sqlite: dùng chỉ mục SQLite (cache/index.sqlite) — mặc định tắt, bật ở trang Cài đặt hệ thống (cần Node ≥ 22.13)
  return { workers: validWorkers(s?.workers) ? s.workers : null, sqlite: s?.sqlite === true, browser: validBrowser(s?.browser) ? s.browser : 'chromium', linear: linearOrEmpty(s?.linear) };
}

export function writeSettings(root, patch) {
  return serial(`${root}:${FILE}`, async () => {
    if (patch?.workers !== undefined && !validWorkers(patch.workers)) throw Object.assign(new Error('invalid workers'), { status: 400 });
    if (patch?.sqlite !== undefined && typeof patch.sqlite !== 'boolean') throw Object.assign(new Error('invalid sqlite'), { status: 400 });
    if (patch?.browser !== undefined && !validBrowser(patch.browser)) throw Object.assign(new Error('invalid browser'), { status: 400 });
    const linear = patch?.linear !== undefined ? normalizeLinear(patch.linear) : undefined;
    const next = { ...(await readSettings(root)), ...(patch?.workers !== undefined ? { workers: patch.workers } : {}), ...(patch?.sqlite !== undefined ? { sqlite: patch.sqlite } : {}), ...(patch?.browser !== undefined ? { browser: patch.browser } : {}), ...(linear !== undefined ? { linear } : {}) };
    await writeState(root, FILE, next);
    return next;
  });
}
