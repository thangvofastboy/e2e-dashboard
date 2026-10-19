# Record thao tác → testcase → test

Ngày: 2026-10-19. Trạng thái: builder check xong, chờ người dùng duyệt spec.

## Mục tiêu

Người dùng mở browser, thao tác trên app cần test. Dashboard ghi lại, đổi thành testcase đọc được (AI tự sinh `expected`), cho sửa, rồi lưu thành file `.spec.ts` chạy được ngay. Tuỳ chọn: AI chuyển testcase đã lưu sang `*.e2e.ts` (runner `e2e`).

## Quyết định đã chốt (người dùng)

| # | Câu hỏi | Chốt |
|---|---------|------|
| 1 | Định dạng test mặc định | `.spec.ts` Playwright, chạy bằng đường Playwright có sẵn (`server/playwright.mjs`) |
| 2 | Chuyển sang e2e | Tuỳ chọn "AI Gen e2e" sau khi lưu |
| 3 | Assert | Người dùng thêm assert trong cửa sổ inspector của codegen; AI sinh `expected` cho testcase |
| 4 | Sau khi record | Hiện testcase đã gen, cho sửa, rồi lưu; sau đó mới chọn AI Gen e2e |
| 5 | Thư mục lưu | `tests/recorded/` |

## Lựa chọn của tôi (chưa được xác nhận riêng)

- Spec và testcase lưu cạnh nhau: `tests/recorded/<slug>.spec.ts` + `tests/recorded/<slug>.cases.json`.
- Che giá trị nhạy cảm trước khi lưu và trước khi gửi cho AI: bước `fill` vào ô password (selector chứa `password`/`mật khẩu`) và `fill` có giá trị trùng mẫu token/khoá API → thay bằng `process.env.E2E_SECRET_<n>` trong spec, `«ẩn»` trong testcase.
- Chỉ chạy được khi dashboard chạy trên máy có màn hình; không có `DISPLAY`/không phải desktop → nút Record bị khoá kèm lý do.
- Chạy `playwright-core codegen` của chính project (`node_modules/playwright-core/cli.js`), không `npx`, giống `resolvePlaywrightBin`.

## Đã rõ từ code (sau builder check)

- Danh sách test: `discoverTests` (`server/discover.mjs`) quét đệ quy từ `testDir`, nên `tests/recorded/` được nhận; `.spec.ts` chạy bằng runner Playwright, `.e2e.ts` bằng runner `e2e`. Hai file cùng slug là hai test khác nhau, không dedupe.
- AI: gọi qua `createAi` trong `server/ai.mjs` (`claude -p`), độc lập với tích hợp Linear. Không cấu hình/không có lệnh `claude` → `aiError` như đã nêu.

## Quyết định nhỏ của tôi (builder check)

- **Phạm vi che nhạy cảm** (rộng hơn bản đầu): che `fill`/`press` vào ô có tên/label/selector khớp `password|mật khẩu|otp|pin|cvv|card|secret|token|api[-_ ]?key`; che query string nhạy cảm trong `goto` (`token|key|secret|code|auth|session`); che giá trị trong `expect(...toHaveValue/toHaveText...)` khi locator thuộc ô nhạy cảm; chuỗi `press` từng phím vào ô nhạy cảm gộp thành một bước `fill` đã che. `setInputFiles` giữ tên file, bỏ đường dẫn tuyệt đối. Không chắc → che (thà che thừa). `redact()` có bộ test riêng cho từng loại.
- **Dừng**: gửi SIGINT (thoát sạch để codegen ghi file); nếu file rỗng thì `failed` kèm hướng dẫn "đóng cửa sổ browser để kết thúc". Đã spike trên `playwright-core` 1.64 (2026-10-19): SIGINT và SIGTERM đều để lại file `-o` đã ghi (có `page.goto`); SIGINT thoát mã 130, SIGTERM mã 0. Vì vậy phiên bị Dừng có file không rỗng vẫn là `done`, bất kể mã thoát.
- **Máy có màn hình**: trường hợp dùng chính là dashboard chạy local trên máy dev. Linux: cần `DISPLAY` hoặc `WAYLAND_DISPLAY`; macOS/Windows: luôn coi là có. Còn lại khoá nút Record kèm lý do.
- **Trùng slug (409)**: giữ phiên `done` trong bộ nhớ; UI hiện ô đổi tên để lưu lại, không phải record lại. Không thêm nút xoá file.

## Quyết định của người dùng (sau builder check)

- **Bí mật khi chạy lại**: chỉ hướng dẫn (A). Sau khi lưu, UI liệt kê các biến `E2E_SECRET_<n>` đã dùng kèm dòng "đặt giá trị trong `.env` hoặc môi trường". Dashboard không lưu bí mật, không sửa `server/playwright.mjs`. Test chạy lỗi cho đến khi người dùng đặt biến.

## Ngoài phạm vi

- Ghi video/screenshot lúc record. Ghi mobile. Ghi nhiều tab song song.
- Sửa code `.spec.ts` trong dashboard (người dùng sửa bằng editor của họ; sửa testcase chỉ đổi `cases.json`).
- Đồng bộ ngược: sửa testcase không sinh lại `.spec.ts`.
- Chạy test sau khi lưu (dùng luồng chạy sẵn có).

## Anti-goal

Lưu mật khẩu/token thật vào file hoặc gửi cho AI. Ghi đè file test đã có.

## Luồng

1. **Record**. Tab Tests → "Record" → nhập URL (http/https) và tên. `POST /api/record/start` spawn codegen headed, `--target playwright-test -o <thư mục tạm>/<id>.spec.ts`. Một phiên tại một thời điểm. UI poll `GET /api/record/status` (trạng thái: `recording | done | failed`). Nút "Dừng" gọi `POST /api/record/stop` (SIGTERM; codegen đã ghi file trong lúc chạy nên đóng đột ngột vẫn giữ nội dung đến thời điểm đó). Đóng cửa sổ browser cũng kết thúc phiên.
2. **Parse**. Khi `done`, `server/recorder.mjs` đọc file tạm, parse từng lệnh `page.*` thành bước: `goto`, `click`, `dblclick`, `fill`, `press`, `check/uncheck`, `selectOption`, `setInputFiles`, `expect(...)` (assert từ inspector). Mỗi bước có câu mô tả tiếng Việt từ locator (`getByRole('button', {name:'Đăng nhập'})` → `Bấm nút "Đăng nhập"`). Lệnh không nhận ra → bước `Thao tác: <mã gốc>` (không bỏ rơi). Nhóm bước thành MỘT testcase mặc định; người dùng tách/gộp khi sửa.
3. **Sinh expected**. `POST /api/record/analyze`: AI nhận danh sách bước (đã che nhạy cảm, đặt trong khối `untrusted-data-<hex>` như `buildAnalyzePrompt`) và đề xuất `title` + `expected` cho testcase; bước `expect(...)` từ inspector được đưa vào làm bằng chứng chắc chắn của `expected`. Trả JSON `{testcases:[{title,steps,expected}]}`, kiểm bằng `normalizeTestcase`. AI lỗi/không cấu hình → vẫn trả testcase gốc với `expected` rỗng và cờ `aiError`; người dùng điền tay.
4. **Sửa**. UI dùng lại bảng sửa testcase của `ui/views/linear-issues.js` (tách thành component dùng chung nếu cần: sửa tiêu đề, bước, expected; thêm/xoá/đổi chỗ bước; tách/gộp testcase).
5. **Lưu**. `POST /api/record/save` ghi `tests/recorded/<slug>.spec.ts` (nội dung codegen sau khi che nhạy cảm) và `<slug>.cases.json`. `slug` chỉ `[a-z0-9-]`, tối đa 60 ký tự. File đã tồn tại → 409, không ghi đè.
6. **AI Gen e2e** (tuỳ chọn). `POST /api/record/gen-e2e` dựng prompt từ testcase đã lưu theo mẫu `buildGenPrompt` (đọc `e2e.config.*` và vài `.e2e.ts` gần nhất), ghi `tests/recorded/<slug>.e2e.ts`. Đã tồn tại → báo lỗi, giữ file cũ (như quyết định #6 của spec Linear).

## Thành phần

**Server**
- `server/recorder.mjs` (mới): `startRecording`, `stopRecording`, `recordingStatus` (quản lý một tiến trình con); `parseSpec(text)` → `steps[]`; `redact(steps)`; `buildExpectedPrompt`, `parseExpected`; `buildE2ePrompt`, `parseE2e`. Phần parse/redact/prompt là hàm thuần để unit test.
- `server/app.mjs`: 5 route trên, đặt trước khối `/api/ai/*` nếu dùng chung tiền tố (theo skill `e2e-dashboard-server-route-order`). Mọi route kiểm tra token như route khác; `url` chỉ chấp nhận http/https; đường dẫn ghi file ép trong `tests/recorded/`.
- Dùng lại: resolve `playwright-core` kiểu `resolvePlaywrightBin`, `installedBrowsers` (`server/browsers.mjs`) để báo thiếu chromium, `normalizeTestcase`, đường gọi AI hiện có của `linear-tests`.

**UI**
- `ui/views/record.js` (mới) hoặc nút trong tab Tests: hộp thoại Record, màn hình đang ghi (nút Dừng), màn hình sửa testcase, nút Lưu, nút "AI Gen e2e" (hiện sau khi lưu).
- Danh sách test có sẵn tự thấy file mới trong `tests/recorded/`.

## Dữ liệu

`tests/recorded/<slug>.cases.json`:

```json
{ "name": "Đăng nhập", "url": "https://app/", "recordedAt": "2026-10-19T07:00:00Z",
  "testcases": [{ "id": "tc-1", "title": "…", "steps": ["…"], "expected": "…" }],
  "specPath": "tests/recorded/dang-nhap.spec.ts", "e2ePath": null }
```

## Lỗi và biên

- Thiếu chromium → báo kèm lệnh cài, không spawn.
- codegen thoát mã ≠ 0 hoặc file rỗng → `failed` kèm stderr rút gọn; không tạo testcase.
- Server tắt khi đang record → tiến trình con bị kill (không để orphan); file tạm dọn khi khởi động lần sau.
- Phiên `done` chưa lưu: giữ tạm trong bộ nhớ, bỏ sau 1 giờ.

## Kiểm thử

- Unit: `parseSpec` (mỗi loại lệnh, lệnh lạ, assert), `redact` (password, token, không che nhầm ô thường), `parseExpected`/`parseE2e` (JSON hỏng, PATH sai), slug, chống ghi đè, chặn path traversal và URL không phải http/https.
- Smoke: Record bằng codegen giả (script ghi sẵn một file spec) → parse → analyze (AI giả) → save → file xuất hiện và chạy được bằng runner Playwright.
- Smoke chỉ chạy một lần ở cuối, sau khi xong hết tính năng.

## Để builder quyết

Cách map locator → câu mô tả; tên route chính xác; component sửa testcase dùng chung hay copy; thông điệp lỗi.
