# Issue Linear → testcase → e2e test

Ngày: 2026-10-14. Trạng thái: chờ người dùng duyệt spec.

## Mục tiêu

Từ các issue Linear được giao cho những người đã chọn, AI đọc nội dung issue và đề xuất danh sách testcase. Người dùng xem, sửa, lưu. Từ testcase đã lưu, AI sinh một file `*.e2e.ts` theo runner `e2e` của project.

## Quyết định đã chốt

| # | Câu hỏi | Chốt |
|---|---------|------|
| 1 | Định dạng test | `*.e2e.ts` theo runner `e2e` (`agent.act` / `agent.assert`), không dùng `@playwright/test` thuần |
| 2 | Số file mỗi issue | Một file cho mỗi issue, các testcase thành nhiều `test()` |
| 3 | Lưu danh sách email + status | `.e2e-dashboard/settings.json` của từng project |
| 4 | Refresh khi issue không còn khớp | Giữ issue đã có testcase hoặc nhập tay; chỉ bỏ issue tự động không còn khớp và chưa có testcase |
| 5 | AI đọc gì | Tiêu đề, mô tả, toàn bộ comment (comment tải khi bấm phân tích) |
| 6 | Gen khi file đã tồn tại | Không ghi đè, báo lỗi, giữ file cũ |

## Ngoài phạm vi

- Đồng bộ ngược testcase lên Linear (comment, sửa issue).
- Chạy test sau khi Gen. Người dùng chạy bằng luồng có sẵn.
- Đa team, nhiều workspace Linear.

## Thành phần

**Server (`server/`)**

- `settings.mjs`: mở rộng `readSettings` / `writeSettings` với khoá `linear: { emails: string[], statuses: string[] }`. Validate: email đúng định dạng, tối đa 20 email; status tối đa 20 mục, mỗi mục tối đa 60 ký tự.
- `linear-issues.mjs` (mới): lấy issue theo email và status qua `resolveLinear` (API key hoặc MCP), thêm issue theo ID, merge khi refresh, lưu và đọc `linear-issues.json`. Phần merge và validate là hàm thuần để unit test.
- `linear-tests.mjs` (mới): dựng bằng chứng cho AI từ issue và comment, parse JSON testcase từ câu trả lời AI, dựng prompt Gen từ testcase đã lưu.
- `app.mjs`: thêm route (xem phần API).

**UI (`ui/`)**

- `ui/views/system.js`, tab Tích hợp: form danh sách email và status. (Cần xác nhận tên tab đúng khi lập kế hoạch.)
- `ui/views/linear-issues.js` (mới): trang menu "Issue Linear", gồm bảng issue, nút lấy lại danh sách, ô nhập ID, nút phân tích, bảng testcase có sửa và lưu, nút Gen.
- `ui/app.js`: đăng ký route và mục menu mới.

## Dữ liệu

`.e2e-dashboard/linear-issues.json`:

```json
{
  "items": [
    {
      "identifier": "ENG-123",
      "title": "…",
      "url": "https://linear.app/…",
      "state": "In Progress",
      "assignee": "a@x.com",
      "source": "auto | manual",
      "testcases": [{ "id": "tc-1", "title": "…", "steps": ["…"], "expected": "…" }],
      "analyzedAt": "2026-10-14T09:00:00Z",
      "generatedPath": "tests/linear/ENG-123.e2e.ts"
    }
  ],
  "fetchedAt": "2026-10-14T09:00:00Z"
}
```

- `identifier` khớp `^[A-Z][A-Z0-9]{1,9}-\d{1,7}$`.
- `testcases` là `null` khi chưa phân tích, là mảng khi đã phân tích (có thể rỗng).
- `generatedPath` khớp `DRAFT_PATH` hiện có (trong project, đuôi `.e2e.ts`, không `..`, không thư mục ẩn).

## API

| Method | Đường dẫn | Việc |
|--------|-----------|------|
| GET | `/api/linear/issues` | Đọc danh sách đã lưu |
| POST | `/api/linear/issues/refresh` | Lấy lại theo email và status, merge |
| POST | `/api/linear/issues/add` | Body `{ id }`: thêm issue nhập tay |
| POST | `/api/linear/issues/:id/analyze` | AI đọc issue, trả về testcase đề xuất (chưa lưu) |
| PUT | `/api/linear/issues/:id/testcases` | Lưu testcase đã sửa |
| POST | `/api/linear/issues/:id/gen` | AI sinh file `*.e2e.ts` từ testcase đã lưu |

`analyze` chỉ trả về đề xuất. Người dùng phải bấm lưu thì mới ghi vào `linear-issues.json`.

## Luồng chính

1. Người dùng nhập email và status trong tab Tích hợp, rồi lưu.
2. Mở menu Issue Linear, dữ liệu đã lưu hiện ra. Nếu chưa có thì tự refresh một lần.
3. Refresh: gọi Linear, merge theo quy tắc quyết định 4. Lỗi Linear thì giữ nguyên danh sách và báo lỗi.
4. Bấm phân tích: server tải issue và comment, AI trả JSON testcase. UI hiện bảng để sửa.
5. Lưu testcase. Nút Gen chỉ bật khi đã lưu ít nhất một testcase.
6. Gen: AI viết một file `tests/linear/<ID>.e2e.ts`, server ghi bằng cờ `wx`. Nếu file đã có thì trả 409, UI báo lỗi và không ghi đè.

## Lỗi và bảo mật

- Nội dung issue và comment là dữ liệu không tin cậy. Đặt trong khối rào ngẫu nhiên (cùng kiểu `buildPrompt` đang dùng), không để thành chỉ dẫn.
- Chấp nhận ID thủ công: validate regex trước khi gọi Linear.
- Không có API key và MCP Linear chưa kết nối: menu hiện thông báo cần cấu hình, không gọi AI.
- AI trả về JSON lỗi: báo lỗi, giữ testcase cũ.
- Mọi ghi file đi qua chỗ kiểm tra đường dẫn và symlink đã có (`isLink`, `realInside`).

## Kiểm thử

- Unit: validate settings, merge refresh (các trường hợp giữ / bỏ), parse testcase (JSON hỏng, thiếu trường, dữ liệu có chứa khối rào), validate ID và đường dẫn.
- Unit: client Linear với `fetchImpl` mock (đúng filter, lỗi HTTP, body thiếu `data`), và MCP với `ai` mock.
- Route: 409 khi file đã tồn tại, 400 khi ID sai, 401 khi thiếu token.
- UI: không có unit test cho DOM, kiểm tay qua smoke test cuối.
- Theo quy tắc của project: viết smoke test cùng lúc, nhưng chỉ chạy một lần khi toàn bộ tính năng xong.

## Điểm cần xác minh khi lập kế hoạch

- Tên trường lọc GraphQL của Linear (lọc theo email assignee và tên state). Chưa đối chiếu tài liệu. Mock trong test phải theo đúng schema thật.
- Tên tab Tích hợp trong `ui/views/system.js`.
- Danh sách status mặc định khi người dùng chưa nhập.
