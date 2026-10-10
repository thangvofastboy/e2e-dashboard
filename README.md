# e2e-dashboard

Plugin Claude Code cho [e2e](https://github.com/tester-army/e2e): dashboard local để xem live, lịch sử và debug các run.

- Không cài thêm gì: chỉ cần Node (e2e đã cần) — 0 dependency, không build.
- Không cần database: mỗi run là một thư mục file (`report.json`, `meta.json`, trace, artifact) trong `<project>/.e2e-dashboard/runs/`.
- Dữ liệu ở `<project>/.e2e-dashboard/` (đã được thêm vào `.gitignore`), giữ 50 run gần nhất (run đã ghim không bị xoá).

## Cài

```
/plugin marketplace add thangvofastboy/e2e-dashboard
/plugin install e2e-dashboard@e2e-dashboard
```

## Dùng

| Lệnh | Việc |
|---|---|
| `/e2e-dashboard` | Mở dashboard (bật server nền nếu chưa chạy) |
| `/e2e-dashboard setup` | Gắn reporter vào `e2e.config.ts` để xem tiến độ live (commit 2 file `e2e-dashboard.reporter.*`) |
| `/e2e-dashboard export [runId]` | Xuất một run thành file HTML tự chứa để gửi cho người khác |
| `/e2e-dashboard status` / `stop` | Xem / tắt server |

Nếu Claude Code báo trùng tên lệnh, gõ tên đầy đủ `/e2e-dashboard:e2e-dashboard`.

Không cài reporter vẫn có lịch sử: run do Claude chạy được lưu qua hook, run bạn tự chạy được lưu khi dashboard đang mở.

## Cấu hình (tuỳ chọn) — `.e2e-dashboard/config.json`

```json
{ "output": ".e2e", "retention": 50, "port": 4477 }
```

## Bảo mật

Server chỉ nghe `127.0.0.1`, mọi request cần token (URL mở từ lệnh `/e2e-dashboard` tự đặt cookie). Reporter tự tắt khi `CI` được set.

## Phát triển

```
npm test                      # node --test, không dependency
node test/seed-demo.mjs       # tạo project demo với 12 run
```
