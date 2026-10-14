// Danh sách issue Linear của project: lấy theo email và status, thêm tay, merge khi refresh, lưu trong
// .e2e-dashboard/linear-issues.json. Phần thuần (chuẩn hoá, merge) tách riêng để test không cần mạng.
import { parseIssueRef } from './linear.mjs';
import { readState, writeState, serial } from './jsonstate.mjs';

const FILE = 'linear-issues.json';

export const ID = /^[A-Z][A-Z0-9]{1,9}-\d{1,7}$/;

// Mã issue từ chuỗi người dùng nhập: "ENG-12", "eng-12", hoặc link Linear. Không nhận ra thì 400.
export function normalizeIssueId(input) {
  const text = String(input ?? '').trim();
  const id = ID.test(text.toUpperCase()) ? text.toUpperCase() : parseIssueRef(text);
  if (!id || !ID.test(id)) throw Object.assign(new Error('Mã issue không đúng dạng ENG-123 hoặc link Linear'), { status: 400 });
  return id;
}

// Gộp danh sách vừa lấy từ Linear vào danh sách đã lưu.
// - Issue vẫn khớp: lấy dữ liệu mới, giữ testcase, thời điểm phân tích, đường dẫn file đã Gen.
// - Issue tự động không còn khớp: giữ nếu đã có testcase hoặc đã Gen; còn lại bỏ.
// - Issue nhập tay: luôn giữ.
export function mergeRefresh(current, fetched, now = new Date().toISOString()) {
  const old = new Map(current.map((i) => [i.identifier, i]));
  const seen = new Set();
  const items = fetched.map((f) => {
    seen.add(f.identifier);
    const prev = old.get(f.identifier);
    return {
      ...prev,
      ...f,
      source: prev?.source ?? 'auto',
      testcases: prev?.testcases ?? null,
      analyzedAt: prev?.analyzedAt ?? null,
      generatedPath: prev?.generatedPath ?? null,
      refreshedAt: now,
    };
  });
  for (const i of current) {
    if (seen.has(i.identifier)) continue;
    if (i.source === 'manual' || i.testcases?.length || i.generatedPath) items.push(i);
  }
  return items;
}

export async function readIssues(root) {
  const s = await readState(root, FILE, null);
  const items = Array.isArray(s?.items) ? s.items.filter((i) => i && typeof i === 'object' && ID.test(i.identifier)) : [];
  return { items, fetchedAt: typeof s?.fetchedAt === 'string' ? s.fetchedAt : null };
}

const save = (root, data) => writeState(root, FILE, data);

// Lấy lại danh sách theo email và status đã lưu trong settings. Lỗi Linear thì không ghi gì.
export function refreshIssues({ root, client, settings, now = new Date().toISOString() }) {
  return serial(`${root}:${FILE}`, async () => {
    const fetched = await client.listAssigned({ emails: settings.emails, statuses: settings.statuses });
    const current = (await readIssues(root)).items;
    const data = { items: mergeRefresh(current, fetched, now), fetchedAt: now };
    await save(root, data);
    return data;
  });
}

// Thêm tay một issue theo mã. Đã có thì không thêm lần nữa.
export function addManualIssue({ root, client, id }) {
  return serial(`${root}:${FILE}`, async () => {
    const identifier = normalizeIssueId(id);
    const found = await client.get(identifier);
    if (!found) throw Object.assign(new Error(`Không thấy issue ${identifier} trên Linear`), { status: 404 });
    const { items, fetchedAt } = await readIssues(root);
    const existing = items.find((i) => i.identifier === identifier);
    if (existing) return existing;
    const item = {
      identifier,
      title: found.title,
      url: found.url,
      state: found.state?.name ?? '',
      assignee: found.assignee?.email ?? '',
      source: 'manual',
      testcases: null,
      analyzedAt: null,
      generatedPath: null,
    };
    await save(root, { items: [...items, item], fetchedAt });
    return item;
  });
}
