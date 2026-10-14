// Nội dung tab "Hướng dẫn" (Cài đặt hệ thống), render bằng renderMarkdown.
// Để trong JS thay vì ui/guide.md vì server chỉ phục vụ /app.js và /style.css (bundle), không phục vụ file .md tuỳ ý.
// Chỉ ghi điều có trong README hoặc mã của dashboard; chỗ chưa chắc thì nói rõ là chưa chắc.
// Lưu ý cho người sửa: không bắt đầu dòng bằng `export default` hay `import { … } from './…'` (bundler đọc nhầm).
export const GUIDE_MD = `# Hướng dẫn từng bước

Từ máy trống tới lúc chạy test e2e và đọc kết quả trên dashboard. Bấm tên phần ở mục lục để nhảy tới.

## 1. Yêu cầu

- **Node.js**: e2e bản mới cần Node ≥ 22.22.3 (hoặc ≥ 24.8); dashboard cần Node ≥ 22. Chỉ mục SQLite (tuỳ chọn) cần Node ≥ 22.13. Kiểm tra bằng \`node -v\`.
- **git**: dashboard đọc commit, branch và \`git diff\` (tìm commit gây lỗi, test bị ảnh hưởng). Kiểm tra bằng \`git --version\`.
- **gh** (tuỳ chọn): chỉ cần khi nhập report từ GitHub Actions hoặc đăng kết quả lên PR (\`gh auth login\`).

## 2. Cài Claude Code, đăng nhập, MCP Linear

1. Cài Claude Code CLI theo hướng dẫn chính thức của Anthropic (lệnh cài có thể đổi theo thời gian nên hướng dẫn này không ghi lại).
2. Mở terminal, gõ \`claude\` rồi làm theo màn hình để đăng nhập. Mọi tính năng AI của dashboard dùng chính phiên đăng nhập này (\`claude -p\`), **không cần API key**.
3. MCP Linear (để gửi issue khi chưa có Linear API key): trong \`claude\`, gõ \`/mcp\`, chọn Linear và đăng nhập. Kiểm tra bằng \`claude mcp list\`.
4. Hoặc dùng Linear API key: *Cài đặt hệ thống › Tích hợp* → nhập key dạng \`lin_api_…\` (tạo ở Linear → Settings → API). Có key thì dashboard ưu tiên key.

## 3. Cài e2e trong project app

- Dashboard làm việc với project **đã dùng e2e** (có \`e2e.config.ts\`).
- Chưa có e2e: trong Claude Code nhờ skill \`e2e\` dựng \`e2e.config.ts\` và test mẫu. Tên gói npm và lệnh khởi tạo chính xác hãy xem tài liệu của e2e; hướng dẫn này chưa ghi để tránh sai.
- Cài thêm trình duyệt cho Playwright khi cần: \`npx @e2e-dev/web install firefox webkit\`.

## 4. Cài và mở e2e-dashboard

**Bước 1.** Trong Claude Code, thêm marketplace và cài plugin:

\`\`\`text
/plugin marketplace add thangvofastboy/e2e-dashboard
/plugin install e2e-dashboard@e2e-dashboard
/reload-plugins
\`\`\`

**Bước 2.** Đứng ở thư mục project e2e, gõ \`/e2e-dashboard\`: server chạy nền và mở trình duyệt. Lần sau gõ lại chỉ mở trình duyệt.

**Bước 3** (tuỳ chọn). \`/e2e-dashboard setup\`: gắn reporter vào \`e2e.config.ts\` để xem tiến độ live. Hãy commit 2 file reporter được tạo ra; trên CI (\`CI=true\`) reporter tự tắt.

**Bước 4.** Tắt server: \`/e2e-dashboard stop\`. Xem trạng thái: \`/e2e-dashboard status\`.

## 5. Viết test *.e2e.ts

- Mỗi file \`*.e2e.ts\` chứa các \`test()\`. Bước thao tác viết bằng ngôn ngữ tự nhiên qua \`agent.act\`, bước kiểm tra qua \`agent.assert\`; ngoài ra có \`agent.waitFor\`, \`agent.extract\`, và \`screen\` / \`expect\` khi muốn chốt locator cố định.

\`\`\`ts
await agent.act('Mở giỏ hàng và bấm Thanh toán');
await agent.assert('Trang hiện tổng tiền và nút Đặt hàng');
\`\`\`

- Cách khai báo \`test()\` và import đầy đủ: xem tài liệu e2e (hoặc nhờ skill \`e2e\`), vì cú pháp có thể khác theo phiên bản.
- **Tag** (vd. \`@smoke\`, \`@LIN-1\`) dùng để lọc khi chạy (\`--tag\`), gom nhóm và truy vết story. Cách gắn tag vào test xem tài liệu e2e.
- Mô tả bước càng cụ thể càng ổn định; trang **Lint agent** chỉ ra bước mơ hồ, **Gợi ý locator** đề xuất chuyển bước hay replay thành locator.

## 6. Chạy test

**Từ dashboard**

- Trang **Live** → *Chạy toàn bộ suite*; trang **Tests** → tick test, cả file hoặc cả thư mục (hoặc *Chọn tất cả fail*) → **Chạy**. Hộp thoại chạy có trình duyệt, số worker, **có giao diện (headed)**, tag, retries…
- Số worker, trình duyệt và headed mặc định, watch và lịch chạy đặt ở *Tự động & lưu trữ › Chạy & lịch*. Headed cần máy có màn hình.

**Nhờ Claude chạy**

- Khi dashboard đang mở, nói với Claude Code kiểu *"chạy test checkout"* hoặc *"dừng run"*: Claude dùng tool MCP \`e2e_run_start\` / \`e2e_run_stop\` của plugin, run đi qua dashboard nên có nút Dừng, tài nguyên và tiến độ ở **Live** như khi bấm tay.
- Claude tự chạy \`npx e2e run\` trong terminal cũng được: có reporter thì vẫn xem live, nhưng nút Dừng của dashboard không dừng được tiến trình đó.

**Từ terminal**

| Việc | Lệnh |
|---|---|
| Chạy toàn bộ | \`npx e2e run\` |
| Một test theo dòng | \`npx e2e run tests/checkout.e2e.ts:12 --retries 0\` |
| Mở trình duyệt khi chạy | \`npx e2e run --headed\` |
| Số worker | \`npx e2e run --workers 4\` |
| Theo tag | \`npx e2e run --tag @smoke\` |
| Chỉ test fail lần trước | \`npx e2e run --last-failed\` |

Run chạy từ terminal vẫn được lưu: có reporter thì xem live, không có thì lưu khi run xong (lúc dashboard đang mở).

## 7. Đọc kết quả, triage, gửi Linear

1. **Live**: test fail hiện ngay trong danh sách dưới Gantt; run xong có sẵn nút Phân tích lỗi, Gửi Linear, Chạy lại… Thanh trên cùng cho biết CPU, RAM, disk của máy và tài nguyên run đang dùng.
2. **Runs** → bấm run → bấm test fail: timeline agent, video theo step, screenshot lúc fail, log app, trace.
3. **✨ Phân tích lỗi**: AI phân loại lỗi app / test / flaky / môi trường và gợi ý sửa.
4. **Tìm commit gây lỗi** sinh lệnh \`git bisect run\`; **Sửa bằng Claude Code** copy lệnh để dán vào Claude Code.
5. **Triage lỗi**: đặt trạng thái, người phụ trách, ghi chú cho từng lỗi.
6. **Gửi Linear**: chọn *Loại* (Bug cần *Mã issue liên quan*, Task thì tuỳ chọn), sửa và xem trước rồi gửi; issue có fingerprint để chống trùng (cần API key hoặc MCP Linear, xem phần 2).

## 8. Tính năng AI

- Phân tích lỗi, phân tích run, tóm tắt run tự động, *Vì sao flaky?*, *Chuyển thành locator*, *Viết test* cho route chưa có test (trang Coverage).
- **Issue Linear → testcase → e2e**: lấy issue, AI đề xuất testcase, rồi sinh file \`tests/linear/<ID>.e2e.ts\`.
- Model và effort chọn ở *Cài đặt hệ thống › AI & tự sửa lỗi*. Thư mục nguồn và Prompt mô tả hệ thống đặt ở tab **Dự án**: mọi lần gọi AI đều kèm phần này.
- AI chạy trong sandbox chỉ đọc (\`Read/Grep/Glob\`), tối đa 2 phân tích cùng lúc, timeout 5 phút.

## 9. Cấu hình hay dùng

Đặt trong \`.e2e-dashboard/config.json\` của project (mọi khoá đều tuỳ chọn):

| Khoá | Ý nghĩa |
|---|---|
| \`retention\` | Số run giữ lại (mặc định 50; run đã ghim không tính) |
| \`port\` | Port ưu tiên (mặc định 4477; bận thì lấy port kế tiếp) |
| \`ai\` | Model và ngôn ngữ trả lời, vd. \`{ "model": "sonnet", "language": "vi" }\` |
| \`thresholds\` | Ngưỡng màu trạng thái (pass rate, thời gian…) |
| \`screenshots\` / \`videos\` | \`"all"\` để giữ cả của test pass |
| \`coverage\` | \`routes\`, \`ignore\`, \`source\`, \`domainIgnore\` cho trang Coverage |
| \`notify\` | \`"all"\` \\| \`"failures"\` \\| \`"off"\` |

Secret (Linear API key, webhook, email) chỉ đặt ở \`~/.e2e-dashboard/config.json\` hoặc biến môi trường, **không** đặt trong repo.

## 10. Xử lý sự cố

| Triệu chứng | Cách xử lý |
|---|---|
| \`Unknown command: /e2e-dashboard\` | \`/reload-plugins\` (hoặc mở lại Claude Code); vẫn lỗi thì dùng \`/e2e-dashboard:e2e-dashboard\` |
| \`Không tìm thấy e2e.config…\` | Chạy lệnh trong thư mục project e2e (hoặc thư mục con) |
| Trang Live trống khi chạy test | Chưa gắn reporter: \`/e2e-dashboard setup\` |
| Trình duyệt báo \`401\` | Mở lại bằng \`/e2e-dashboard\` (URL có token mới) |
| Không thấy run cũ | Tăng \`retention\` hoặc ghim run cần giữ |
| Server không lên | \`/e2e-dashboard status\`, xem \`.e2e-dashboard/server.log\` |
| Live báo running mãi | Bấm **Dừng run** ở trang Live để xoá trạng thái |
| Gửi Linear không được | Kiểm tra API key ở tab Tích hợp, hoặc \`claude mcp list\` rồi \`/mcp\` để đăng nhập Linear |
`;
