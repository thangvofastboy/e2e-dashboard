// Route của tính năng Record: ghi thao tác bằng codegen → testcase (AI sinh expected) → lưu .spec.ts → tuỳ chọn AI Gen .e2e.ts.
// Trả null khi đường dẫn không thuộc tính năng này. Lỗi có status (400 / 404 / 409 / 502) đi ra đúng mã; lỗi khác để app.mjs xử lý như 500.
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isLink } from '../reporter/e2e-dashboard.reporter.mjs';
import { serial } from './jsonstate.mjs';
import { testFiles, writeNewTest } from './aiextra.mjs';
import { normalizeTestcase } from './linear-tests.mjs';
import { slugify } from './recorder-spec.mjs';
import { cookieState, parseCookieHeader } from './recorder-cookie.mjs';
import { createPreparer } from './recorder-prepare-ai.mjs';
import { redactSpec } from './recorder-redact.mjs';
import { createRecorder, validateRecordUrl } from './recorder-session.mjs';
import { RECORDED_DIR, RECORDED_SPEC_PATH, buildE2ePrompt, buildExpectedPrompt, defaultTestcase, parseE2e, parseExpected, recordedE2ePath, recordedSpecPath } from './recorder-ai.mjs';

const MAX_TESTCASES = 50;
const SLUG = /^[a-z0-9-]{1,60}$/;
const CASES_PATH = /^tests\/recorded\/[a-z0-9-]{1,60}\.cases\.json$/;
const casesPathOf = (slug) => `${RECORDED_DIR}/${slug}.cases.json`;
const fail = (status, message) => Object.assign(new Error(message), { status });

const nameOf = (v) => {
  const n = typeof v === 'string' ? v.trim().slice(0, 200) : '';
  if (!n || !slugify(n)) throw fail(400, 'Tên không hợp lệ: cần ít nhất một chữ cái hoặc số');
  return n;
};
// URL người dùng nhập cũng có thể chứa token trong query: che giống bước goto
const shownUrl = (url) => redactSpec(`await page.goto(${JSON.stringify(url)});`).steps[0]?.value ?? '';
// trạng thái gửi ra ngoài: url đang ghi cũng bị che token
const publicStatus = (st) => (st?.url ? { ...st, url: shownUrl(st.url) } : st);

export function createRecorderApi({ projectRoot, runAi, recorder = createRecorder({ projectRoot }), preparer = createPreparer({ projectRoot, saveAuth: (name, state) => recorder.saveAuth(name, state) }) }) {
  const finished = () => {
    const r = recorder.result();
    if (!r) throw fail(400, 'Chưa có phiên record nào hoàn tất: ghi lại thao tác trước');
    return r;
  };

  async function analyze() {
    const r = finished();
    const { steps, secrets } = redactSpec(r.specText);
    const url = shownUrl(r.url);
    const caseSteps = steps.length ? steps : [{ kind: 'goto', text: `Mở trang ${url}` }];
    let testcases;
    let aiError;
    try {
      testcases = parseExpected(await runAi(buildExpectedPrompt({ name: r.name, url, steps: caseSteps })));
    } catch (e) {
      aiError = e.message;
      testcases = [defaultTestcase(r.name, caseSteps)];
    }
    return { name: r.name, url, slug: slugify(r.name), testcases, secrets, ...(aiError ? { aiError } : {}) };
  }

  async function save(body) {
    const r = finished();
    if (!Array.isArray(body.testcases) || !body.testcases.length || body.testcases.length > MAX_TESTCASES) throw fail(400, `Cần từ 1 đến ${MAX_TESTCASES} testcase`);
    const testcases = body.testcases.map((t, i) => normalizeTestcase(t, i));
    const name = body.name === undefined ? r.name : nameOf(body.name);
    const slug = slugify(name);
    const { spec, secrets } = redactSpec(r.specText);
    const specPath = recordedSpecPath(slug);
    const casesPath = casesPathOf(slug);
    await serial(`${projectRoot}:record:${slug}`, async () => {
      for (const rel of [specPath, casesPath]) if (existsSync(join(projectRoot, rel))) throw fail(409, `${rel} đã tồn tại: đổi tên rồi lưu lại`);
      await writeNewTest(projectRoot, specPath, spec, RECORDED_SPEC_PATH);
      const cases = { name, url: shownUrl(r.url), recordedAt: new Date().toISOString(), testcases, specPath, e2ePath: null, auth: r.auth ?? null };
      try {
        await writeNewTest(projectRoot, casesPath, JSON.stringify(cases, null, 2), CASES_PATH);
      } catch (e) {
        await rm(join(projectRoot, specPath), { force: true }); // không để lại spec nửa vời
        throw e;
      }
    });
    recorder.clear();
    return { specPath, casesPath, secrets };
  }

  async function genE2e(body) {
    if (typeof body.slug !== 'string' || !SLUG.test(body.slug)) throw fail(400, 'slug không hợp lệ');
    const slug = body.slug;
    const casesFull = join(projectRoot, casesPathOf(slug));
    if (!existsSync(casesFull)) throw fail(404, `Chưa có testcase đã lưu cho ${slug}`);
    if (isLink(casesFull)) throw fail(400, `${casesPathOf(slug)} là symlink: không ghi qua symlink`);
    let cases;
    try {
      cases = JSON.parse(await readFile(casesFull, 'utf8'));
    } catch {
      throw fail(400, `Không đọc được ${casesPathOf(slug)}`);
    }
    const testcases = Array.isArray(cases.testcases) ? cases.testcases.map((t, i) => normalizeTestcase(t, i)) : [];
    if (!testcases.length) throw fail(400, 'Không có testcase để Gen');
    const e2ePath = recordedE2ePath(slug);
    if (existsSync(join(projectRoot, e2ePath))) throw fail(409, `${e2ePath} đã tồn tại: giữ file cũ`); // chặn trước khi tốn một lượt AI
    const text = await runAi(buildE2ePrompt({ name: String(cases.name ?? slug), slug, url: cases.url, auth: cases.auth, testcases, testFiles: await testFiles(projectRoot) }));
    const { path, code } = parseE2e(text, slug);
    const saved = await writeNewTest(projectRoot, path, code);
    await serial(`${projectRoot}:record:${slug}`, () => writeFile(casesFull, `${JSON.stringify({ ...cases, e2ePath: saved.saved }, null, 2)}\n`));
    return { saved: saved.saved };
  }

  const route = async (req, p, method, readBody) => {
    if (!p.startsWith('/api/record/')) return null;
    const action = p.slice('/api/record/'.length);
    if (method === 'GET' && action === 'status') return { status: 200, body: publicStatus(recorder.status()) };
    if (method === 'GET' && action === 'auth') return { status: 200, body: { sessions: recorder.listAuth() } }; // chỉ tên + thời điểm lưu
    if (method !== 'POST') return null;
    switch (action) {
      case 'start': {
        const body = await readBody(req);
        const url = validateRecordUrl(body?.url);
        const auth = body?.auth;
        if (auth !== undefined && auth !== null && typeof auth !== 'string') throw fail(400, 'Tên phiên đăng nhập không hợp lệ');
        return { status: 200, body: await recorder.start({ url, name: nameOf(body?.name), ...(auth ? { auth } : {}) }) };
      }
      case 'login': {
        const body = await readBody(req);
        const url = validateRecordUrl(body?.url);
        return { status: 200, body: await recorder.login({ url, name: nameOf(body?.name) }) };
      }
      case 'prepare': {
        // dựng phiên từ chuỗi Cookie (DevTools) và/hoặc link đăng nhập một lần: không qua AI, cookie không bao giờ đi ra khỏi máy này
        const body = (await readBody(req)) ?? {};
        const slug = slugify(nameOf(body.name));
        const url = validateRecordUrl(body.url);
        for (const k of ['cookie', 'link']) if (body[k] !== undefined && body[k] !== null && typeof body[k] !== 'string') throw fail(400, `${k} phải là chuỗi`);
        const hasCookie = Boolean(body.cookie?.trim());
        const hasLink = Boolean(body.link?.trim());
        if (!hasCookie && !hasLink) throw fail(400, 'Cần dán cookie hoặc link đăng nhập một lần');
        const cookies = hasCookie ? cookieState(parseCookieHeader(body.cookie), url).cookies : [];
        if (hasLink) await recorder.prepareLink({ name: slug, url, link: validateRecordUrl(body.link.trim()), cookies });
        else recorder.saveAuth(slug, { cookies, origins: [] });
        return { status: 200, body: { name: slug, sessions: recorder.listAuth() } };
      }
      case 'prepare-ai': {
        // AI chuẩn bị phiên theo prompt tự do: agent của runner `e2e` lái trình duyệt ẩn; bí mật chỉ là handle {{E2E_…}} lấy từ .env / môi trường
        const body = (await readBody(req)) ?? {};
        const slug = slugify(nameOf(body.name));
        const url = validateRecordUrl(body.url);
        if (typeof body.prompt !== 'string' || !body.prompt.trim()) throw fail(400, 'Cần viết prompt cho AI');
        const out = await preparer.run({ name: slug, url, prompt: body.prompt });
        return { status: 200, body: { name: out.name, sessions: recorder.listAuth() } };
      }
      case 'auth/delete': {
        const body = await readBody(req);
        if (typeof body?.name !== 'string') throw fail(400, 'Thiếu tên phiên đăng nhập');
        recorder.removeAuth(body.name);
        return { status: 200, body: { sessions: recorder.listAuth() } };
      }
      case 'stop': return { status: 200, body: publicStatus(await recorder.stop()) };
      case 'discard': recorder.clear(); return { status: 200, body: publicStatus(recorder.status()) }; // "Bỏ": không để phiên done hiện lại khi vào lại trang
      case 'analyze': return { status: 200, body: await analyze() };
      case 'save': return { status: 200, body: await save((await readBody(req)) ?? {}) };
      case 'gen-e2e': return { status: 200, body: await genE2e((await readBody(req)) ?? {}) };
      default: return null;
    }
  };
  return async (...args) => {
    try {
      return await route(...args);
    } catch (e) {
      if (e.status) return { status: e.status, body: { error: e.message } };
      throw e;
    }
  };
}
