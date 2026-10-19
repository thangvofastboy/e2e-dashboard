# e2e-dashboard-tab

Mod cho Claude Code: thêm pane **E2E** để theo dõi run của [e2e-dashboard](../../README.md) ngay trong session, không cần mở trình duyệt.

## Pane hiển thị

- Trạng thái run, tiến độ `done/total`, thời gian còn lại ước tính, tên các test đang chạy.
- Pass rate và so với run trước; số pass / flaky / fail / skip.
- Gate, SLO, cảnh báo vượt ngân sách token, top test flaky.
- Nút **Chạy test** / **Dừng run** và link mở dashboard web.
- Trên Claude Desktop: vòng tiến độ, thanh kết quả và biểu đồ xu hướng 10 run bằng SVG có chuyển động. Trên terminal: bản text.
- Toast khi run xong, khi SLO vượt mục tiêu hoặc khi vượt ngân sách.

## Cài đặt

Cần plugin `e2e-dashboard` đã cài và dashboard đang chạy (`/e2e-dashboard`), vì pane đọc dữ liệu từ `.e2e-dashboard/` và API của dashboard.

```text
/plugin marketplace add thangvofastboy/e2e-dashboard
/plugin install e2e-dashboard-tab@e2e-dashboard
/reload-plugins
```

Mở pane bằng `/e2e-pane` (hoặc `/e2e-dashboard pane` với plugin từ v0.22.0).

Thử không cần cài, từ thư mục repo:

```bash
claude --plugin-dir mods/e2e-dashboard-tab
```

Cập nhật và gỡ:

```text
/plugin marketplace update e2e-dashboard
/plugin update e2e-dashboard-tab@e2e-dashboard
/plugin uninstall e2e-dashboard-tab@e2e-dashboard
```

## Lệnh

| Lệnh | Việc |
|---|---|
| `/e2e-pane` | Mở pane (chỉ poll khi pane đang mở; đóng pane là dừng) |
| `/e2e-pane theme <default\|ocean\|forest\|sunset\|light>` | Đổi theme; không có tên thì xem theme hiện tại |
| `/e2e-pane motion <on\|off>` | Bật / tắt chuyển động của biểu đồ trên Desktop |

## Cách hoạt động và giới hạn

- Tiến độ đọc từ `.e2e-dashboard/runtime/live.json` mỗi giây. `live.json` không được ghi quá 5 phút thì coi là run đã dừng.
- Số liệu lấy từ `/api/runs` (5 giây một lần) và `/api/gate`, `/api/slo`, `/api/cost`, `/api/flaky` (15 giây một lần), bằng port và token trong `.e2e-dashboard/server.json`.
- Nút **Chạy test** gọi `POST /api/run`, **Dừng run** gọi `POST /api/run/stop`.
- Pane hiện link dashboard kèm token: đừng chia sẻ màn hình khi pane đang mở.
- Chưa kiểm chứng đầy đủ trên Claude Desktop: phần vẽ SVG và chuyển động dựa theo tài liệu của mod API. Nếu chuyển động bị chớp, tắt bằng `/e2e-pane motion off`.

## Phát triển

Sửa mod thì tăng `version` trong `.claude-plugin/plugin.json` **và** trong mục `e2e-dashboard-tab` của `.claude-plugin/marketplace.json` (Claude Code chỉ cập nhật khi version đổi; `npm test` kiểm tra hai số này khớp nhau). Kiểm tra bằng `claude plugin validate mods/e2e-dashboard-tab`.
