// Cài đặt chỉnh trên UI (trang Tự động & lưu trữ), lưu ở .e2e-dashboard/settings.json.
// workers: số worker mặc định cho run do dashboard khởi động; null = để e2e tự chọn theo máy.
import { availableParallelism } from 'node:os';
import { readState, writeState, serial } from './jsonstate.mjs';

const FILE = 'settings.json';

// mặc định của e2e ngoài CI khi config không đặt workers: một nửa số core, tối thiểu 1
export const autoWorkers = (cores = availableParallelism()) => Math.max(1, Math.floor(cores / 2));

export const validWorkers = (v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 1024);

export async function readSettings(root) {
  const s = await readState(root, FILE, {});
  return { workers: validWorkers(s?.workers) ? s.workers : null };
}

export function writeSettings(root, patch) {
  return serial(`${root}:${FILE}`, async () => {
    if (patch?.workers !== undefined && !validWorkers(patch.workers)) throw Object.assign(new Error('invalid workers'), { status: 400 });
    const next = { ...(await readSettings(root)), ...(patch?.workers !== undefined ? { workers: patch.workers } : {}) };
    await writeState(root, FILE, next);
    return next;
  });
}
