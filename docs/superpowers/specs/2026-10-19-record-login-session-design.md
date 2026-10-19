# Record: đăng nhập trước, lưu phiên

Ngày: 2026-10-19. Mở rộng `2026-10-19-record-to-test-design.md`. Trạng thái: người dùng đã duyệt hướng A ("ok, lam A giup toi").

## Vấn đề

Có trang chỉ vào được sau khi đăng nhập (SSO, OTP, captcha) nên không record được bước đăng nhập. Người dùng cần đăng nhập xong rồi mới bắt đầu ghi thao tác.

## Giải pháp

1. **Đăng nhập trước**: nút mới mở `playwright-core codegen --save-storage` tới URL. Người dùng đăng nhập rồi bấm **Xong, lưu phiên** (hoặc đóng cửa sổ). Phiên lưu ở `.e2e-dashboard/auth/<tên>.json` (đã nằm trong `.gitignore`; thư mục 0700, file 0600).
2. **Record có phiên**: chọn một phiên đã lưu trước khi bấm Record; codegen chạy với `--load-storage <đường dẫn tương đối>` nên mở ra đã đăng nhập.
3. **Spec mang theo phiên**: codegen tự chèn `test.use({ storageState: '.e2e-dashboard/auth/<tên>.json' })` vào spec; chạy test bằng runner Playwright của dashboard (cwd là gốc project) là đăng nhập sẵn.

## Đã kiểm chứng bằng spike (playwright-core 1.64, 2026-10-19)

- `--save-storage` + SIGINT: file được ghi (exit 130). SIGTERM: **không** có file. Vì vậy "Xong, lưu phiên" dùng SIGINT; `close()` (tắt server) dùng SIGTERM là bỏ phiên, đúng ý.
- `--load-storage <path>` + `-o`: spec có khối nhiều dòng `test.use({\n  storageState: '<path đúng như đã truyền>'\n});` sau dòng import. Đường dẫn tương đối thì spec mang đi được; tuyệt đối thì gắn với máy này.

## Quyết định (của tôi, chưa xác nhận riêng)

- Spawn codegen với `cwd: projectRoot` để đường dẫn tương đối đúng.
- Ghi phiên mới vào thư mục tạm rồi mới chuyển vào `auth/` khi thành công: đăng nhập hỏng không đè phiên cũ đang dùng được.
- File phiên chỉ có `cookies: []` và `origins: []` coi là **thất bại** ("chưa thấy cookie hay localStorage nào: bạn đã đăng nhập chưa?").
- Tên phiên qua `slugify` (chỉ `[a-z0-9-]`, ≤ 60). Phiên cùng tên được **ghi đè** (đăng nhập lại khi phiên hết hạn là việc thường xuyên); xoá có route riêng.
- File phiên chứa cookie/token: API chỉ trả **tên và thời điểm lưu**, không bao giờ trả nội dung.
- **AI Gen e2e** không dùng file phiên (runner `e2e` có cơ chế phiên riêng, chỉ sống trong một lần chạy): prompt dặn AI bắt đầu từ trang đã đăng nhập và để `// TODO:` cho phần đăng nhập.
- `cases.json` thêm `auth: "<tên>" | null`.

## Ngoài phạm vi

Làm mới phiên tự động khi hết hạn; dùng phiên cho runner `e2e`; mã hoá file phiên; CI (file phiên không có trên CI, spec cần phiên sẽ fail ở đó: ghi rõ trong README).

## Plan (TDD, mỗi task test đỏ trước)

1. **`parseSpec` bỏ qua khối `test.use({ … })` nhiều dòng** (`server/recorder-spec.mjs`): dòng bên trong không thành bước `other`.
2. **Phiên codegen** (`server/recorder-session.mjs`): `cwd: projectRoot`; `start({ url, name, auth })` thêm `--load-storage .e2e-dashboard/auth/<auth>.json` (400 nếu chưa có phiên); `login({ url, name })` chạy `--save-storage <tạm>`, thành công thì chuyển vào `auth/` (0700/0600); status có `kind` (`record` | `login`) và `auth`; `result()` null cho phiên login; `listAuth()` trả `[{ name, savedAt }]`; `removeAuth(name)`.
3. **API** (`server/recorder-api.mjs`): `POST /api/record/login {url, name}`; `GET /api/record/auth`; `POST /api/record/auth/delete {name}`; `start` nhận `auth`; `save` ghi `auth` vào `cases.json`; `gen-e2e` đưa `auth` vào prompt (`server/recorder-ai.mjs`).
4. **UI** (`ui/views/record.js`): chọn phiên, nút Đăng nhập trước + Xoá phiên; phiên login xong thì báo toast, dọn phiên và làm mới danh sách; `recNeedsAnalyze` bỏ qua phiên login.
5. **Smoke + tài liệu**: ca smoke login → record có phiên; README (cảnh báo file phiên, CI), CHANGELOG. Smoke chỉ chạy một lần ở cuối.

## P1: dựng phiên từ chuỗi Cookie và/hoặc link đăng nhập một lần (không qua AI)

Người dùng yêu cầu thêm bước "chuẩn bị" trước khi Record (cookie hoặc link để đăng nhập). Làm P1, chưa làm P2 (prompt tự do cho AI lái trình duyệt).

- `POST /api/record/prepare { name, url, cookie?, link? }` (cần ít nhất một trong hai):
  - **Cookie**: chuỗi `Cookie:` copy từ DevTools (Network → Request Headers). Dựng storageState host-only theo hostname của `url`, `path: '/'`, `secure` theo scheme, `sameSite: Lax`, hết hạn theo phiên. Tối đa 100 cookie; lỗi không bao giờ chứa tên hay giá trị cookie. Chỉ cookie: ghi thẳng, không mở trình duyệt, không cần màn hình.
  - **Link**: mở bằng chromium **headless** (tiến trình con `server/recorder-link-login.mjs`, playwright-core của project), kèm cookie dán sẵn nếu có, đợi trang tải xong rồi lưu storageState. Timeout 60 giây; mỗi lần một phiên (409 nếu trùng).
- Cookie và link là bí mật: đi qua file tạm 0600 chứ không qua argv (`ps` thấy được), file tạm xoá ngay, lỗi trả ra bị che (giá trị cookie, link, mọi URL) và rút gọn.
- Kết quả giống "Đăng nhập trước": `.e2e-dashboard/auth/<tên>.json` (0600). Cùng tên thì ghi đè. Cookie rỗng sau khi mở link là thất bại, phiên cũ còn nguyên.
- UI: ô dán cookie + ô link + nút "Lưu phiên từ cookie / link"; ô dán được xoá sau khi lưu thành công; nút không bị khoá theo `canRecord` vì không cần màn hình.
- Không gọi AI ở đâu trong luồng này (test cài `runAi` ném lỗi để chắc chắn).
- Hạn chế: cookie dán vào chỉ áp dụng cho đúng hostname của URL (không phủ subdomain / domain cha); header Cookie không có `HttpOnly`/hạn dùng nên các thuộc tính đó lấy giá trị an toàn mặc định.

## P2: prompt cho AI chuẩn bị phiên (agent của runner `e2e`)

Người dùng viết prompt tự do ("đăng nhập bằng tài khoản {{E2E_ADMIN_USER}} / {{E2E_ADMIN_PASSWORD}}, mở mục Cài đặt…"); AI làm theo trong trình duyệt ẩn rồi dashboard lưu phiên như các cách trước.

**Đã kiểm chứng bằng spike (e2e 0.21.2, 2026-10-19):** `e2e run --config <config tạm>` chạy được một test tạm; `secrets.get()` điền được ô mật khẩu mà giá trị không lọt vào `report.json`; `browser.cookies()` và `browser.evaluate()` đọc được cookie và localStorage để ghi ra file; config tạm import được config thật của project và tắt reporter dashboard nên run này không vào lịch sử. Phiên của runner chỉ sống trong một lần chạy (mã hoá trong bộ nhớ) nên phải tự ghi cookie ra file ở cuối test.

**Thiết kế (của tôi, dựa trên spike):**
- Không để AI sinh mã rồi chạy. Dùng **agent có sẵn của runner** (`agent.act`): chỉ làm được các thao tác trên trang qua bộ công cụ của runner. Test tạm do dashboard sinh theo khuôn cố định; prompt và URL chỉ nằm trong chuỗi JSON.
- **Bí mật = handle.** Placeholder `{{E2E_TÊN}}` trong prompt (chỉ tên bắt đầu bằng `E2E_`, để prompt không đọc được biến môi trường tuỳ ý). Giá trị lấy từ môi trường server rồi từ `.env` của project, không bao giờ nằm trong prompt, argv, file sinh ra hay phản hồi. Mỗi placeholder thành một `secrets.get()` truyền qua `params` của `agent.act`: model chỉ thấy tên, runner mới gõ giá trị. Thiếu biến hoặc giá trị ngắn hơn 6 ký tự (ngưỡng của runner) thì 400, chỉ nêu tên biến.
- Test tạm nằm trong `.e2e-dashboard/prepare/<id>/` cùng config bọc; cuối test ghi `{ cookies, origin, localStorage }` ra file, server đổi thành storageState rồi `saveAuth` (cookie rỗng là thất bại). Thư mục tạm xoá sau mỗi lần.
- Điều kiện: project đã cấu hình AI cho runner `e2e` (không phải `none`), có `node_modules/e2e` và chromium. Tối đa 3 phút; mỗi lần một phiên; hộp xác nhận ở UI vì tốn token.
- Lỗi trả ra bị che giá trị bí mật và URL, rút gọn.
- **Chưa thử được agent thật** (project này chưa cấu hình AI): đường chạy được kiểm chứng bằng test tích hợp chạy runner thật với bước gõ cố định thay cho agent; phần model chỉ kiểm chứng ở mức sinh đúng lệnh `agent.act`.
