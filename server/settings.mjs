// Cài đặt chỉnh trên UI (trang Tự động & lưu trữ), lưu ở .e2e-dashboard/settings.json.
// workers: số worker mặc định cho run do dashboard khởi động; null = để e2e tự chọn theo máy.
import { availableParallelism } from 'node:os';
import { readState, writeState, serial } from './jsonstate.mjs';
import { validBrowser } from './browsers.mjs';

const FILE = 'settings.json';

// mặc định của e2e ngoài CI khi config không đặt workers: một nửa số core, tối thiểu 1
export const autoWorkers = (cores = availableParallelism()) => Math.max(1, Math.floor(cores / 2));

export const validWorkers = (v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 1024);

export async function readSettings(root) {
  const s = await readState(root, FILE, {});
  // sqlite: dùng chỉ mục SQLite (cache/index.sqlite) — mặc định tắt, bật ở trang Cài đặt hệ thống (cần Node ≥ 22.13)
  return { workers: validWorkers(s?.workers) ? s.workers : null, sqlite: s?.sqlite === true, browser: validBrowser(s?.browser) ? s.browser : 'chromium' };
}

export function writeSettings(root, patch) {
  return serial(`${root}:${FILE}`, async () => {
    if (patch?.workers !== undefined && !validWorkers(patch.workers)) throw Object.assign(new Error('invalid workers'), { status: 400 });
    if (patch?.sqlite !== undefined && typeof patch.sqlite !== 'boolean') throw Object.assign(new Error('invalid sqlite'), { status: 400 });
    if (patch?.browser !== undefined && !validBrowser(patch.browser)) throw Object.assign(new Error('invalid browser'), { status: 400 });
    const next = { ...(await readSettings(root)), ...(patch?.workers !== undefined ? { workers: patch.workers } : {}), ...(patch?.sqlite !== undefined ? { sqlite: patch.sqlite } : {}), ...(patch?.browser !== undefined ? { browser: patch.browser } : {}) };
    await writeState(root, FILE, next);
    return next;
  });
}
