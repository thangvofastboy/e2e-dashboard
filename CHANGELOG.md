# Changelog

## v0.15.0 — 2026-10-14

- **Chạy có / không giao diện (headed)**: công tắc ở *Tự động & lưu trữ → Chạy & lịch* (mặc định tắt) và trong hộp thoại Run; áp cho chạy tay, chạy lại, chạy qua MCP và Lịch chạy (lịch bật riêng được, không thì theo Settings).
- **Claude chạy test qua dashboard**: tool MCP `e2e_run_start` / `e2e_run_stop` (cần dashboard đang mở). Run đi qua dashboard nên có nút Dừng, tài nguyên và tiến độ ở Live như khi bấm tay.
- **Tests dạng cây thư mục**: gập / mở thư mục kèm số test và số fail, mỗi file một dòng tóm tắt, chọn cả thư mục, nút *Tải lại*; tên test dài tự xuống dòng. Ô chọn test ở QC xác nhận và Mẫu QC có ô lọc (gõ không dấu vẫn khớp) và hiện theo cây.
- **Live**: danh sách test fail riêng ngay dưới Gantt, run xong có đủ nút như Runs (Phân tích lỗi, Bước tái hiện, Gửi Linear, Tìm commit gây lỗi, Sửa bằng Claude Code, Chạy lại đúng test); thanh CPU / RAM / disk của máy và RAM / CPU / số tiến trình của run đang chạy; *Xem ở Runs* mở thẳng run vừa chạy.
- **Bối cảnh dự án cho AI** (*Cài đặt hệ thống → Dự án*): nhiều thư mục nguồn kèm mô tả và một Prompt về hệ thống, rule, workflow; mọi lần gọi AI đều gửi kèm (`--append-system-prompt`), AI được đọc các thư mục đó (chỉ đọc). Không nhận `/` hay thư mục home.
- **Chất lượng test**: *Tính lại* và *AI đánh giá lại* chọn model và effort cho riêng lần đó.
- **Gửi Linear: Loại Task / Bug**: Bug bắt buộc *Mã issue liên quan*; dòng `Loại: … · Liên quan: …` đứng đầu mô tả, gắn label Bug / Task của team nếu có. Tự log bug gắn Bug.
- **Giao diện**: nút chỉ còn icon, rê chuột hiện tên (tắt ở *Giao diện*); Coverage chia tab *Route* / *Domain trong source*; tab *Hướng dẫn* từng bước trong Cài đặt hệ thống; bảng cấu hình máy (hostname, OS, CPU, RAM, ổ đĩa, trình duyệt).
- **Sửa lỗi**: trang Issue Linear trắng vì icon không tồn tại (thêm test quét mọi tên icon); *Viết test cho* route lấy từ `coverage.source` / `coverage.routes` báo 404; ô lọc và dropdown đè lên nhau ở Tests, Runs, Digest, Report, Build, Branches; panel Xu hướng chồng nhau ở màn hẹp; nút phóng to che chip; mô tả trang chưa full width; lưu setting khi một thư mục nguồn tạm vắng mặt từng làm mất cả danh sách.
- **Hiệu năng**: `/api/resources` ~200 ms → ~1,5 ms; quét `coverage.source` giữ 30 giây (~350 ms → <1 ms trên repo frontend lớn); `/api/system` không chạy git hai lần; Live không vẽ lại cả trang mỗi lần cập nhật tài nguyên; ô chọn test lọc nhanh hơn ~50 lần.

## v0.14.0 — 2026-10-14

- **Lịch chạy test tự động** (Tự động & lưu trữ → Lịch chạy): tạo lịch theo giờ trong ngày và thứ trong tuần, chọn project, chạy toàn bộ suite hoặc chọn từng test, cùng các option như hộp Chạy test (workers, retries, trình duyệt, tag, grep, shard, trace/video…). Có nút *Chạy ngay*, *Sửa*, *Xoá*. Lịch lưu ở `~/.e2e-dashboard/schedules.json`; dashboard nào đang mở cũng chạy hộ mọi project, mỗi lượt chỉ một dashboard chạy. Không có dashboard nào mở thì lịch không chạy.
- **Đồng bộ từ CI có form cấu hình**: nút *Thêm đồng bộ từ CI* / *Sửa cấu hình* ghi workflow, artifact, branch và chu kỳ vào `.e2e-dashboard/config.json` (giữ nguyên các khoá khác), áp dụng ngay không cần khởi động lại.
- **Projects → Thêm project**: chọn thư mục project bằng hộp duyệt thư mục hoặc gõ đường dẫn. Thư mục đã có trong danh sách thì báo lại, không tạo bản ghi mới.
- **Tải về có popup**: mọi nút xuất dữ liệu (CSV, Export HTML của run, Tải .md của digest) hiện popup với tên file sửa được và dung lượng, bấm *Tải về* mới lưu.
- **Dropdown đẹp hơn**: danh sách item của select vẽ theo theme (padding, hover, dấu ✓ ở mục đang chọn) ở trình duyệt hỗ trợ base-select; trình duyệt cũ giữ popup gốc.

- **Sửa lỗi**: ô lọc *Tag* / *Target* ở trang Tests không còn bị select đè lên nhãn ở khung hẹp.

## v0.13.0 — 2026-10-14

- **Issue Linear → testcase → e2e** (menu mới *Theo dõi → Issue Linear*): lấy issue được giao cho các email đã chọn và có status trong danh sách (nhập ở *Cài đặt hệ thống → Tích hợp*), thêm issue bằng mã hoặc link, nút *Lấy lại danh sách*. *Phân tích* để AI đọc tiêu đề, mô tả và comment rồi đề xuất testcase; sửa, lưu, mở lại bản đã lưu. *Gen e2e* để AI viết `tests/linear/<ID>.e2e.ts` theo quy ước của project, không ghi đè file có sẵn.
- **Lấy lại danh sách giữ công sức đã làm**: issue đã có testcase hoặc thêm tay không bị bỏ khi đổi người hay đổi status; lỗi Linear thì danh sách cũ giữ nguyên.
- **An toàn**: nội dung issue, comment và output AI nằm trong khối dữ liệu, không thành chỉ dẫn; mã issue và đường dẫn file được kiểm tra; lỗi Linear trả 502, không bị ghi như lỗi server.

## v0.12.0 — 2026-10-14

- **Bảo mật**: thư mục `.e2e-dashboard`, `server.json`, `report.json` / `meta.json` hay `.env.example` là symlink (repo clone cài sẵn) không còn bị đọc hay ghi xuyên qua; file export lấy tên theo run id đã kiểm tra; token có ký tự lạ trả 401 thay vì lỗi 500; tiêu đề test trong prompt "Copy cho Claude" nằm trong khối dữ liệu, không thành chỉ dẫn; thông báo desktop không bị tiêu đề bắt đầu bằng `-` làm hỏng.
- **Không còn sập vì dữ liệu hỏng**: dòng lạ từ Claude CLI, `ai-trace.json` hỏng, phản hồi Linear / Linear MCP rỗng, file trạng thái hỏng (cảnh báo, đồng bộ CI, cách ly, test thủ công, mẫu QC), body request không phải object, tin nhắn MCP lạ, sendmail thoát sớm, file bị xoá giữa lúc quét dung lượng, `meta.json` hỏng khi chia sẻ run.
- **Sửa lỗi**: tự log bug không tạo issue trùng khi hai lượt archive chạy cùng lúc; *Phân tích lại* khi self-heal đang sửa bị từ chối (không mất bản sửa); phát hiện test trùng tính cả test trong serial group; link trong Markdown có `*` không bị hỏng; so ảnh pixel xong muộn không vẽ đè kiểu xem đã chọn; trang không tự tải lại khi đã chuyển trang khác; form góp ý / test thủ công không gửi hai lần; ô lọc người phụ trách ở Triage gõ được liền mạch.
- **Hiệu năng**: trang Cài đặt hệ thống tải song song; xu hướng dài hạn không vỡ stack khi lịch sử rất lớn.

## v0.11.0 — 2026-10-13

- **Gửi Linear qua MCP của Claude CLI**: chưa có Linear API key thì dashboard tự tìm trùng, tạo issue và comment qua MCP Linear (cần đăng nhập một lần: chạy `claude`, gõ `/mcp`). Có API key thì luôn dùng key. Cài đặt hệ thống → Tích hợp cho biết đang dùng cách nào. Tự log bug cũng dùng được cách này.
- **AI cho bug**: ở test fail có *Bước tái hiện* (viết cho người không biết code) và *Mức độ nghiêm trọng* (Critical / High / Medium / Low kèm lý do, để QC duyệt); ở Run detail có *Gom bug trùng* nhóm các test fail cùng nguyên nhân.
- **Bảo mật**: MCP Linear chỉ đọc cấu hình người dùng và chạy trong thư mục rỗng (repo bị clone không cài được hook qua `.mcp.json` / settings); bằng chứng gom bug nằm trong khối dữ liệu không tin cậy; issue do Claude tạo phải đúng tiêu đề yêu cầu.
- **Giao diện**: icon có màu theo ý nghĩa và mọi mục menu đều có màu; dropdown thống nhất ở mọi trang; mục đang chọn ở menu bên trái nổi rõ cả khi dark mode; mỗi trang có mô tả ngắn dưới tiêu đề; ô nhập trong hộp thoại Run rộng hơn, có dòng giải thích và giá trị mặc định; ô trong Cài đặt có mô tả.
- **Lint và Gợi ý locator**: khi không có step `agent.*` nào, trang nói rõ đã quét bao nhiêu run và step, thay vì báo "không có cảnh báo". Mọi trang phân tích có nút *Phân tích lại*.
- **Hiệu năng / dọn mã**: bỏ import thừa; chỉ quét step agent khi trang trống.

## v0.10.0 — 2026-10-13

- **QC xác nhận** (trang mới, menu Theo dõi): hàng đợi *Chờ xác nhận* cho known bug mà run mới nhất đã pass (*Đã sửa* gỡ known bug sau khi xác nhận, *Chưa đúng* giữ lại và ẩn run đó cho tới khi có run pass mới hơn); **waiver có hạn** bỏ một test fail khỏi cổng chất lượng đến hết ngày đã chọn (bắt buộc lý do, tối đa 365 ngày); **nhật ký thay đổi** ghi mọi lần đổi ghi chú, known bug, waiver và xác nhận (500 dòng gần nhất).
- **Bộ lọc đã lưu**: nút ngôi sao cạnh tiêu đề mỗi trang lưu trang kèm bộ lọc với một cái tên, mở lại bằng một cú bấm; lưu trong trình duyệt của từng người.
- **Hiệu năng / dọn mã**: hàng đợi chờ xác nhận duyệt lịch sử một lần thay vì một lần cho mỗi known bug; bỏ `export` thừa.

## v0.9.1 — 2026-10-13

- **Hiệu năng**: `app.js` và `style.css` được nén gzip khi trình duyệt cho phép (~420 KB còn ~130 KB), nén một lần cho mỗi phiên bản của file, có ETag riêng cho bản nén nên vẫn nhận 304.
- **Dọn mã**: xoá các export và hằng không còn ai dùng (`exploreSummary` và test của nó, `runIdOf`, `BROWSER_LABEL`, `RESET_SCOPES`).
- **README**: ghi chú về nén gzip.

## v0.9.0 — 2026-10-13

- **Đối chiếu với docs của e2e**: hộp thoại Run có thêm tag, tag-mode, exclude-tag, grep, shard, max-failures, strict-cache, trace, video, `--last-failed`, `-u` và `--ai-trace`; tab *Model* ở Run detail xem từng lần gọi model (token, độ trễ, prompt, phản hồi) từ `ai-trace.json`; trang Chi phí & cache có bảng replay cache và xoá theo test / mồ côi / toàn bộ; `import` nhận `junit.xml`; Live báo run dừng sớm do `--max-failures`; trang Môi trường tách thêm theo agent và engine; cảnh báo video / file `redaction: incomplete` trước khi chia sẻ.
- **Phân loại lỗi theo lớp**: lỗi hạ tầng và cấu hình (model provider, credential, worker…) không tính vào pass rate; cổng chất lượng báo riêng; Run detail hiện nhãn lớp lỗi và ý nghĩa exit code.
- **Công cụ cho QC**: ghi chú QC và mã known bug theo test (known bug không bị tính là fail mới ở cổng chất lượng, có bộ lọc *Chỉ / Ẩn known bug*), copy bug report Markdown, test thủ công, ma trận test × build kèm xuất bug CSV, chấm điểm chất lượng từng test, phát hiện test trùng và đề nghị tách / gộp (kèm prompt cho Claude Code, dashboard không tự sửa mã test), lọc triage theo người phụ trách.
- **Mẫu prompt QC**: prompt có chỗ trống `{{...}}` điền dữ liệu của test hoặc run; chép đi hoặc để AI viết bug report, báo cáo, mô tả Linear. Hộp thoại Linear có nút *Viết bằng mẫu QC* và vẫn giữ dòng fingerprint.
- **Linear**: gắn issue có sẵn vào một bug (xác minh với Linear, tự đánh dấu known bug, không tạo trùng), gỡ liên kết (issue trên Linear giữ nguyên), gửi issue từ dashboard tự đánh dấu known bug.
- **Tự log bug (mặc định tắt)**: run có test fail do app thì AI soạn và tạo issue Linear, chống trùng, tối đa 5 issue mỗi run; known bug fail lại với lỗi khác thì comment lỗi mới vào issue đó, mỗi dạng lỗi một lần; có nút bấm tay ở Run detail.
- **Gửi phản hồi**: form góp ý, báo lỗi về dashboard, tạo issue trên GitHub của dự án qua `gh`; chỉ gửi sau khi tick xác nhận công khai, từ chối nội dung có dạng token, tối đa 5 lần trong 10 phút.
- **Reset All**: Cài đặt hệ thống → Reset xoá cài đặt, dữ liệu, hoặc cả cấu hình chung của máy; popup cảnh báo và phải gõ `RESET`; chỉ xoá đúng danh sách tên cố định, không theo symlink, từ chối khi đang có run.
- **Xác nhận mọi thao tác nguy hiểm**: một hộp thoại dùng chung thay `confirm()` của trình duyệt (mặc định focus *Huỷ*, Esc để thoát), thêm xác nhận cho xoá webhook, xoá Linear key, gỡ project, xoá sự kiện, gỡ cách ly, dừng run, ghi đè snapshot `-u`, bật tự log bug và tự sửa lỗi; test tĩnh bảo đảm không thao tác nguy hiểm nào thiếu xác nhận.
- **Dọn rác**: Cài đặt hệ thống → Dọn dẹp quét 6 nhóm (file ghi dở `.tmp-*`, run lưu thiếu file, log lớn, báo cáo xuất cũ, replay cache cũ / mồ côi, thư mục tạm nhập từ GitHub), hiện số mục và dung lượng từng nhóm; chỉ xoá nhóm được chọn sau popup xác nhận. Server tự quét lại khi dọn, chỉ xoá mục đủ cũ và không đi qua symlink.
- **Cài đặt chia tab dọc**: Cài đặt hệ thống (Giao diện, Project, Tích hợp, AI, Hệ thống, Reset) và Tự động & lưu trữ (Chạy & lịch, Thông báo & CI, Lưu trữ); ô số liệu tổng quan, nút, công tắc và file `.env` lớn hơn, nội dung rộng ra.
- **Bảo mật**: AI viết nội dung QC (và tự log bug, nơi kết quả được đăng lên Linear không ai duyệt) nay chạy không có công cụ nào, dữ liệu từ app / test đi qua khối rào ngẫu nhiên và kết quả có dạng token bị bỏ (trước đây thông báo lỗi do app tạo ra có thể đóng vai chỉ thị); `ai-trace.json` từ repo hoặc CI không còn chèn được HTML vào trang (trường `attempt`); Reset không còn xoá file ngoài project khi repo cài sẵn `.e2e-dashboard/state` là symlink.
- **Sửa lỗi**: bộ test rò rỉ thư mục tạm trong `/tmp` (tmpfs, nằm trong RAM): mỗi lần `npm test` bỏ lại ~60 MB, vài trăm lần chạy chiếm hết 16 GB; nay `npm test` nạp `test/_tmpclean.mjs` xoá mọi thư mục `mkdtemp` khi tiến trình thoát (có test hồi quy); thuộc tính `hidden` bị lớp CSS đè (nút và ô ẩn vẫn hiện); `{{constructor}}` trong mẫu prompt đọc nhầm thuộc tính kế thừa; danh sách trùng và bảng chất lượng lấy lệch run khi run mới nhất rỗng; tự log bug chạy lặp khi một run được lưu hai lần; dọn import thừa.
- **Hiệu năng**: ma trận build nạp tối đa 60 report, `junit.xml` tối đa 10 MB, `ai-trace.json` chỉ phân tích một lần khi mở lần lượt các lần gọi model; Run detail dùng ghi chú đã tải cùng run và giữ danh sách mẫu 20 giây thay vì tải lại mỗi lần chọn test.

## v0.8.10 — 2026-10-12

- **Tự sửa lỗi: danh sách file đổi lấy từ index**: trước đây tên file đọc từ `git status` bị lệch 1 ký tự ở dòng đầu (output bị trim), nên phạm vi cho phép kiểm tra sai file. Giờ lấy bằng `git diff --cached --name-only -z`.
- **Tự sửa lỗi: diff luôn là văn bản, không cho duyệt bản quá lớn**: file nhị phân không còn hiện "Binary files differ" để người duyệt bỏ sót; diff quá 12.000 ký tự thì bỏ bản sửa thay vì cho duyệt phần không thấy hết.
- **Công tắc toggle thay checkbox**: sự kiện webhook, tự tóm tắt AI, bật tự sửa lỗi, SQLite, watch, tự động theo máy, `--no-cache`, bỏ qua test cách ly, và "Hiện cả test không đổi" ở trang So sánh.
- **Ô nhập trong Cài đặt rộng hơn**: Linear key, Linear team, URL webhook, Model giãn theo hàng thay vì co theo nội dung.
- **README và ảnh chụp mới**: ảnh chụp lại ở 1280×800 (Overview sáng/tối, Run, Flaky, So sánh, Bản đồ route, Locator, trang test, thêm ảnh Cài đặt hệ thống); mục tính năng, sơ đồ dữ liệu theo ngày, bảo mật và lệnh `doctor` được cập nhật; Node ≥ 22.

## v0.8.9 — 2026-10-12

- **Tự sửa lỗi chờ bạn duyệt**: AI sửa xong chỉ commit vào branch local rồi dừng ở trạng thái *Chờ bạn duyệt*, kèm diff ngay trên trang Cài đặt hệ thống. Chỉ khi bấm **Chạy test & tạo PR** dashboard mới chạy `npm test`, push và mở PR draft, trên đúng commit bạn đã xem. **Bỏ bản sửa** xoá branch. Trước đây code AI viết được chạy (`npm test`) ngay mà chưa ai đọc.
- **Trạng thái tự sửa lỗi nằm ngoài repo**: danh sách lỗi và file crash chuyển sang `~/.e2e-dashboard/selfheal/`. Một repo lạ không còn cài sẵn được "lỗi" trong `.e2e-dashboard/` để đưa vào AI và bước sửa code. File `selfheal.json` cũ trong project không còn được đọc.

## v0.8.8 — 2026-10-12

- **Báo lỗi gốc trên trang Live**: setup fail, hoặc ≥3 test fail cùng một lỗi (thiếu file auth, thiếu `.env`…), hiện banner đỏ ngay đầu trang kèm nguyên văn lỗi — không cần bấm từng test.
- **`/e2e-dashboard setup` tạo `.env`**: chưa có `.env` thì copy từ `.env.example` (không ghi đè file đã có) và chắc chắn `.env` nằm trong `.gitignore`.
- **Gantt ngang ở trang Live**: mỗi làn một hàng, thời gian trái → phải, trục có vạch chia tròn (0s, 10s, 1m…), chú thích màu theo trạng thái đang có.
- **Thanh tỉ lệ thay cho donut**: Run gần nhất (Overview), trang Run, cache và giai đoạn (Cost) dùng thanh 100% chia đoạn — đoạn nhỏ vẫn thấy, rê chuột xem số và %. Trục Y của *Setup + hook theo run* hiện thời gian thay vì mili-giây.
- **Bảng và list dài cuộn trong khung**: bảng, nhóm lỗi, danh sách fail, timeline step… cao tối đa 70% màn hình, không kéo dài cả trang; tiêu đề bảng dính ở đầu khung.
- **Live gửi phần thay đổi**: sau bản đầy đủ lúc kết nối, server chỉ gửi test vừa đổi và dòng output mới; step của test đã xong tải khi bấm vào; các trang khác chỉ nhận tiến độ. Run 1000 test × 15 step: tab Live nhận 0.8MB thay vì 321MB, tab khác 0.03MB; CPU server 2.2s thay vì 5.6s, RAM đỉnh 108MB thay vì 248MB. Trang Live không dựng lại cả trang mỗi giây và giữ vị trí cuộn.
- **RAM server**: cache report giới hạn ~48MB text JSON (LRU) thay vì 400 report bất kể kích thước.
- **Trang vừa một màn hình (desktop)**: khối dữ liệu chính (bảng, nhóm lỗi, danh sách…) lấp phần còn lại và cuộn bên trong; Overview gộp health score với KPI, chart 4 cột trên màn rộng; Xu hướng, Vòng đời, Cài đặt, Báo cáo dồn gọn. Mobile vẫn cuộn cả trang.
- **Nút có màu theo tính năng**: chạy = xanh lá, xoá / dừng = đỏ, xem / tải / sao chép = xanh dương, gửi / ticket = xanh ngọc, ghim / khoá / thử lại = cam, AI = tím. Ô nhập và dropdown rộng hơn.
- **Phóng to toàn màn hình**: nút ở góc mỗi chart, panel và bảng (hiện khi rê chuột), và cạnh tiêu đề để phóng to cả trang; Esc để thoát.
- **Chú giải**: ⓘ cạnh tiêu đề mỗi trang và cạnh tên chart, rê chuột hoặc Tab tới để đọc. Ví dụ cấu hình JSON ở trang Cài đặt gom vào mục *Cách cấu hình*.
- **Sửa**: mô tả dưới tiêu đề trang chiếm hết bề ngang.

- **Cỡ chữ lớn hơn** (~10%) và chỉnh được: Nhỏ / Vừa / Lớn / Rất lớn ở trang Cài đặt hệ thống.
- **Trang Cài đặt hệ thống** (`#/system`): theme, cỡ chữ, ngôn ngữ; xem và sửa trực tiếp `.env`, `.env.local`, `.env.example` (lưu là ghi file, file secret quyền 600 và tự thêm vào `.gitignore`); bảng trạng thái từng key (đã điền / còn giá trị mẫu / chưa có); Linear API key, team, webhook (lưu ở `~/.e2e-dashboard/config.json`, chỉ hiện 4 ký tự cuối); checklist setup và nút *Chạy setup*; model AI và effort.
- **Tự sửa lỗi dashboard bằng AI** (bật / tắt ở Cài đặt hệ thống, mặc định tắt): lỗi server (API 500, crash) và lỗi giao diện được ghi lại; AI local phân tích (chỉ đọc code); nếu là lỗi của e2e-dashboard thì AI sửa trong git worktree tạm (không chạy được lệnh), dashboard chạy `npm test`, push branch và mở PR draft. Mỗi lỗi một PR, giới hạn PR / ngày.
- **AI mới**: tự tóm tắt run có test fail (trang Live và Run), *AI giải thích nhóm lỗi*, *AI gợi ý triage* (trạng thái, mức độ, người phụ trách, nút Áp dụng), *Vì sao chậm / tốn token?* trên trang Run.
- **Chọn model AI và effort** (`--model`, `--effort`) cho mọi tính năng AI; đổi là có hiệu lực ngay.
- **Hiệu năng**: SLO / quality gate không còn đọc lại hàng trăm report mỗi lần mở Overview (1–2s → vài ms, RAM đỉnh ~730MB → ~290MB); Overview gửi request một đợt; `/app.js` có ETag (304); trang Live chỉ cập nhật phần thay đổi, gantt cập nhật theo từng block.
- **Sửa**: phân tích AI cấp run (không gắn test) không còn lỗi 500.
- **Lọc "Chỉ test fail"** ở trang Run, Tests (giữ trong URL `?failed=1` để chia sẻ link) và Live (gantt chỉ hiện block fail, khung step chọn test fail).
- **Tự sửa lỗi an toàn hơn**: AI chỉ được sửa trong `server/ ui/ reporter/ bin/ test/ support/` (đổi `package.json`, workflow… là bỏ, không chạy test); commit / push không chạy git hook; PR chỉ ghi kết luận ngắn + danh sách file đổi; tối đa 5 lỗi chờ, 20 lượt phân tích / ngày; repo phải đúng là e2e-dashboard; branch không mở được PR thì tự xoá.
- **Sửa**: `.env` đã bị track không còn bị thêm vào `.gitignore` mỗi lần lưu; lưu cài đặt song song không mất thay đổi, `config.json` hỏng thì báo thay vì ghi đè; trang Live không lặp dòng output khi mở tab giữa run, không dựng lại tiêu đề mỗi snapshot (nút Dừng giữ hover / focus), step của test chạy lại không bị cũ; lưu một mục ở Cài đặt hệ thống không làm mất nội dung đang sửa trong editor env; toast và tooltip hiện cả khi đang phóng to toàn màn hình.
- **Viết hoa chữ cái đầu** cho nhãn, chú thích, trạng thái và mô tả trên mọi trang (bản dịch tiếng Anh cập nhật theo); dữ liệu (tên test, file, branch, model) giữ nguyên.
- **.env đã bị commit** được báo riêng trong checklist setup (thêm vào .gitignore không gỡ được secret khỏi lịch sử git).
- **Thư mục dữ liệu chia lại**: run lưu ở `runs/YYYY/MM/DD/<giờ>_<runId>/`; file trạng thái ở `state/`, file tạm của server ở `runtime/`, chỉ mục ở `cache/`. Bố cục cũ vẫn đọc được.
- **`/e2e-dashboard doctor [--dry-run]`** (và nút *Chạy doctor* ở Cài đặt hệ thống): chuyển dữ liệu bố cục cũ sang bố cục mới, dọn thư mục tạm, dựng lại chỉ mục, nhắc cập nhật reporter cũ. Không đi theo symlink, không ghi đè. 221 run chuyển trong ~0.35 giây.
- **Chỉ mục SQLite** (tuỳ chọn, mặc định tắt, bật ở Cài đặt hệ thống; cần Node ≥ 22.13, báo lỗi rõ nếu không đủ; `cache/index.sqlite`, dẫn xuất, xoá là tự dựng lại): lịch sử từng test và đếm SLO đọc từ chỉ mục thay vì parse report. Node không có `node:sqlite` thì chạy bằng file như cũ.
- **Dọn rác** (trang Tự động & lưu trữ): chọn run cũ hơn 7 / 30 / 90 ngày hoặc theo khoảng ngày, lọc pass / fail, xem trước số run và dung lượng rồi mới xoá; run ghim không bao giờ bị xoá.
- **Yêu cầu Node.js ≥ 22** (`engines`, checklist setup, lệnh `/e2e-dashboard` báo rõ khi Node cũ).
- **6 tính năng AI mới**: *Viết test từ ticket* (dán ticket, AI viết `.e2e.ts` theo quy ước project, nút *Lưu thành file*, không ghi đè); *AI chọn test* theo thay đổi code (nút chạy đúng các test AI chọn); *AI đề xuất cho cả suite* đổi `agent.act` sang locator; *AI giải thích khác biệt* ảnh expected / actual / diff; *AI tìm test trùng*; *AI viết ghi chú QA* cho bản phát hành.
- **Issue Linear viết như người báo lỗi**: đoạn mở đầu kể lại chuyện gì xảy ra, *Các bước tái hiện* đánh số tới bước lỗi, *Mong đợi / Thực tế*, ảnh minh hoạ (ảnh lúc lỗi, actual / diff) tải thẳng lên Linear, chi tiết kỹ thuật để cuối. Nội dung sửa được trước khi gửi; nút *Viết lại cho tự nhiên (AI)* giữ nguyên dữ kiện, ảnh và dòng chống trùng. Tiêu đề cũng được làm sạch như mô tả.
- **Xem trước và sửa issue Linear trước khi gửi**: hộp thoại mở ở chế độ *Xem trước* (giống trên Linear, ảnh nằm đúng chỗ); *Sửa nội dung* cho sửa cả tiêu đề lẫn mô tả, *Cập nhật xem trước*, *Khôi phục bản gốc*; bản đang sửa được giữ trên trình duyệt (đóng mở lại không mất), gửi xong thì xoá.
- **Thu gọn menu trái**: nút ở đầu menu thu menu thành dải icon (rê chuột thấy tên trang); nhớ lựa chọn trên trình duyệt.
- **Chọn trình duyệt khi chạy test** (Chromium / Firefox / WebKit): mặc định Chromium, đổi ở *Tự động & lưu trữ*; chọn riêng từng lần trong hộp thoại *Chạy test*; trình duyệt chưa cài bị khoá kèm lệnh cài (`npx @e2e-dev/web install …`). Dashboard truyền `E2E_BROWSER` cho `e2e run`; `/e2e-dashboard setup` tự thêm `browser: process.env.E2E_BROWSER ?? 'chromium'` vào `web({...})`. Lịch chạy và watch dùng trình duyệt mặc định; trang Run hiện trình duyệt của run.
- **Sửa sau review**: dọn rác không còn quét toàn bộ lịch sử (chỉ đo / xoá run được chọn, bỏ qua cả run baseline, ngày tính đúng cả hôm đổi giờ); tra run theo id không sắp xếp cả danh sách; ảnh gửi Linear phải nằm thật trong thư mục run; run mới không bị mất khi retention dọn thư mục ngày cùng lúc; project nằm sau symlink vẫn đọc được file trạng thái cũ; chỉ mục SQLite hỏng thì tự dựng lại; bản nháp Linear lưu theo từng run; *Copy cho Claude* gửi đường dẫn ảnh thật; chặn bấm hai lần khi gửi Linear / viết lại; menu thu gọn không làm mất nhóm đã gập; doctor hỏi xác nhận; nội dung ticket giữ lại khi AI lỗi.

## v0.8.7 — 2026-10-12

- **Helper khoanh vùng hành động (`support/markAction.ts`)**: sau một thao tác của test, vẽ khung đỏ quanh element rồi chụp ảnh, gỡ khung ngay. Ảnh là artifact của attempt, hiện ở tab "Video & ảnh". Tắt bằng `E2E_MARK=0`.
- **Giải phóng ghi chú release**: tag và GitHub Release mang nội dung CHANGELOG của version (đã có từ v0.8.6).

## v0.8.6 — 2026-10-12

- **Coverage: quét source**: đặt `"coverage": { "source": "<repo app>" }` để quét route (router, `href`, `navigate`) và domain trong code. Domain nhiễu (w3.org, apollographql…) bị bỏ; thêm bằng `"domainIgnore"`.
- **Coverage: bỏ qua**: nút *Bỏ qua* trên từng route và domain; mục đã bỏ qua không hiện nữa. Mục *Đã bỏ qua* ở cuối trang có nút *Xoá khỏi danh sách*. Lưu ở `.e2e-dashboard/coverage-ignore.json`.
- **Giao diện**: tên "e2e dashboard" trên thanh bên luôn một dòng; cột dài trong bảng Coverage xuống dòng thay vì tràn ngang.

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
