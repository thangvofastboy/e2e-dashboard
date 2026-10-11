# Changelog

## v0.6.0 — 2026-10-11

- **MCP server**: Claude Code hỏi trực tiếp lịch sử test (`e2e_runs`, `e2e_run`, `e2e_test`, `e2e_flaky`, `e2e_errors`, `e2e_search`, `e2e_health`, `e2e_gate`, `e2e_coverage`, `e2e_digest`).
- **Sửa bằng Claude Code**: nút ở test fail copy lệnh `/e2e-dashboard:e2e-dashboard fix <run> <test>`; Claude đọc lỗi, sửa và chạy lại đúng test.
- **Khoảng trống coverage**: trang của app chưa có test nào đi qua, kèm nút nhờ AI viết test.
- **Cổng chất lượng** `/e2e-dashboard gate`: mã lỗi khi có test mới fail, health/SLO dưới ngưỡng, vượt token.
- **Lỗi theo môi trường**: tỉ lệ fail theo target, OS, trình duyệt, phiên bản e2e, giờ chạy, branch.
- **SLO**: pass rate mục tiêu trong N ngày, budget lỗi còn lại và tốc độ đốt.
- **Webhook mention owner** theo CODEOWNERS (`"mentions"` trong `~/.e2e-dashboard/config.json`).
- **Giao diện tiếng Anh** (beta): nút VI/EN ở cuối sidebar.
- **Video cạnh nhau** phát đồng bộ ở trang So sánh (`"videos": "all"` để giữ video của test pass).
- **Lịch sử lớn**: danh sách run dùng cache meta, trang Runs tải dần 50 run.
- **Báo cáo** in/lưu PDF và **xuất CSV** (run, test, flaky).
- **Có gì mới**: hiện thay đổi sau mỗi lần cập nhật.

## v0.5.0 — 2026-10-10

- Trang riêng từng test, lỗi phía app, test bị ảnh hưởng theo `git diff`, hỏi AI tự do, explore → test.
- Thời gian setup/hook, chế độ watch, lịch chạy, webhook Slack/Discord, trạng thái commit GitHub, quản lý dung lượng.
- UX: bộ lọc trên URL, phím tắt, toast, skeleton, menu thu gọn, mobile.

## v0.4.0 — 2026-10-10

- Tìm kiếm Ctrl K, cách ly flaky, AI vì sao flaky, bisect, model & ngân sách, bất thường, CODEOWNERS, lint agent, nhập CI, thư mục team, comment PR.

## v0.3.0 — 2026-10-10

- Health score, flaky, so sánh 2 run + visual diff, nhóm lỗi, chi phí & cache, bản đồ route, branch, nhiều project.
- Linear chống trùng, digest tuần, status line, thông báo desktop, agent step → locator.
