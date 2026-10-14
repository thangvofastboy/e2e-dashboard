# Đợt 2: tùy chọn chạy, cây test, Live, tài nguyên, AI theo dự án, hướng dẫn, nút icon

Ngày: 2026-10-14 · Trạng thái: chờ duyệt

Gom 11 yêu cầu người dùng gửi ngày 14/10. Mỗi mục: điều người dùng nói → cách làm → file chạm → test.
Phần "Giả định" là chỗ mình tự chọn mặc định, cần người dùng xác nhận.

Ngoài phạm vi (đang chờ thông tin): lỗi Gợi ý locator (chờ người dùng mô tả hiện tượng),
test gửi mail qua MailCrab (chờ người dùng đồng ý kiểm API).

---

## A. Chạy có / không giao diện (headed / headless)

**Yêu cầu:** khi chạy test chọn có hay không mở trình duyệt; mặc định đặt trong Setting.

**Cách làm:**
- Runner e2e đã có cờ `--headed` (docs `cli.mdx:368`, `run` và `explore`): chỉ cần truyền cờ, không cần env.
- `server/settings.mjs`: thêm `headed: boolean` (mặc định `false`) vào `readSettings` / `writeSettings`.
- `server/app.mjs` `/api/settings` POST: nhận `headed`. `/api/run`: thêm `headed` vào `RUN_KEYS`; thiếu thì lấy từ Settings (như `browser`).
- `server/runner.mjs` `buildRunArgs`: `if (flag(headed, 'headed')) args.push('--headed')`.
- `ui/views/settings.js` tab "Chạy & lịch": công tắc "Mở trình duyệt khi chạy (headed)", lưu khi đổi.
- `ui/views/run-dialog.js`: công tắc cùng tên ở lưới chính (cạnh Trình duyệt / Workers), điền sẵn từ Settings.
  Dialog này dùng chung cho chạy toàn bộ, chạy test đã chọn ở /tests, rerun → mọi nơi đều có tùy chọn.

**Giả định:** máy không có màn hình (server CI) mà bật headed thì runner báo lỗi của nó; dashboard chỉ hiện chú thích
"cần màn hình" cạnh công tắc, không tự kiểm.

**Test:** unit `buildRunArgs` có/không `--headed`, settings normalize + 400 khi sai kiểu, `/api/run` lấy mặc định từ Settings.

## B. Trang /tests dạng cây thư mục

**Yêu cầu:** hiển thị theo cây thư mục, xem chi tiết từng file, nút tải lại danh sách, chọn test để chạy có đủ tùy chọn như chạy toàn bộ.

**Cách làm:**
- Dựng cây ở client từ `file` của từng test (`tests/checkout/cart.e2e.ts` → `tests` › `checkout` › `cart.e2e.ts`).
- Thư mục: `<details>` mở/đóng, kèm số test và số test fail bên trong; checkbox chọn cả thư mục.
- File: một dòng tóm tắt (số test, pass rate, thời gian TB, trạng thái run gần nhất); bấm mở ra bảng test như hiện nay
  (tên dài xuống dòng, checkbox, lịch sử 10 run).
- Nút "Tải lại" gọi lại `/api/tests` và vẽ lại, giữ lựa chọn và trạng thái mở/đóng.
- Bộ lọc File / Tag / Target / "Chỉ test fail" giữ nguyên, lọc trên cây.
- "Chạy N test" đã mở cùng dialog với chạy toàn bộ (`openRunDialog`) → có trình duyệt, workers, headed (mục A).
- Cây là module dùng chung `ui/test-tree.js` (mục C dùng lại).

**Test:** unit `buildTree(rows)` (gom thư mục, đếm, sắp xếp, đường dẫn Windows `\`), chọn thư mục → chọn đủ test con.

## C. Dropdown chọn testcase: ô lọc + dạng cây

**Yêu cầu:** các dropdown chọn testcase cần filter và hiển thị cây thư mục cho dễ tìm.

**Cách làm:**
- Component `ui/test-picker.js`: nút mở popover gồm ô lọc (khớp tên, file, tag; không phân biệt dấu/hoa thường)
  + cây từ `test-tree.js`; chọn một test thì đóng popover; giữ `<input type="hidden" name=…>` để form cũ không đổi.
  Bàn phím: mũi tên lên/xuống, Enter chọn, Esc đóng.
- Thay ở: `ui/views/verify.js:34` (chọn test fail), `ui/views/qc-templates.js:32` (chọn kết quả trong run).

**Test:** unit lọc bỏ dấu (`"gio hang"` khớp `"Giỏ hàng"`), giá trị hidden input đúng sau khi chọn.

## D. Live: danh sách test fail riêng dưới chart, có nút thao tác nhanh

**Yêu cầu:** test fail nằm trong một list riêng, ngay dưới chart các test đã chạy; có các nút như ở Runs.

**Cách làm (`ui/views/live.js`):**
- Thêm phần `data-part="failed"` ngay dưới gantt: mỗi test fail một dòng (tên, file:line, target, dòng lỗi đầu),
  cập nhật theo luồng live (không chờ run xong).
- Nút mỗi dòng: Xem bước (chọn test đó trong gantt), Chạy lại test này (`openRunDialog`).
- Khi run xong và có `runId`: lấy `/api/runs/<runId>` một lần, khớp `testId|target|agent|repeat` → `resultId`,
  rồi bật thêm: Phân tích lỗi, Bước tái hiện, Gửi Linear, Tìm commit gây lỗi, Sửa bằng Claude Code (dùng lại các hàm đã export:
  `openAiPanel`, `openLinearDialog`, `openBisectDialog`, `copyToClipboard`).
- Run chạy từ terminal không có reporter (`runId` null): chỉ có các nút không cần `resultId`, kèm chú thích.
- Head: link "Xem ở Runs" trỏ thẳng `#/run/<runId>` khi có.

**Test:** unit hàm khớp key live → resultId (lặp `repeat`, nhiều target), HTML dòng fail escape dữ liệu.

## E. Live: tài nguyên máy và tài nguyên app đang dùng

**Yêu cầu:** hiện RAM, CPU, disk… và tài nguyên app đang dùng để chạy test.

**Cách làm:**
- `server/resources.mjs` (mới), endpoint `GET /api/resources`:
  - Máy: số core, model CPU, % CPU (đo chênh `os.cpus()` giữa 2 lần gọi), load avg, RAM tổng / trống,
    disk tổng / trống của ổ chứa project (`fs.statfs`).
  - App: tiến trình dashboard (`process.memoryUsage().rss`, `process.cpuUsage`); runner đang chạy: cộng RSS và %CPU của
    cả nhóm tiến trình (`ps -A -o pid=,pgid=,rss=,%cpu=`, lọc `pgid = pid runner` → gồm cả trình duyệt), số tiến trình.
  - Windows / không có `ps`: bỏ phần nhóm tiến trình, ghi "không đo được".
- Live: thanh nhỏ trong head (CPU %, RAM, disk trống, app dùng X MB / Y% CPU, N tiến trình), hỏi 2 giây/lần
  chỉ khi tab đang mở.

**Test:** unit parse output `ps` (dòng lạ, pgid không khớp), % CPU từ 2 mẫu `os.cpus()`; endpoint cần token.

## F. Hệ thống: thông tin cấu hình máy

**Yêu cầu:** trang Hệ thống hiện thêm chi tiết cấu hình máy.

**Cách làm:** `ui/views/system.js` `infoHtml` thêm bảng: hostname, OS + kernel + arch, model CPU × số core, RAM tổng,
disk tổng / trống, Node, trình duyệt Playwright đã cài (đã có ở `server/browsers.mjs`). Dùng phần tĩnh của `/api/resources`.

**Test:** unit HTML escape; endpoint trả đủ khoá.

## G. Chất lượng test: đánh giá lại, chọn model và effort

**Yêu cầu:** nút đánh giá lại chất lượng test, cho chọn model AI và effort.

**Hiện trạng:** điểm chất lượng là công thức (không AI), tính lại mỗi lần mở trang.

**Cách làm:**
- Nút "Tính lại" (tải lại điểm công thức với số run đang chọn).
- Nút "AI đánh giá lại": hộp nhỏ chọn model (danh sách như tab AI) và effort (`low…max`, mặc định theo Settings) →
  action AI mới `quality-review`: đưa AI bảng điểm + lý do trừ điểm của từng test + đường dẫn file test để AI đọc,
  trả về nhận xét từng test và gợi ý sửa theo thứ tự ưu tiên. Hiện trong AI panel như các action khác.
- `server/ai.mjs`: `run()` nhận thêm `model` / `effort` cho riêng một lần gọi (đè lên Settings), kiểm bằng
  `validModel` / `AI_EFFORTS` sẵn có. Cache theo khóa có model + effort; nút "Chạy lại" của AI panel bỏ cache (`refresh`).

**Test:** unit args CLI có `--model` / `--effort` khi đè từng lần gọi, giá trị sai bị bỏ; prompt `quality-review` chứa đủ bằng chứng.

## H. Khoảng trống coverage: chia tab

**Yêu cầu:** tab "Route" và tab "Domain trong source".

**Cách làm (`ui/views/coverage.js`):** thanh tab `seg-btns` (`role="tablist"`) dưới tiêu đề.
Tab Route: KPI + bảng route + "Route test đi qua nhưng không thấy trong app" + route đã bỏ qua.
Tab Domain: bảng domain + domain đã bỏ qua. Tab nhớ trong URL `?tab=`. Số lượng hiện trên tab.

**Test:** unit HTML hai tab, mặc định tab Route.

## I. Dự án: nhiều thư mục nguồn có mô tả + Prompt cho AI

**Yêu cầu:** chọn nhiều thư mục kèm mô tả (vd. backend, frontend), lưu lại và gửi cho AI ghi nhớ;
thêm field Prompt để AI local hiểu hệ thống, rule, workflow.

**Cách làm:**
- `server/settings.mjs`: `sources: [{ path, description }]` (tối đa 20; path tương đối với project hoặc tuyệt đối,
  phải là thư mục tồn tại, không symlink ra ngoài; mô tả ≤ 500 ký tự) và `prompt` (≤ 8000 ký tự).
- `ui/views/system.js` tab "Dự án": danh sách dòng (đường dẫn + mô tả), nút thêm / xoá, ô Prompt nhiều dòng, nút Lưu.
- "Gửi cho AI ghi nhớ" = **mọi lần gọi AI** đều kèm khối "Bối cảnh dự án (người dùng viết)": danh sách thư mục + mô tả + Prompt.
  **Đã đổi theo người dùng (14/10):** gửi thẳng xuống Claude CLI bằng `--append-system-prompt` (không chèn vào `FRAME`),
  ngoài khối dữ liệu không tin cậy vì do người dùng viết. Khối này nằm trong khoá cache AI: sửa Prompt / thư mục thì câu trả lời cũ không dùng lại.
- Thư mục `/` và thư mục home bị từ chối (AI kèm dữ liệu run không tin cậy sẽ đọc được `~/.ssh`, `.env` của cả máy).
  Thư mục tạm vắng mặt chỉ bị bỏ khi đọc, không bị xoá khỏi file khi lưu setting khác.
- AI được đọc các thư mục này: thêm `--add-dir <path>` cho từng thư mục khi gọi Claude CLI (công cụ vẫn chỉ đọc: Read/Grep/Glob).

**Giả định:** không tạo "bộ nhớ" riêng cho AI; bối cảnh gửi lại mỗi lần gọi là cách chắc chắn AI luôn biết.
`coverage.source` giữ nguyên, không gộp.

**Test:** settings normalize (path không tồn tại / quá 20 / mô tả dài → 400), prompt có khối bối cảnh, args có `--add-dir`.

## J. Setting: tab "Hướng dẫn"

**Yêu cầu:** hướng dẫn chi tiết các bước cài đặt, setup Claude Code, e2e test, e2e-dashboard, tạo và chạy test…

**Cách làm:**
- Tab mới "Hướng dẫn" trong `SYS_TABS` (`ui/views/system.js`), nội dung từ file tĩnh `ui/guide.md` (fetch, render bằng `renderMarkdown`).
- `renderMarkdown` chưa có heading / bảng: thêm `#`–`###` và bảng đơn giản (có test).
- Mục lục bên trái, các phần: 1) Yêu cầu (Node, git) 2) Cài Claude Code + đăng nhập + MCP Linear 3) Cài e2e trong project app
  4) Cài và mở e2e-dashboard 5) Viết test `*.e2e.ts` (agent.act / agent.assert, tag) 6) Chạy test (dashboard, CLI, headed, workers)
  7) Đọc kết quả, triage, gửi Linear 8) Tính năng AI 9) Cấu hình hay dùng 10) Xử lý sự cố.
  Lấy từ README (Cài đặt, Hướng dẫn sử dụng, Lệnh, Cấu hình), viết lại theo từng bước.

**Test:** unit markdown heading / bảng / escape; file guide.md tồn tại và render không lỗi.

## K. Nút chỉ còn icon, hover hiện tên

**Yêu cầu:** bỏ chữ ở mọi nút, chỉ giữ icon; hover hiện tên chi tiết.

**Cách làm:**
- Sau mỗi lần vẽ trang (chỗ `app.js` đang gắn nút phóng to), hàm `iconOnly(root)`: với mỗi `button` / `a.button` có icon,
  bọc phần chữ vào `<span class="btn-label">` (ẩn bằng CSS kiểu sr-only, trình đọc màn hình vẫn đọc) và đặt
  `data-tip` = chữ đó (+ `title` cũ nếu có) để dùng tooltip sẵn có. Nút không có icon giữ chữ (không thể trống).
- Số đếm trong nút (vd. "Chỉ test fail 2") giữ hiện dạng badge cạnh icon.
- Công tắc ở Cài đặt › Giao diện: "Nút chỉ hiện icon" (mặc định **bật**) để ai cần thì bật chữ lại.

**Test:** unit `iconOnly` trên HTML mẫu: chữ thành `.btn-label`, `data-tip` đúng, nút không icon giữ nguyên, chạy 2 lần không lồng span.

---

## Thứ tự làm và cách chia việc

1. A + I + G (server: settings, runner, ai) — nền cho các mục sau.
2. B + C (cây test, picker) · D + E + F (Live, tài nguyên, hệ thống) · H + J + K (coverage, hướng dẫn, nút icon) —
   3 nhóm làm song song, mỗi nhóm sở hữu file riêng; `ui/style.css` và `server/app.mjs` chỉ một người sửa mỗi đợt.
3. Chạy `npm test` sau mỗi đợt; smoke test (server thật + chụp toàn bộ trang 1440/1024) **một lần** khi xong hết.

Nhánh: `feat/dashboard-batch-2` tách từ nhánh hiện tại.
