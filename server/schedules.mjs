// Lịch chạy test tạo trên UI (Tự động & lưu trữ → Lịch chạy): giờ + thứ trong tuần, project, danh sách test
// và các option như hộp Chạy test. Lưu chung ở ~/.e2e-dashboard/schedules.json; dashboard nào đang mở cũng
// chạy hộ mọi project, một file "claim" (mở bằng cờ wx) bảo đảm mỗi lượt chỉ một dashboard chạy.
import { readFile, writeFile, mkdir, rename, readdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { homeDir, readRegistry } from './projects.mjs';
import { buildRunArgs, RUN_OPTION_KEYS } from './runner.mjs';
import { serial } from './jsonstate.mjs';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX = 100;
// như /api/run, trừ rerunOf (chỉ có nghĩa khi chạy lại một run) và updateSnapshots (ghi đè ảnh mẫu khi không ai xem)
// cùng option như hộp Chạy test; không có rerunOf, và không ghi đè snapshot khi không ai xem (-u)
const SCHEDULE_OPTION_KEYS = [...RUN_OPTION_KEYS.filter((k) => k !== 'rerunOf' && k !== 'updateSnapshots'), 'excludeQuarantined'];

const file = (env) => join(homeDir(env), 'schedules.json');
const claimDir = (env) => join(homeDir(env), 'schedule-claims');

// dòng hỏng (sửa tay) bị bỏ: thiếu days / times sẽ làm tick ném lỗi và mọi lịch khác ngừng chạy
const validEntry = (s) => s && typeof s.id === 'string' && typeof s.root === 'string' && Array.isArray(s.days) && Array.isArray(s.times);

// strict: file có mà không đọc được (JSON hỏng) thì ném lỗi thay vì coi như rỗng, để lần lưu sau không ghi đè mất
async function loadSchedules(env, { strict = false } = {}) {
  let text;
  try {
    text = await readFile(file(env), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT' || !strict) return [];
    throw e;
  }
  let list;
  try {
    list = JSON.parse(text);
  } catch {
    if (strict) throw new Error('~/.e2e-dashboard/schedules.json hỏng (JSON không hợp lệ): sửa hoặc xoá file rồi lưu lại');
    return [];
  }
  return Array.isArray(list) ? list.filter(validEntry) : [];
}

export const readSchedules = (env = process.env) => loadSchedules(env);

async function writeSchedules(list, env) {
  await mkdir(homeDir(env), { recursive: true });
  const tmp = `${file(env)}.tmp-${randomBytes(6).toString('hex')}`;
  await writeFile(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
  await rename(tmp, file(env));
}

const update = (env, fn) => serial(`schedules:${file(env)}`, async () => {
  const list = await loadSchedules(env, { strict: true });
  const out = await fn(list);
  await writeSchedules(list, env);
  return out;
});

// Chuẩn hoá và kiểm tra đầu vào từ UI; ném lỗi tiếng Việt để trả 400.
export function validateSchedule(input, roots) {
  if (!input || typeof input !== 'object') throw new Error('Lịch không hợp lệ');
  const name = String(input.name ?? '').trim().slice(0, 80);
  if (!name) throw new Error('Cần đặt tên lịch');
  const root = typeof input.root === 'string' ? resolve(input.root) : '';
  if (!roots.includes(root)) throw new Error('Project chưa có trong danh sách Projects');
  const times = [...new Set(Array.isArray(input.times) ? input.times : [])];
  if (!times.length || times.length > 24 || !times.every((t) => typeof t === 'string' && HHMM.test(t))) throw new Error('Giờ chạy phải là HH:MM (1–24 mốc)');
  const days = [...new Set(Array.isArray(input.days) ? input.days : [])];
  if (!days.length || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) throw new Error('Chọn ít nhất một thứ trong tuần');
  const raw = input.options && typeof input.options === 'object' ? input.options : {};
  const options = Object.fromEntries(SCHEDULE_OPTION_KEYS.filter((k) => raw[k] !== undefined && raw[k] !== null).map((k) => [k, raw[k]]));
  if (options.excludeQuarantined !== undefined && typeof options.excludeQuarantined !== 'boolean') throw new Error('invalid excludeQuarantined');
  if (options.tests?.length > 200) throw new Error('Tối đa 200 test mỗi lịch');
  buildRunArgs(options); // cùng luật với /api/run: ném "invalid …"
  return { name, root, times: times.sort(), days: days.sort(), enabled: input.enabled !== false, options };
}

export async function saveSchedule(input, env = process.env) {
  const roots = (await readRegistry(env)).map((p) => resolve(p.root));
  const clean = validateSchedule(input, roots);
  return update(env, (list) => {
    const i = typeof input.id === 'string' ? list.findIndex((s) => s.id === input.id) : -1;
    if (i < 0 && list.length >= MAX) throw new Error(`Tối đa ${MAX} lịch`);
    const s = i >= 0 ? { ...list[i], ...clean } : { id: randomUUID(), ...clean, createdAt: new Date().toISOString(), lastRun: null };
    if (i >= 0) list[i] = s;
    else list.push(s);
    return s;
  });
}

export const deleteSchedule = (id, env = process.env) => update(env, (list) => {
  const i = list.findIndex((s) => s.id === id);
  if (i >= 0) list.splice(i, 1);
  return i >= 0;
});

export const recordRun = (id, lastRun, env = process.env) => update(env, (list) => {
  const s = list.find((x) => x.id === id);
  if (s) s.lastRun = { ...s.lastRun, ...lastRun };
});

// Các mốc chạy (giờ địa phương) trong khoảng (from, to], cũ nhất trước.
export function slotsBetween(s, from, to) {
  const out = [];
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  for (; d.getTime() <= to; d.setDate(d.getDate() + 1)) {
    if (!s.days.includes(d.getDay())) continue;
    for (const t of s.times) {
      const [h, m] = t.split(':').map(Number);
      const at = new Date(d).setHours(h, m, 0, 0);
      if (at > from && at <= to) out.push(at);
    }
  }
  return out.sort((a, b) => a - b);
}

export function nextFire(s, now = Date.now()) {
  if (!s.enabled) return null;
  const at = slotsBetween(s, now, now + 8 * 86_400_000)[0];
  return at ? new Date(at).toISOString() : null;
}

// Giành quyền chạy một mốc: file tạo bằng wx chỉ thành công ở đúng một tiến trình.
export async function claimSlot(id, at, env = process.env) {
  await mkdir(claimDir(env), { recursive: true });
  try {
    await writeFile(join(claimDir(env), `${id}-${at}`), String(process.pid), { flag: 'wx' });
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw e;
  }
}

async function pruneClaims(env, now) {
  const names = await readdir(claimDir(env)).catch(() => []);
  for (const n of names) if (now - Number(n.split('-').pop()) > 2 * 86_400_000) await unlink(join(claimDir(env), n)).catch(() => {});
}

// Project đã gỡ khỏi Projects: lịch của nó không chạy nữa (không spawn e2e trong thư mục người dùng đã bỏ).
// Project của chính dashboard đang chạy luôn được.
export async function scheduleRootAllowed(s, projectRoot, env = process.env) {
  const root = resolve(String(s?.root ?? ''));
  if (root === resolve(projectRoot)) return true;
  return (await readRegistry(env)).some((p) => resolve(p.root) === root);
}

// Mỗi 30 giây: mốc nào đã tới từ lần kiểm trước thì giành claim và chạy. Bỏ lỡ mốc khi không có dashboard nào mở.
export function createScheduleRunner({ start, env = process.env, now = () => Date.now(), intervalMs = 30_000, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval }) {
  let last = now();
  const tick = async () => {
    const t = now();
    const from = last;
    last = t;
    for (const s of await readSchedules(env)) {
      if (!s.enabled) continue;
      const at = slotsBetween(s, from, t).pop(); // nhiều mốc dồn lại (máy ngủ): chỉ chạy một lần
      if (!at || !(await claimSlot(s.id, at, env).catch(() => false))) continue;
      const r = await Promise.resolve(start(s)).catch((e) => ({ ok: false, error: e.message }));
      await recordRun(s.id, { at: new Date(t).toISOString(), ok: Boolean(r?.ok), error: r?.ok ? null : String(r?.error ?? 'unknown'), exitCode: null }, env).catch(() => {});
    }
    await pruneClaims(env, t);
  };
  const timer = setIntervalImpl(() => void tick().catch(() => {}), intervalMs);
  timer?.unref?.();
  return { tick, close: () => clearIntervalImpl(timer) };
}
