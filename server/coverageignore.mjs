// Danh sách route / domain bấm "Bỏ qua" trên trang Coverage, lưu ở .e2e-dashboard/coverage-ignore.json.
// Gộp với "coverage.ignore" và "coverage.domainIgnore" trong config (config do người dùng sửa tay).
import { readState, writeState, serial } from './jsonstate.mjs';

const FILE = 'coverage-ignore.json';
const MAX = 500;

export async function readIgnored(root) {
  const s = await readState(root, FILE, {});
  const clean = (xs) => (Array.isArray(xs) ? xs.filter((x) => typeof x === 'string' && x) : []);
  return { routes: clean(s?.routes), domains: clean(s?.domains) };
}

// route: bắt đầu bằng "/", không khoảng trắng, không query. domain: hostname, bỏ scheme/port/path.
export function normalizeIgnoreValue(kind, raw) {
  const v = String(raw ?? '').trim();
  if (kind !== 'route' && kind !== 'domain') throw Object.assign(new Error('invalid kind'), { status: 400 });
  if (!v || v.length > 200) throw Object.assign(new Error('invalid value'), { status: 400 });
  if (kind === 'route') {
    if (!v.startsWith('/') || /\s/.test(v) || v.includes('?')) throw Object.assign(new Error('route phải bắt đầu bằng "/" và không có khoảng trắng'), { status: 400 });
    return v.length > 1 ? v.replace(/\/+$/, '') : v;
  }
  const host = v.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(host)) throw Object.assign(new Error('domain không hợp lệ'), { status: 400 });
  return host;
}

// Thêm (remove = false) hoặc xoá (remove = true). Trả về danh sách sau khi ghi.
export async function changeIgnored(root, { kind, value, remove = false }) {
  const key = kind === 'route' ? 'routes' : 'domains';
  const v = normalizeIgnoreValue(kind, value);
  return serial(`${root}:coverage-ignore`, async () => {
    const cur = await readIgnored(root);
    const list = cur[key];
    const next = remove ? list.filter((x) => x !== v) : list.includes(v) ? list : [...list, v];
    if (next.length > MAX) throw Object.assign(new Error(`tối đa ${MAX} mục`), { status: 400 });
    const out = { ...cur, [key]: next };
    await writeState(root, FILE, out);
    return out;
  });
}
