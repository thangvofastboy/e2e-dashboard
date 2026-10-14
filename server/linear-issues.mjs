// Danh sách issue Linear của project: lấy theo email và status, thêm tay, merge khi refresh, lưu trong
// .e2e-dashboard/linear-issues.json. Phần thuần (chuẩn hoá, merge) tách riêng để test không cần mạng.
import { parseIssueRef } from './linear.mjs';

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
