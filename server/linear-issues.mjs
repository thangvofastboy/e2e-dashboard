// Danh sách issue Linear của project: lấy theo email và status, thêm tay, merge khi refresh, lưu trong
// .e2e-dashboard/linear-issues.json. Phần thuần (chuẩn hoá, merge) tách riêng để test không cần mạng.
import { parseIssueRef } from './linear.mjs';
import { readState, writeState, serial } from './jsonstate.mjs';
import { buildAnalyzePrompt, parseTestcases, normalizeTestcase, buildGenPrompt, parseGenerated } from './linear-tests.mjs';
import { writeNewTest, testFiles } from './aiextra.mjs';
import { readSettings } from './settings.mjs';

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

const ITEM = /^\/api\/linear\/issues\/([A-Z][A-Z0-9]{1,9}-\d{1,7})\/(analyze|testcases|gen)$/;

// Route của tính năng Issue Linear. Trả null khi đường dẫn không thuộc tính năng này.
// Lỗi có status (400 / 404 / 409 / 502) đi ra đúng mã; lỗi khác để app.mjs xử lý như 500.
export function createLinearIssuesApi({ projectRoot, linearBackend, runAi, settings = readSettings }) {
  const client = async () => {
    const lin = await linearBackend();
    if (!lin.client) throw Object.assign(new Error('Chưa có Linear: nhập LINEAR_API_KEY ở Cài đặt hệ thống → Tích hợp, hoặc đăng nhập MCP Linear cho Claude CLI.'), { status: 400 });
    return lin.client;
  };
  const current = async (id) => {
    const item = (await readIssues(projectRoot)).items.find((i) => i.identifier === id);
    if (!item) throw Object.assign(new Error(`Issue ${id} chưa có trong danh sách`), { status: 404 });
    return item;
  };
  const patch = (identifier, change) =>
    serial(`${projectRoot}:${FILE}`, async () => {
      const { items, fetchedAt } = await readIssues(projectRoot);
      await save(projectRoot, { items: items.map((i) => (i.identifier === identifier ? { ...i, ...change } : i)), fetchedAt });
    });

  const route = async (req, p, method, readBody) => {
    if (p === '/api/linear/issues' && method === 'GET') return { status: 200, body: await readIssues(projectRoot) };
    if (p === '/api/linear/issues/refresh' && method === 'POST') {
      const body = await refreshIssues({ root: projectRoot, client: await client(), settings: await settings(projectRoot) });
      return { status: 200, body };
    }
    if (p === '/api/linear/issues/add' && method === 'POST') {
      const body = await readBody(req);
      const id = normalizeIssueId(body.id); // mã sai báo ngay, không cần chờ kiểm tra cấu hình Linear
      return { status: 200, body: await addManualIssue({ root: projectRoot, client: await client(), id }) };
    }
    const m = ITEM.exec(p);
    if (!m) return null;
    const [, id, action] = m;

    if (action === 'analyze' && method === 'POST') {
      const linear = await client();
      await current(id);
      const issue = await linear.getWithComments(id);
      if (!issue) throw Object.assign(new Error(`Không thấy issue ${id} trên Linear`), { status: 404 });
      // chỉ trả đề xuất: người dùng sửa rồi mới lưu
      return { status: 200, body: { testcases: parseTestcases(await runAi(buildAnalyzePrompt({ issue }))) } };
    }
    if (action === 'testcases' && method === 'POST') {
      await current(id);
      const body = await readBody(req);
      if (!Array.isArray(body.testcases) || !body.testcases.length || body.testcases.length > 50) throw Object.assign(new Error('Cần từ 1 đến 50 testcase'), { status: 400 });
      const testcases = body.testcases.map((t, i) => normalizeTestcase(t, i));
      await patch(id, { testcases, analyzedAt: new Date().toISOString() });
      return { status: 200, body: { testcases } };
    }
    if (action === 'gen' && method === 'POST') {
      const item = await current(id);
      if (!item.testcases?.length) throw Object.assign(new Error('Lưu testcase trước khi Gen'), { status: 400 });
      const prompt = buildGenPrompt({ issue: item, testcases: item.testcases, testFiles: await testFiles(projectRoot) });
      const { path, code } = parseGenerated(await runAi(prompt), id);
      const saved = await writeNewTest(projectRoot, path, code);
      await patch(id, { generatedPath: saved.saved });
      return { status: 200, body: saved };
    }
    return null;
  };
  // lỗi có status (400/404/409/502) thành response, để mã trả về khớp với đường dẫn; lỗi lạ vẫn ném tiếp
  return async (...args) => {
    try {
      return await route(...args);
    } catch (e) {
      if (e.status) return { status: e.status, body: { error: e.message } };
      throw e;
    }
  };
}
