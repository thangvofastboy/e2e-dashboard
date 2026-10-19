# Record thao tác → testcase → test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người dùng record thao tác trên browser bằng `playwright-core codegen`, dashboard đổi thành testcase (AI sinh `expected`), cho sửa, lưu `tests/recorded/<slug>.spec.ts`, tuỳ chọn AI Gen `*.e2e.ts`.

**Architecture:** Các hàm thuần (parse, che nhạy cảm, prompt) tách file riêng để unit test; một module quản lý phiên codegen (spawn inject được); một module route theo mẫu `createLinearIssuesApi` gắn vào `server/app.mjs`; một trang UI mới `#/record` dùng lại thẻ sửa testcase của trang Issue Linear.

**Tech Stack:** Node ESM (`.mjs`), `node:test`, `playwright-core` 1.64 trong `node_modules` của project, `createAi` (`claude -p`) qua `runAi`, UI vanilla JS bundle bằng `ui/bundle.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-19-record-to-test-design.md`

## Global Constraints

- Lưu ở `tests/recorded/<slug>.spec.ts` + `<slug>.cases.json`; `.e2e.ts` cùng slug cạnh chúng. `slug` chỉ `[a-z0-9-]`, tối đa 60 ký tự.
- Không ghi đè file đã có: 409. Phiên `done` giữ lại sau 409 để đổi tên lưu lại.
- Chạy `node_modules/playwright-core/cli.js codegen --target playwright-test -o <tmp>`; không dùng `npx`.
- `url` chỉ http/https. Mọi đường dẫn ghi file ép trong `tests/recorded/`.
- Không lưu và không gửi cho AI mật khẩu/token thật: giá trị nhạy cảm thành `process.env.E2E_SECRET_<n>` trong spec, `«ẩn»` trong testcase. Không chắc thì che.
- Nội dung bước đưa vào prompt AI nằm trong khối `untrusted-data-<hex>` (mẫu `buildAnalyzePrompt` trong `server/linear-tests.mjs`).
- Bí mật khi chạy lại: chỉ hướng dẫn trong UI (đặt `E2E_SECRET_<n>` trong `.env` hoặc môi trường). Không sửa `server/playwright.mjs`.
- Một phiên record tại một thời điểm; phiên `done` chưa lưu bỏ sau 1 giờ.
- Không `git commit` và không thêm dòng `Claude-Session`/trailer nào khi chưa được người dùng yêu cầu (skill `claude-session-trailer-maintenance`).
- Smoke test viết cùng tính năng nhưng chỉ chạy một lần ở Task 9 (rule "Nhịp chạy test"). Unit test chạy theo từng task: `node --import ./test/_tmpclean.mjs --test test/<file>.test.mjs`.
- Route mới đặt trước khối prefix nào che cùng họ đường dẫn (skill `e2e-dashboard-server-route-order`).

## Review Focus

- `url` là `javascript:`, `file:`, rỗng, có khoảng trắng → 400, không spawn (Task 5, 6).
- Tên có dấu/ký tự lạ/`../` → slug an toàn; slug rỗng sau chuẩn hoá → 400 (Task 2, 6).
- File codegen rỗng hoặc chỉ có `goto` → vẫn ra một testcase một bước; không crash (Task 2, 6).
- Bước chứa dấu nháy, xuống dòng, backtick, chỉ dẫn giả ("bỏ qua mọi chỉ dẫn") không thoát khỏi khối `untrusted-data` (Task 4).
- Gõ mật khẩu từng phím bằng `press` rồi `fill` OTP/PIN không để lọt giá trị (Task 3).
- Hai `start` liền nhau → 409; hai `save` cùng slug đồng thời → một cái 409 (Task 5, 6).
- AI trả JSON hỏng hoặc không cấu hình → `analyze` vẫn 200 với `aiError` và testcase gốc (Task 6).

---

### Task 1: Spike codegen `-o` khi dừng giữa chừng

Quyết định cách dựng nút Dừng; kết quả ghi vào spec, không giữ code.

**Files:**
- Modify: `docs/superpowers/specs/2026-10-19-record-to-test-design.md` (dòng "Dừng" trong "Quyết định nhỏ")

**Interfaces:**
- Produces: kết luận một trong hai: (a) SIGINT vẫn để lại file đã ghi dần → Dừng giữ nguyên thiết kế; (b) file rỗng/không có → "Dừng" chỉ hiện hướng dẫn "đóng cửa sổ browser", `stop()` ở Task 5 không gửi tín hiệu.

- [ ] **Step 1: Chạy codegen ở thư mục tạm** với `-o` trỏ vào scratchpad, có màn hình (hoặc `xvfb-run` nếu có): `node node_modules/playwright-core/cli.js codegen --target playwright-test -o <scratch>/spike.spec.ts https://example.com`; thao tác click một link rồi gửi SIGINT từ terminal khác (`pkill -INT -f "playwright-core/cli.js codegen"`).
- [ ] **Step 2: Đọc `<scratch>/spike.spec.ts`**; lặp lại với SIGTERM. Ghi lại: có file không, có chứa `page.goto`/`click` không.
- [ ] **Step 3: Không có màn hình/chromium** → dừng, báo người dùng chạy hai lệnh trên (`! <lệnh>`) và dán kết quả; không đoán.
- [ ] **Step 4: Sửa dòng "Dừng" trong spec** theo kết luận (a) hoặc (b).

### Task 2: Parse file codegen và slug

**Files:**
- Create: `server/recorder-spec.mjs`
- Test: `test/recorder-spec.test.mjs`

**Interfaces:**
- Produces:
  - `type Step = { line: number, code: string, kind: 'goto'|'click'|'dblclick'|'fill'|'press'|'check'|'uncheck'|'selectOption'|'setInputFiles'|'expect'|'other', locator: string|null, value: string|null, text: string }` — `line` là chỉ số dòng trong file gốc, `code` là dòng gốc đã trim, `locator` là nguyên văn biểu thức locator (vd `getByRole('button', { name: 'Đăng nhập' })`), `text` là câu mô tả tiếng Việt.
  - `parseSpec(text: string): { url: string|null, steps: Step[] }` — `url` là đối số của `page.goto` đầu tiên.
  - `slugify(name: string): string` — bỏ dấu tiếng Việt (đ→d), chữ thường, ký tự ngoài `[a-z0-9]` thành `-`, gộp và cắt `-` đầu/cuối, tối đa 60; có thể trả `''`.

- [ ] **Step 1: Viết test (thất bại)** trong `test/recorder-spec.test.mjs`:
  - `parseSpec: mỗi loại lệnh` — spec mẫu có `await page.goto('https://a.test/');`, `await page.getByRole('button', { name: 'Đăng nhập' }).click();` → `kind:'click'`, `text` chứa `Đăng nhập`; `fill('x@y.z')` → `value:'x@y.z'`; `press('Enter')`; `check`, `uncheck`, `selectOption('vi')`, `setInputFiles('a.png')`, `await expect(page.getByText('Xin chào')).toBeVisible();` → `kind:'expect'`; `dblclick`.
  - `parseSpec: lệnh lạ thành other` — `await page.waitForTimeout(500);` → `kind:'other'`, `text` bắt đầu `Thao tác: `, `code` giữ nguyên.
  - `parseSpec: bỏ dòng import/test()/}); và dòng trống`; `parseSpec('')` → `{url:null, steps:[]}`.
  - `parseSpec: chuỗi có dấu nháy kép/escape` — `fill('a\'b')` → `value:"a'b"`.
  - `slugify` — `'Đăng nhập Admin!'` → `'dang-nhap-admin'`; `'../etc/passwd'` → `'etc-passwd'`; `'!!!'` → `''`; chuỗi 100 ký tự → độ dài ≤ 60.
- [ ] **Step 2: Chạy** `node --import ./test/_tmpclean.mjs --test test/recorder-spec.test.mjs` → FAIL (module chưa có).
- [ ] **Step 3: Implement** `parseSpec`, `slugify` trong `server/recorder-spec.mjs`. Parse theo dòng bằng regex trên `await page.<locator>.<action>(...)`; không dùng AST. Câu mô tả: `getByRole(role, {name})` → `Bấm nút "<name>"` cho button/link tương ứng, `getByLabel/getByPlaceholder/getByText/locator` → dùng nguyên văn tên; mô tả chi tiết do builder chọn miễn test trên qua.
- [ ] **Step 4: Chạy lại** → PASS.

### Task 3: Che nhạy cảm

**Files:**
- Create: `server/recorder-redact.mjs`
- Test: `test/recorder-redact.test.mjs`

**Interfaces:**
- Consumes: `parseSpec`, `Step` từ Task 2.
- Produces: `redactSpec(text: string): { spec: string, steps: Step[], secrets: string[] }` — `spec` là file đã che (giữ nguyên dòng không đổi, thay dòng bị che bằng `process.env.E2E_SECRET_<n>`), `steps` là bước đã che (`value` = `«ẩn»`, `text` không chứa giá trị gốc), `secrets` là danh sách tên biến đã dùng (`['E2E_SECRET_1', …]`, đánh số theo thứ tự xuất hiện).

- [ ] **Step 1: Viết test (thất bại)** — mỗi ca một `test()`, assert `spec` và `steps` đều không chứa chuỗi bí mật mẫu `S3cr3t!`:
  - `fill` vào locator có `password`, `mật khẩu`, `otp`, `pin`, `cvv`, `card`, `secret`, `token`, `api key` (không phân biệt hoa thường) → che.
  - Chuỗi `press('S')…press('!')` từng phím vào ô nhạy cảm → gộp thành một bước `fill` che, `secrets.length===1`.
  - `goto('https://a.test/cb?token=abc&page=2')` → `token` bị che, `page=2` giữ.
  - `expect(page.getByLabel('Password')).toHaveValue('S3cr3t!')` → che giá trị.
  - `setInputFiles('/home/u/secret/a.png')` → chỉ còn `a.png`.
  - `fill` vào ô thường (`Email`) không bị che; giá trị trông như khoá (`sk-ant-…`, chuỗi ≥ 32 ký tự hex/base64) bị che dù ô tên thường.
  - Không có gì nhạy cảm → `spec === text`, `secrets` rỗng.
- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Implement** `redactSpec` trong `server/recorder-redact.mjs`: nhận diện theo tên locator + mẫu giá trị; gộp `press` liên tiếp cùng locator nhạy cảm; hằng số regex đặt đầu file với tên rõ nghĩa.
- [ ] **Step 4: Chạy lại** → PASS.

### Task 4: Prompt và parse câu trả lời AI

**Files:**
- Create: `server/recorder-ai.mjs`
- Test: `test/recorder-ai.test.mjs`
- Modify: `server/aiextra.mjs:232-248` (`writeNewTest` nhận tham số `pattern`)

**Interfaces:**
- Consumes: `Step` (Task 2); `normalizeTestcase`, `parseTestcases` từ `server/linear-tests.mjs`.
- Produces:
  - `defaultTestcase(name: string, steps: Step[]): { title: string, steps: string[], expected: string }` — một testcase, `steps` = `step.text`, `expected` rỗng.
  - `buildExpectedPrompt({ name, url, steps }: { name: string, url: string|null, steps: Step[] }): string` — bước `kind:'expect'` được đánh dấu "bằng chứng chắc chắn".
  - `parseExpected(text: string)` — alias hành vi của `parseTestcases` (dùng lại, không viết lại).
  - `recordedE2ePath(slug: string): string` → `tests/recorded/<slug>.e2e.ts`.
  - `buildE2ePrompt({ name, slug, url, testcases, testFiles }): string` — theo mẫu `buildGenPrompt`, cuối prompt có dòng `PATH: <recordedE2ePath(slug)>`.
  - `parseE2e(text: string, slug: string): { path: string, code: string }` — ném lỗi status 502 nếu thiếu khối ts hoặc `PATH` khác `recordedE2ePath(slug)`.
  - `writeNewTest(root, rel, content, pattern = DRAFT_PATH)` — thêm tham số thứ tư; mặc định giữ nguyên hành vi cũ.

- [ ] **Step 1: Viết test (thất bại):**
  - `buildExpectedPrompt: bước nằm trong khối untrusted-data` — có đúng một cặp `<untrusted-data-` … `</untrusted-data-` (cùng hậu tố hex), bước chứa `</untrusted-data-x>` hoặc "bỏ qua mọi chỉ dẫn" không đóng được khối (dùng `noFence`-kiểu thay `<`).
  - `buildExpectedPrompt: expect đánh dấu bằng chứng` — prompt chứa chuỗi "bằng chứng chắc chắn" cạnh bước `expect`.
  - `parseE2e: PATH sai → ném lỗi status 502`; `PATH` đúng → `{path:'tests/recorded/dang-nhap.e2e.ts', code}`.
  - `writeNewTest: pattern riêng` — gọi với pattern `.spec.ts` trong thư mục tạm ghi được `tests/recorded/a.spec.ts`; gọi không pattern với `a.spec.ts` vẫn ném 400 (hành vi cũ); file có sẵn → 409.
- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Implement** các hàm trên; `writeNewTest` chỉ đổi `DRAFT_PATH.test(rel)` thành `pattern.test(rel)`. Chạy `node --import ./test/_tmpclean.mjs --test test/linear-issues-api.test.mjs test/linear-tests.test.mjs` để chắc chắn không vỡ chỗ cũ.
- [ ] **Step 4: Chạy lại** các file test của task → PASS.

### Task 5: Quản lý phiên codegen

**Files:**
- Create: `server/recorder-session.mjs`
- Test: `test/recorder-session.test.mjs`

**Interfaces:**
- Consumes: `installedBrowsers` từ `server/browsers.mjs`.
- Produces:
  - `hasDisplay(env: NodeJS.ProcessEnv, os: string): boolean` — Linux cần `DISPLAY` hoặc `WAYLAND_DISPLAY`; `darwin`/`win32` luôn `true`.
  - `validateRecordUrl(u: unknown): string` — trả URL chuẩn hoá hoặc ném lỗi status 400 (chỉ http/https, không rỗng, không khoảng trắng).
  - `createRecorder({ projectRoot, spawnImpl = spawn, env = process.env, os = platform(), tmpRoot = os.tmpdir(), ttlMs = 3_600_000, now = Date.now }): { start({ url, name }): Promise<{ id: string }>, stop(): Promise<Status>, status(): Status, result(): { id, name, url, specText } | null, clear(): void, close(): void }`
  - `type Status = { state: 'idle'|'recording'|'done'|'failed', canRecord: boolean, reason: string|null, id?: string, name?: string, url?: string, error?: string }`
- Hành vi: `start` ném 400 nếu không có màn hình (`reason` nêu rõ), thiếu `playwright-core/cli.js`, hoặc `installedBrowsers().chromium === false` (kèm lệnh cài `npx @e2e-dev/web install chromium`); 409 nếu đang `recording`. Tiến trình thoát mã 0 và file không rỗng → `done` (đọc `specText`); ngược lại `failed` với stderr rút gọn ≤ 300 ký tự. `stop` theo kết luận Task 1. `close()` kill tiến trình con và xoá thư mục tạm; phiên `done` quá `ttlMs` coi như `idle`.

- [ ] **Step 1: Viết test (thất bại)** với `spawnImpl` giả (EventEmitter có `kill`, `stderr`; script ghi file `-o` rồi emit `close`):
  - `validateRecordUrl`: `javascript:alert(1)`, `file:///etc/passwd`, `''`, `'a b'` → ném status 400; `'https://a.test'` → ok.
  - `start` không có `DISPLAY` (Linux) → 400, spawn không được gọi; `status().canRecord === false` kèm `reason`.
  - `start` hai lần → lần hai 409.
  - Spawn giả ghi spec rồi thoát 0 → `status().state==='done'` và `result().specText` đúng; thoát 1 + stderr → `failed`, `error` chứa stderr.
  - File rỗng, mã 0 → `failed`.
  - `ttlMs` hết (inject `now`) → `status().state==='idle'`, `result()===null`.
  - `close()` gọi `kill` và xoá thư mục tạm.
  - argv spawn chứa `codegen`, `--target`, `playwright-test`, `-o`, URL; không chứa `npx`.
- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Implement** theo Interfaces; argv truyền dạng mảng (không qua shell), URL phải qua `validateRecordUrl` trước khi spawn.
- [ ] **Step 4: Chạy lại** → PASS.

### Task 6: Route `/api/record/*`

**Files:**
- Create: `server/recorder-api.mjs`
- Modify: `server/app.mjs:327` và `server/app.mjs:384` (tạo và gọi `recorderApi` ngay cạnh `linearIssuesApi`)
- Test: `test/recorder-api.test.mjs`

**Interfaces:**
- Consumes: `createRecorder` (Task 5), `redactSpec` (Task 3), `parseSpec`/`slugify` (Task 2), `defaultTestcase`/`buildExpectedPrompt`/`parseExpected`/`buildE2ePrompt`/`parseE2e`/`recordedE2ePath`/`writeNewTest` (Task 4), `normalizeTestcase`, `testFiles` từ `server/aiextra.mjs`.
- Produces: `createRecorderApi({ projectRoot, runAi, recorder = createRecorder({ projectRoot }) }): (req, p, method, readBody) => Promise<{status, body}|null>` — cùng khuôn lỗi như `createLinearIssuesApi` (lỗi có `status` thành response, đường dẫn lạ trả `null`). Route:
  - `GET /api/record/status` → `Status`
  - `POST /api/record/start` `{url, name}` → `{id}`; `name` rỗng/slug rỗng → 400
  - `POST /api/record/stop` → `Status`
  - `POST /api/record/analyze` → `{ name, url, slug, testcases, secrets, aiError? }` (400 nếu không có phiên `done`). Lỗi AI/không parse được → vẫn 200 với `defaultTestcase` và `aiError`.
  - `POST /api/record/save` `{ testcases, name? }` → `{ specPath, casesPath, secrets }`; 1–50 testcase qua `normalizeTestcase`; ghi spec đã che bằng `writeNewTest(..., /^tests\/recorded\/[a-z0-9-]{1,60}\.spec\.ts$/)` rồi `cases.json` (`wx`); một trong hai đã có → 409 và không để lại file nửa vời; thành công → `recorder.clear()`.
  - `POST /api/record/gen-e2e` `{ slug }` → `{ saved }`; slug phải khớp `^[a-z0-9-]{1,60}$`; thiếu `cases.json` → 404; `.e2e.ts` đã có → 409; cập nhật `e2ePath` trong `cases.json`.
  - `app.mjs`: gọi `recorderApi` khi `p.startsWith('/api/record/')`, đặt cạnh khối `/api/linear/issues`, và thêm `recorder.close()` vào đường tắt server nếu app có hook tắt.

- [ ] **Step 1: Viết test (thất bại)** với `recorder` giả (`status`, `start`, `stop`, `result`, `clear`) và `runAi` giả, thư mục tạm làm `projectRoot`:
  - Đường dẫn ngoài `/api/record/` → `null`.
  - `start` url `javascript:x` → 400; tên `'!!!'` → 400.
  - `analyze` khi `result()` null → 400; khi có phiên với spec chứa `fill('S3cr3t!')` vào ô Password → `testcases` và JSON trả về không chứa `S3cr3t!`, `secrets` có `E2E_SECRET_1`; prompt đưa cho `runAi` cũng không chứa `S3cr3t!`.
  - `analyze` khi `runAi` ném lỗi hoặc trả rác → 200, `aiError` có giá trị, `testcases[0].steps.length>0`.
  - `analyze` với spec rỗng/chỉ `goto` → một testcase một bước.
  - `save` ghi hai file đúng nội dung, spec đã che; lần hai cùng slug → 409 và `recorder.clear` chưa được gọi; `testcases: []` hoặc 51 → 400; `name:'../x'` không ghi ra ngoài `tests/recorded/`.
  - Hai `save` song song cùng slug (`Promise.all`) → đúng một 200 và một 409.
  - `gen-e2e`: thiếu `cases.json` → 404; thành công ghi `tests/recorded/<slug>.e2e.ts` và `cases.json.e2ePath` được cập nhật; gọi lần hai → 409; `PATH` AI sai → 502; slug `'../x'` → 400.
- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Implement** `createRecorderApi` và nối vào `server/app.mjs`; `runAi` là `runAiText` có sẵn trong `app.mjs`. Dùng `serial(key, fn)` từ `server/jsonstate.mjs` quanh bước save để chặn ghi đồng thời.
- [ ] **Step 4: Chạy** `node --import ./test/_tmpclean.mjs --test test/recorder-api.test.mjs test/app.test.mjs` → PASS. Gửi thử một request thật tới `/api/record/status` khi server dev chạy và kiểm tra mã 200 (không chỉ unit test).

### Task 7: Tách thẻ sửa testcase dùng chung

**Files:**
- Modify: `ui/views/linear-issues.js:29-62` (tách `tcCardsHtml`, `readTcCards`)
- Test: `test/linear-tc-editor.test.mjs` (giữ nguyên, phải vẫn qua)

**Interfaces:**
- Produces (export từ `ui/views/linear-issues.js`):
  - `tcCardsHtml(testcases: {title,steps,expected}[]): string` — đúng phần `<div class="tc-list">…</div>` mà `liEditorHtml` đang dựng (cùng class và `data-f`, `data-tc`, `data-tc-del`).
  - `readTcCards(main: Element): {title,steps,expected}[]` — chính là `liReadEditor` hiện tại, đổi tên và export; `liReadEditor` gọi lại nó.
  - `liEditorHtml` dùng `tcCardsHtml`; đầu ra HTML không đổi từng ký tự.

- [ ] **Step 1: Chạy** `node --import ./test/_tmpclean.mjs --test test/linear-tc-editor.test.mjs` → PASS (đường cơ sở).
- [ ] **Step 2: Refactor** thành hai hàm export; không thêm tính năng.
- [ ] **Step 3: Chạy lại** `linear-tc-editor.test.mjs` → vẫn PASS.

### Task 8: Trang UI Record

**Files:**
- Create: `ui/views/record.js`
- Modify: `ui/app.js:26` (import), `ui/app.js:61` (mục menu `['record', '#/record', 'Record', 'crosshair']`), `ui/app.js:71` (map `record: renderRecord`), `ui/app.js:73` (tiêu đề), `ui/app.js:468` (mô tả trang)
- Test: `test/record-ui.test.mjs`

**Interfaces:**
- Consumes: `tcCardsHtml`, `readTcCards` (Task 7); `getJson`, `postJson` từ `ui/api.js`; API Task 6.
- Produces: `renderRecord(main: Element): Promise<void>`; `recordViewHtml(state): string` (thuần, export để test) với `state = { status, editing: {slug, name, url, testcases, secrets, aiError}|null, saved: {specPath, casesPath, secrets}|null }`.
- Màn hình: (1) form URL + tên + nút Record (khoá kèm `status.reason` khi `canRecord` false); (2) đang ghi: chip "Đang ghi", nút Dừng, poll `/api/record/status` mỗi 1.5 giây tới khi hết `recording`; (3) `done` → tự gọi `analyze`, hiện `aiError` nếu có, thẻ testcase sửa được, ô tên (đổi khi 409), nút Lưu; (4) sau Lưu: đường dẫn file, danh sách `E2E_SECRET_<n>` kèm dòng "đặt giá trị trong `.env` hoặc môi trường", nút "AI Gen e2e"; (5) `failed` → thông báo lỗi và nút Record lại. Escape mọi nội dung bằng `escapeHtml`.

- [ ] **Step 1: Viết test (thất bại)** trên `recordViewHtml`:
  - `canRecord:false` → nút Record có `disabled` và hiện `reason`.
  - `state:'recording'` → có nút Dừng, không có form.
  - `editing` với `aiError` → hiện thông báo lỗi AI; testcase chứa `<b>` được escape; dùng `tcCardsHtml` (đủ 3 ô `data-f`).
  - `saved` với `secrets:['E2E_SECRET_1']` → chứa `E2E_SECRET_1` và nút `data-gen-e2e`; `saved` null → không có nút.
  - Bundle UI import được: `bundleUi` (dùng như `test/assets-gzip.test.mjs`) không ném lỗi và `/app.js` chứa `renderRecord`.
- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Implement** `ui/views/record.js` theo mẫu `renderLinearIssues` (một listener `click` uỷ quyền, `liBusy`-kiểu khoá nút + toast lỗi bỏ tiền tố mã HTTP; export lại nếu cần dùng chung từ `linear-issues.js`) và đăng ký trong `ui/app.js`.
- [ ] **Step 4: Chạy** `node --import ./test/_tmpclean.mjs --test test/record-ui.test.mjs test/linear-tc-editor.test.mjs` → PASS.

### Task 9: Smoke test và chạy toàn bộ

Viết smoke cùng lúc với Task 6, nhưng **chỉ chạy ở task này**, sau khi Task 1–8 xong.

**Files:**
- Create: `test/smoke-record.test.mjs`
- Modify: `README.md` (mục tính năng: Record, yêu cầu có màn hình, biến `E2E_SECRET_<n>`), `CHANGELOG.md` (mục chưa phát hành)

**Interfaces:**
- Consumes: `createApp({ projectRoot, token, uiDir, live, ai })` (xem skill `e2e-dashboard-smoke-tests`), header `x-e2e-dashboard-token`; `spawnImpl` giả cho recorder và `ai.run` giả.

- [ ] **Step 1: Viết smoke** (server thật in-process, `listen(0,'127.0.0.1')`, thư mục tạm): start (spawn giả ghi spec có `fill` mật khẩu `S3cr3t!`) → poll status tới `done` → analyze (AI giả trả JSON hợp lệ) → save → file `tests/recorded/<slug>.spec.ts` có `process.env.E2E_SECRET_1` và không có `S3cr3t!`; save lần hai → 409; gen-e2e (AI giả) → `.e2e.ts` xuất hiện; route danh sách test hiện có liệt kê file mới (grep `server/app.mjs` xác nhận tên route trước khi assert); `/app.js` chứa `renderRecord`.
- [ ] **Step 2: Chạy suite đầy đủ**: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖" | head` → `fail 0`.
- [ ] **Step 3: Kiểm tay trên máy có màn hình** (cần người dùng): mở `#/record`, record một thao tác thật, Dừng, sửa testcase, Lưu, chạy file `.spec.ts` bằng dashboard; báo rõ nếu bước này chưa làm.
- [ ] **Step 4: Cập nhật README/CHANGELOG**; grep `deepEqual` trong `test/*.test.mjs` cho object API đã đổi (không có route cũ nào đổi field, nhưng kiểm tra vẫn là bước bắt buộc của skill smoke).
