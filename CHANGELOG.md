# Changelog

## v0.8.5 — 2026-10-12

- **Nút Dừng run**: bấm Dừng khi dashboard đã khởi động lại (token đổi) không còn báo sai "run không do dashboard khởi động". Trang Live hiện banner *mất kết nối* và ẩn nút Dừng; mở lại link từ `/e2e-dashboard`.
- **Run từ terminal**: Dừng chỉ đánh dấu được, process vẫn chạy — thông báo nhắc nhấn Ctrl-C ở terminal đó. Run đã kết thúc thì báo rõ là không còn run.

## v0.8.4 — 2026-10-12

- **Trang Live, số worker**: dòng tiến độ hiện `N worker đang chạy (tối đa M)` — M là số làn đã dùng cao nhất trong run.
- **Output đảo thứ tự**: dòng mới nhất nằm trên cùng (50 dòng cuối). Lưu ý: stack trace nhiều dòng đọc từ dưới lên.

## v0.8.3 — 2026-10-12

- **Số worker chạy test**: trang *Tự động & lưu trữ* có mục *Số worker khi chạy test* — tự động theo máy (nửa số core, hoặc `workers` trong `e2e.config`) hoặc số cố định. Áp dụng cho nút Chạy, lịch chạy và watch.
- **Dialog Chạy test**: ô *Workers* điền sẵn mặc định, sửa được cho từng lần chạy; để trống = tự động.
- **Cập nhật plugin**: dashboard đang chạy bản cũ được thay bằng bản mới. Nếu đang có run do dashboard khởi động thì giữ server cũ đến khi run xong, và báo cần chạy lại `/e2e-dashboard`.

## v0.8.2 — 2026-10-12

- **Sửa lỗi chạy test từ dashboard**: chạy test không thấy kết quả. e2e 0.19 gửi kết quả dạng `test.id` và `target.name`, dashboard đọc trường cũ nên mọi test kẹt ở *running* rồi thành *interrupted*, số làn tăng vô lý.
- **Trang Live**: hiện lỗi của test fail ngay (không cần bấm vào test); dòng tóm tắt `8/8 test · 1 pass · 4 fail · 3 skip`; khi run xong tự chọn test fail đầu tiên; đếm `done/done` thay vì `1/3` khi có setup không được chọn.

## v0.8.1 — 2026-10-12

- **Logo và favicon**: logo Fastboy trên thanh bên, favicon là phần tam giác của logo.
- **Trang Live**: làn xếp thành cột theo trục ngang, thời gian chạy từ trên xuống, cuộn ngang khi nhiều làn; output bỏ mã màu ANSI và link terminal (OSC 8).
- **Bảng và danh sách dài**: Tests, Triage, Vòng đời và Nhóm lỗi chỉ hiện 25 (hoặc 10) dòng đầu, có nút *Hiện thêm / Hiện tất cả / Thu gọn*. Bảng rộng hơn khung thì cuộn trong khung, không kéo cả trang.
- **Triage**: link *run* thành nút có icon; cột lỗi cắt còn một dòng, rê chuột xem đủ.
- **Giao diện form**: dropdown và ô chọn ngày/giờ đồng bộ theme sáng/tối; nhãn tháng trên heatmap không đè nhau; mô tả đầu trang rộng hơn.
- **Tiếng Anh**: dịch các chữ mới (nút chia trang, ghi chú làn ở Live).
- **Sửa lỗi**: dòng chèn thêm (So sánh) ẩn/hiện theo dòng đứng trước; favicon không lỗi khi trang thiếu thẻ icon; `select` dài không đẩy lệch layout trên màn hình hẹp.

## v0.8.0 — 2026-10-11

- **Giao diện kiểu báo cáo**: status viết hoa, căn giữa, cùng độ rộng; tiêu đề bảng viết hoa; cột số căn phải in đậm; cột pass rate / fail / flaky tự tô màu đánh giá; số KPI và số quan trọng trong banner nổi bật.
- **Tô màu code và dữ liệu**: JSON (dàn lại cho dễ đọc), code JS/TS, lệnh shell, đường dẫn `file:line`, log tô theo mức lỗi.
- **Hoạt cảnh trạng thái**: thanh tiến trình khi đang tải, nút quay khi đang xử lý, nhãn *Đang chạy 3/9* nổi trên mọi trang, nhịp live và sọc chạy ở trang Live; tắt khi bật *giảm chuyển động*.
- **Mobile và giao diện**: hết khoảng trống trên đầu trang, bảng tự cuộn trong khung, ô nhập đồng bộ, chữ biểu đồ luôn ~11px, dropdown và menu *Thêm* gọn gàng, chữ trên nút chính đủ tương phản ở chế độ tối, ngày cụ thể thay cho "vừa xong" với run cũ hoặc giờ lệch.
- **Trang Live**: nút *Dừng run* xoá được run ngoài terminal bị kill giữa chừng; run dừng thì test dở hiện *interrupted* kèm nút chạy lại.
- **Bảo mật**: chặn symlink `results/` và `artifacts/` (không copy / xoá file ngoài project), CODEOWNERS độc hại không làm treo server, webhook không ping cả kênh, ngữ cảnh lệnh `fix` không bị chèn dòng.
- **Sửa lỗi**: server không sập khi file biến mất lúc tải hay khi `fs.watch` lỗi; đồng bộ CI thử lại khi lỗi mạng; `report/digest --send` trả mã 1 khi gửi lỗi hết; SLO xét đủ khoảng ngày; coverage nhận route dạng slug; triage tự đóng test đã xoá; nhiều chỗ ghi file không còn mất dữ liệu khi ghi đồng thời.
- **Hiệu năng**: cache report và `git log`, `listRuns` song song, luồng live tính một lần cho mọi tab, tick checkbox không vẽ lại cả trang.

## v0.7.0 — 2026-10-11

- **Số liệu dài hạn**: mỗi run được gom vào bản tóm tắt theo ngày và theo test, giữ mãi kể cả khi thư mục run cũ bị xoá theo retention. Trang **Xu hướng** xem 30–365 ngày.
- **Triage lỗi**: mỗi test fail có trạng thái Mới → Đang xem → Đã biết → Đã sửa / Bỏ qua, người phụ trách, ghi chú, link Linear. Fail lại đúng lỗi cũ thì giữ trạng thái; "Đã sửa" mà fail lại thì tự mở lại.
- **MTTR và thời gian đỏ**: thời gian từ lúc test fail đến lúc sửa, branch chính đỏ bao lâu mỗi tuần, test hỏng lâu nhất.
- **Báo cáo tự gửi**: báo cáo tuần/tháng theo lịch (`"reports"`), lưu HTML, gửi webhook (sự kiện `report`) và email qua `sendmail`.
- **Theo module / team**: bảng điểm A–F theo thư mục, tag hoặc CODEOWNERS.
- **Báo cáo phát hành**: so run ở tag git với tag trước, kết luận Sẵn sàng / Có rủi ro / Chưa nên phát hành.
- **Truy vết yêu cầu**: story ↔ test qua tag `@LIN-123`, story nào chưa có test.
- **Lịch nhiệt 12 tháng** kiểu GitHub.
- **Tự đồng bộ từ CI**: kéo report từ GitHub Actions theo chu kỳ (`"ci"`).
- **Cảnh báo tuỳ chỉnh** (`"alerts"`): fail N lần liên tiếp, pass rate dưới ngưỡng, flaky tăng, branch đỏ quá lâu.
- **Sự kiện trên biểu đồ**: deploy, release, sự cố… (`/e2e-dashboard mark`), tag git tự hiện là release.
- **Vòng đời test**: test mới, bị bỏ, đổi tên, luôn fail, commit sửa gần nhất.
- **Trang báo cáo tĩnh** cho cả team: `/e2e-dashboard publish`.
- MCP thêm `e2e_trends`, `e2e_triage`, `e2e_groups`, `e2e_report`.

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
