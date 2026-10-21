<div align="center">

# 🧪 e2e-dashboard

**Dashboard local cho [e2e](https://github.com/tester-army/e2e): theo dõi live, lưu lịch sử, debug test fail và chia sẻ report.**
**Chạy ngay trong Claude Code bằng một lệnh `/e2e-dashboard`.**

![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-d97757?style=for-the-badge&logo=anthropic&logoColor=white)
![Node](https://img.shields.io/badge/Node-%E2%89%A5%2022-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Dependencies](https://img.shields.io/badge/dependencies-0-16a34a?style=for-the-badge)
![Build](https://img.shields.io/badge/build-kh%C3%B4ng%20c%E1%BA%A7n-2563eb?style=for-the-badge)
![Tests](https://img.shields.io/badge/tests-460%20passing-16a34a?style=for-the-badge&logo=checkmarx&logoColor=white)
![AI](https://img.shields.io/badge/AI-claude%20--p-a855f7?style=for-the-badge&logo=anthropic&logoColor=white)
![Database](https://img.shields.io/badge/database-kh%C3%B4ng%20c%E1%BA%A7n-8b5cf6?style=for-the-badge)

[✨ Tính năng](#-tính-năng) · [📸 Ảnh chụp](#-ảnh-chụp) · [🚀 Cài đặt](#-cài-đặt) · [📖 Hướng dẫn](#-hướng-dẫn-sử-dụng) · [⌨️ Lệnh](#️-lệnh) · [✨ AI](#-phân-tích-bằng-ai) · [📊 Phân tích](#-phân-tích-m2) · [🔗 Tích hợp](#-tích-hợp-m3) · [🧰 Mở rộng](#-mở-rộng-m6) · [📈 Theo dõi](#-theo-dõi--báo-cáo-m7) · [🚦 Trạng thái](#-trạng-thái--ngưỡng) · [⚙️ Cấu hình](#️-cấu-hình) · [🔄 Cập nhật](#-cập-nhật--phát-hành) · [🔒 Bảo mật](#-bảo-mật) · [🛠️ Phát triển](#️-phát-triển) · [🗺️ Roadmap](#️-roadmap)

<img src="docs/images/dark-overview.jpeg" alt="Trang Overview ở chế độ tối: 5 thẻ KPI có màu trạng thái, biểu đồ pass rate, thanh tỉ lệ, kết quả theo run" width="100%">

</div>

---

## ✨ Tính năng

| | Tính năng | Mô tả |
|:-:|---|---|
| 📡 | **Theo dõi live** | Tiến độ từng test và step, biểu đồ Gantt theo làn, ước lượng thời gian còn lại (ETA) |
| 🗂️ | **Lịch sử không cần database** | Mỗi run là một thư mục file (`report.json`, `meta.json`, trace, artifact). Giữ 50 run gần nhất, run đã ghim được giữ mãi |
| 🚦 | **KPI có màu sức khoẻ** | Pass rate, run gần nhất, thời gian, token, replay cache tự chuyển 🟢 Tốt · 🟡 Cần chú ý · 🔴 Có vấn đề |
| ▶️ | **Chạy & chạy lại test** | Chọn test (hoặc *Chọn tất cả fail*) → hộp thoại Run: target, agent, retries, repeat-each, `--no-cache` → xem live ngay; run mới ghi lại là chạy lại của run nào |
| ✨ | **Phân tích bằng AI** | Nút *Phân tích lỗi* / *Phân tích run* gọi `claude -p` (không cần API key): phân loại lỗi app / test / flaky / môi trường, bằng chứng `file:line`, gợi ý sửa, hỏi tiếp |
| 🔍 | **Debug test fail** | Timeline của agent (suy nghĩ, thao tác, chuyển trang), video đồng bộ theo step, screenshot lúc fail, log, trace |
| 📊 | **Biểu đồ hiện đại** | Area có gradient, donut, sparkline, stacked bar, heatmap test × run, thanh ngang test chậm nhất |
| 🧮 | **Ma trận test × target** | Thấy ngay lỗi chỉ xảy ra trên một trình duyệt hoặc thiết bị |
| 🌿 | **Git context** | Mỗi run ghi branch, commit, có thay đổi chưa commit hay không |
| 📤 | **Export HTML** | Một file tự chứa (ảnh nhúng base64, có CSP) để gửi qua chat, email hoặc đính kèm issue |
| 🌗 | **Sáng / Tối** | Tự theo hệ điều hành, có nút chuyển và nhớ lựa chọn |
| 📑 | **Giao diện kiểu báo cáo** | Status viết hoa căn giữa; bảng có tiêu đề viết hoa, cột số căn phải in đậm; cột pass rate / fail / flaky tự tô màu đánh giá (xanh · vàng · đỏ); số quan trọng nổi bật |
| 🎨 | **Tô màu code & dữ liệu** | JSON (tự dàn dòng), code JS/TS, lệnh shell, `file:line`, log tô theo mức lỗi: ở Run detail, phân tích AI, config, bisect |
| 💫 | **Hoạt cảnh trạng thái** | Thanh tiến trình khi đang tải, nút quay khi đang xử lý, nhãn *Đang chạy 3/9* nổi trên mọi trang, nhịp live ở trang Live; tự tắt khi hệ điều hành bật *giảm chuyển động* |
| 🔗 | **Deep link** | Mỗi run và mỗi test có URL riêng (`#/run/<id>/test/<id>`) |
| 🔄 | **Tự cập nhật** | `/e2e-dashboard update` lấy tag mới nhất rồi tự `/reload-plugins` |
| ❤️ | **Health score** | Một điểm 0–100 cho cả suite: pass rate, độ ổn định, thời gian, token, replay cache |
| 🔀 | **Flaky** | Test pass nhờ retry hoặc đổi kết quả giữa các run (nặng hơn khi cùng commit), nút *Chạy ×5* để xác nhận |
| ⚖️ | **So sánh 2 run** | Mới fail / đã sửa / vẫn fail / thành flaky, chênh thời gian, token, chi phí; kèm **visual diff** screenshot |
| 🧩 | **Nhóm lỗi** | Gom lỗi cùng mã và cùng dạng thông báo: sửa một chỗ, hết nhiều test |
| 🪙 | **Chi phí & cache** | Token, chi phí ước tính, ngân sách, kết quả replay cache và lý do miss, step chậm nhất |
| 🗺️ | **Bản đồ route** | Các trang test đi qua và nơi hay fail |
| 🌿 | **So sánh branch** | Test nào chỉ hỏng ở một branch |
| 📁 | **Nhiều project** | Mọi project đã mở dashboard trên máy, kèm health score và nút mở |
| 🎫 | **Gửi Linear** | Tạo issue từ test fail, **chống trùng** bằng fingerprint. Có Linear API key thì dùng key (ưu tiên); không có thì tự gửi qua **MCP Linear của Claude CLI** (cần đăng nhập một lần: chạy `claude`, gõ `/mcp`). Cài đặt hệ thống → Tích hợp cho biết đang dùng cách nào |
| 📰 | **Digest tuần** | Tóm tắt Markdown để dán vào Slack/email |
| 📟 | **Status line** | Kết quả run mới nhất (hoặc tiến độ) ngay trong Claude Code |
| 🔔 | **Thông báo desktop** | Báo khi run fail (hoặc mọi run) |
| 🔎 | **Tìm kiếm Ctrl K** | Test, mã lỗi, URL, branch, commit, run id trong 50 run gần nhất, không phân biệt dấu |
| 🔒 | **Cách ly test flaky** | Bỏ test khỏi các run có thời hạn, lệnh `--grep-invert` cho CI, digest nhắc test quá hạn |
| 🧬 | **Tìm commit gây lỗi** | Lần pass gần nhất → lần fail đầu tiên, sinh sẵn lệnh `git bisect run` cho đúng test đó |
| ⚡ | **Bất thường** | Test chậm hoặc tốn token hơn hẳn lịch sử của chính nó (TB + 2σ), có thông báo desktop |
| 🧠 | **Model & ngân sách** | So sánh các model theo `step.model`: tỉ lệ pass, token, thời gian, $ mỗi step, ngân sách theo model |
| ✅ | **Lint câu lệnh agent** | Thiếu bước kiểm tra (cache không được ghi), gộp nhiều mục tiêu, mơ hồ, quá dài, tốn model call |
| 👥 | **CODEOWNERS** | Owner của test hiện ở Run detail, issue Linear và digest |
| ☁️ | **Nhập từ CI** | `report.json` hoặc artifact GitHub Actions (`gh run download`) vào lịch sử, nguồn `ci` |
| 🤝 | **Thư mục team** | `share push/pull`: đẩy và kéo run qua một thư mục chung (đồng bộ / mạng) |
| 💬 | **Comment PR** | Đăng kết quả so sánh 2 run lên PR đang mở của branch qua `gh` |
| 📄 | **Trang riêng từng test** | Pass rate, biểu đồ thời gian/token, các lần fail, step gần nhất, ảnh fail theo thời gian, owner, cách ly |
| 🐞 | **Lỗi phía app** | Lỗi console và request 4xx/5xx từ `appLog`, gom theo dạng, commit đầu tiên xuất hiện |
| 🎯 | **Test bị ảnh hưởng** | Từ `git diff` so với `main`: file test, route đã đi qua, tên test → một nút chạy |
| 💬 | **Hỏi AI tự do** | Hỏi về cả bộ test, Claude nhận tóm tắt 30 run gần nhất |
| ⏱️ | **Setup & hook** | Thời gian setup, beforeEach, afterEach so với thân test |
| 👀 | **Watch & lịch chạy** | Lưu file test là chạy lại; chạy hằng ngày theo giờ đặt sẵn |
| 📣 | **Webhook Slack/Discord** | Run fail, bất thường, digest tuần |
| ✅ | **Trạng thái commit GitHub** | Gắn ✓/✗ của run lên commit qua `gh` |
| 🧭 | **Explore → test** | Xem goal/bước/finding của `e2e explore`, nhờ AI viết nháp test |
| 💾 | **Dung lượng** | Xem dung lượng theo loại, xoá video cũ, xoá run, giữ run fail lâu hơn |
| ⌨️ | **Phím tắt & bộ lọc trên URL** | `?`, `g`+phím, `/`, `j`/`k`/`r`/`a`/`l` ở trang run; link chia sẻ mở đúng bộ lọc |
| 🎯 | **Agent step → locator** | Step `agent.act` replay ổn định được dựng thành code `screen.getByRole(...)` từ cache của e2e |
| 🔌 | **MCP server** | Claude Code hỏi thẳng lịch sử test: `e2e_runs`, `e2e_run`, `e2e_test`, `e2e_flaky`, `e2e_errors`, `e2e_search`, `e2e_health`, `e2e_gate`, `e2e_coverage`, `e2e_digest`; và **chạy / dừng test qua dashboard**: `e2e_run_start`, `e2e_run_stop` (cần dashboard đang mở; có nút Dừng, tài nguyên và tiến độ ở Live như khi bấm tay) |
| 🛠️ | **Sửa bằng Claude Code** | Nút ở test fail copy lệnh `/e2e-dashboard:e2e-dashboard fix <run> <test>`: Claude đọc lỗi, sửa app hoặc test, chạy lại đúng test đó |
| 🕳️ | **Khoảng trống coverage** | Trang của app (`app/`, `pages/`, `src/routes`, `sitemap.xml`, router) chưa test nào đi qua, nút nhờ AI viết test |
| 🚧 | **Cổng chất lượng** | `/e2e-dashboard gate`: trả mã lỗi khi có test mới fail, health/SLO dưới ngưỡng, vượt token |
| 🌐 | **Lỗi theo môi trường** | Tỉ lệ fail theo target, OS, trình duyệt, phiên bản e2e, giờ chạy, branch; chỉ ra nơi fail tập trung |
| 🎯 | **SLO** | Pass rate mục tiêu trong N ngày, budget lỗi còn lại, tốc độ đốt |
| 📣 | **Mention owner** | Webhook run fail tag owner (theo CODEOWNERS) của test fail |
| 🇬🇧 | **Giao diện tiếng Anh (beta)** | Nút VI/EN ở cuối sidebar |
| 🎞️ | **Video cạnh nhau** | Video của 2 run phát đồng bộ ở trang So sánh |
| 🖨️ | **Báo cáo & CSV** | Trang in / lưu PDF, xuất CSV run, test, flaky |
| 🆕 | **Có gì mới** | Hiện thay đổi sau mỗi lần cập nhật |
| 📈 | **Xu hướng dài hạn** | Số liệu gom theo ngày, giữ mãi (kể cả khi run cũ đã bị xoá), xem 30–365 ngày, lịch nhiệt 12 tháng |
| 🎫 | **Triage lỗi** | Mỗi lỗi có trạng thái, người phụ trách, ghi chú, link Linear; tự mở lại khi fail lại, tự đóng khi pass |
| ⏱️ | **MTTR & thời gian đỏ** | Thời gian từ lúc fail đến lúc sửa, branch chính đỏ bao lâu, test hỏng lâu nhất |
| 📬 | **Báo cáo tự gửi** | Báo cáo tuần / tháng theo lịch, gửi Slack (webhook) và email |
| 🧱 | **Theo module / team** | Bảng điểm A–F theo thư mục, tag hoặc CODEOWNERS |
| 🚀 | **Báo cáo phát hành** | So run ở tag git với tag trước, kết luận sẵn sàng hay chưa |
| 🔗 | **Truy vết yêu cầu** | Story ↔ test (`@LIN-123`), story nào chưa có test |
| 🔄 | **Tự đồng bộ CI** | Kéo report từ GitHub Actions theo chu kỳ |
| 🚨 | **Cảnh báo tuỳ chỉnh** | Fail N lần liên tiếp, pass rate dưới ngưỡng, flaky tăng, branch đỏ quá lâu → Slack + tag owner |
| 📍 | **Sự kiện trên biểu đồ** | Deploy, release, sự cố đánh dấu trên biểu đồ xu hướng |
| 🌱 | **Vòng đời test** | Test mới, bị bỏ, đổi tên, luôn fail, commit sửa gần nhất |
| 🌐 | **Trang báo cáo tĩnh** | Xuất cả lịch sử thành thư mục HTML cho GitHub Pages / thư mục chung |
| 🧠 | **AI ghi nhớ dự án** | Thêm / Sửa project (trang *Projects*, hoặc *Cài đặt hệ thống › Dự án*): chọn thư mục chứa test và thêm các thư mục khác của hệ thống (tuỳ chọn) kèm mô tả. Mỗi lần lưu (bối cảnh có đổi), dashboard cho Claude đọc các thư mục đó và viết **bản ghi nhớ về hệ thống** (hệ thống làm gì, các phần, luồng chính, cách tổ chức test, thuật ngữ, chỗ hay hỏng); bản ghi nhớ đi kèm mọi lần gọi AI sau đó. Có trạng thái *đang đọc / đã ghi nhớ / cần đọc lại*, xem được bản ghi nhớ, nút *AI đọc lại dự án* |
| 📝 | **Prompt quy tắc cho AI** | Hộp Thêm / Sửa project có ô *Prompt*: quy ước đặt tên, luồng nghiệp vụ, rule (vd. tài khoản test, không xoá dữ liệu thật). Prompt gửi kèm mọi lần gọi AI của project |
| 📂 | **Chọn project để chạy** | Trang *Projects*: thẻ gọn, project đang chọn có viền và chip *Đang chọn để chạy*; bấm **Chọn để chạy** để chuyển dashboard sang project khác (tự khởi động server của project đó), Run sẽ chạy e2e trong thư mục của nó. Nút copy lệnh mở trong terminal |
| 🧪 | **AI hỗ trợ QC** | Trang riêng (menu *Theo dõi*): **Độ phủ theo yêu cầu** (đối chiếu acceptance criteria với test), **Charter test khám phá** (từ thay đổi code so với nhánh gốc), **Sinh dữ liệu test** (giá trị hợp lệ / biên / không hợp lệ), **Kiểm tra bug trùng** (so với nhóm lỗi đã gặp) |
| 🎨 | **Giao diện tuỳ chọn** | *Cài đặt hệ thống › Giao diện*: bảng màu (Nord, Solarized, Tương phản cao), màu nhấn, mật độ, bo góc, kiểu biểu đồ; mỗi lựa chọn có bản sáng và tối |
| 📈 | **Đổi loại chart trên chart** | Biểu đồ theo thời gian có thanh Đường / Vùng / Cột / Bậc, nhớ riêng từng chart |
| ⚡ | **1 Click Setup** | Trang riêng (menu *Tích hợp*): hệ điều hành, các bước cài theo thứ tự với nút **Cài tất cả** (thư viện, gói AI, Chromium, reporter, `.env`), trạng thái từng bước và log, API key nhập tại chỗ, chọn model AI, sửa URL app / lệnh khởi động trong `e2e.config.ts`. Mở dashboard mà project còn thiếu thì hiện popup cùng nội dung |
| ⚙️ | **Cài đặt hệ thống** | Theme, cỡ chữ, ngôn ngữ; xem và sửa trực tiếp `.env` / `.env.local` (lưu thẳng vào file, file có secret tự vào `.gitignore`); Linear key, webhook, setup và doctor |
| 🎛️ | **Menu gọn mặc định** | *Chi phí & cache*, *Model & ngân sách*, *Gợi ý locator*, *Lint agent* ẩn khỏi menu mặc định; bật lại bằng switch ở *Cài đặt hệ thống › Giao diện › Menu hiển thị* (vẫn mở được bằng Tìm kiếm) |
| 🌐 | **Chọn trình duyệt** | Chromium mặc định, đổi trong Cài đặt: chạy test bằng Firefox hoặc WebKit, kể cả lịch chạy |
| 🛠️ | **Tự sửa lỗi dashboard (có duyệt)** | Lỗi của chính dashboard được AI phân tích và sửa trên branch riêng. **Dừng chờ bạn duyệt diff**; chỉ khi bấm *Chạy test & tạo PR* mới chạy `npm test`, push và mở PR draft |
| ✨ | **AI mở rộng** | Tóm tắt run, giải thích nhóm lỗi, triage, vì sao chậm, viết test từ ticket, chọn test bị ảnh hưởng, gom locator, tìm test trùng, nháp release notes, giải thích visual diff |
| 📦 | **Dữ liệu theo ngày + SQLite tuỳ chọn** | Run lưu theo `runs/YYYY/MM/DD/`, trạng thái ở `state/`, file tạm ở `runtime/`. Chỉ mục SQLite (tắt mặc định) cho lịch sử lớn |
| 🧹 | **Dọn run theo khoảng ngày** | Lọc theo trạng thái và khoảng thời gian rồi xoá run cũ trong một lần |
| 🗂️ | **Thu gọn menu & phóng to** | Menu trái gập thành thanh icon; mỗi chart, bảng, danh sách phóng to toàn màn hình (Esc để thoát) |
| 🧾 | **Linear có xem trước** | Sửa tiêu đề và nội dung, xem trước, nhờ AI viết lại theo giọng tự nhiên, đính kèm ảnh minh hoạ trước khi gửi |
| 🎟️ | **Issue Linear → testcase → e2e** | Lấy issue được giao cho các email đã chọn (lọc theo status), AI đọc mô tả và comment rồi đề xuất testcase; sửa, lưu, rồi AI viết `tests/linear/<ID>.e2e.ts` (không ghi đè file có sẵn) |
| 🎬 | **Record → testcase → test** | Mở trình duyệt, thao tác thật: dashboard ghi lại bằng `playwright codegen`, AI viết testcase kèm kết quả mong đợi, bạn sửa rồi lưu `tests/recorded/<tên>.spec.ts` (chạy ngay bằng runner Playwright); tuỳ chọn AI Gen `*.e2e.ts`. Mật khẩu / token bị che thành `process.env.E2E_SECRET_<n>`. Cần máy có màn hình. |
| 🧠 | **Model calls (`--ai-trace`)** | Tab *Model* ở Run detail: từng lần gọi model của test (model, token, độ trễ, prompt và phản hồi đầy đủ khi mở), từ `ai-trace.json` |
| 🧭 | **Phân loại lỗi theo lớp** | Lỗi hạ tầng / cấu hình (model provider, credential, worker…) không tính vào pass rate; cổng chất lượng báo riêng, Run detail hiện nhãn và ý nghĩa exit code |
| ♻️ | **Replay cache** | Danh sách bản ghi theo test (tuổi, action, dung lượng), cảnh báo bản ghi cũ, xoá theo test / bản ghi mồ côi / toàn bộ (tương đương `e2e cache ls\|stats\|clear`) |
| 🎛️ | **Flag `e2e run` đầy đủ** | Hộp thoại Run → Nâng cao: tag, grep, shard, max-failures, strict-cache, trace, video, `--last-failed`, `-u`, `--ai-trace` |
| 🖼️ | **Duyệt snapshot** | Nút *Chấp nhận ảnh mới (-u)* cạnh khác biệt ảnh: chạy lại đúng test với `--update-snapshots` |
| 📄 | **Nhập `junit.xml`** | `import` nhận cả `junit.xml` (file, thư mục output hoặc artifact CI) khi không có `report.json` |
| 🔐 | **Cảnh báo redaction** | Video / file tải về `redaction: incomplete` được đếm và cảnh báo trước khi share |
| 🛑 | **Live: dừng sớm** | Banner khi chạm `--max-failures`, thông báo `notice` của runner; môi trường tách thêm theo agent và engine |
| 📝 | **Ghi chú QC & known bug** | Ghi chú theo từng test và mã ticket; test có known bug không bị tính là fail mới ở cổng chất lượng, có bộ lọc *Chỉ / Ẩn known bug* ở trang Run |
| 🧾 | **Copy bug report** | Bug report Markdown của một result (bước tái hiện, lỗi, build, môi trường, ghi chú) để dán vào Linear, Jira hay chat |
| 🧩 | **Mẫu prompt QC** | Prompt có chỗ trống `{{title}}`, `{{evidence}}`…: chép đi dán vào Claude, hoặc để AI viết bug report, báo cáo, mô tả Linear (có nút ngay trong hộp thoại Linear) |
| 🔗 | **Gắn / gỡ issue Linear có sẵn** | Nhập `ENG-123` hoặc link: xác minh với Linear, lưu liên kết, tự đánh dấu known bug, lần gửi sau không tạo trùng. *Gỡ issue* chỉ xoá liên kết, issue trên Linear giữ nguyên |
| 🤖 | **Tự log bug (mặc định tắt)** | Công tắc ở Cài đặt → AI: run có test fail do app thì AI soạn và tạo issue Linear (chống trùng); known bug fail lại với lỗi khác thì comment lỗi mới vào issue đó, mỗi dạng lỗi một lần. Có nút bấm tay tương ứng ở Run detail |
| 🪄 | **AI cho bug** | Ở test fail: *Bước tái hiện* (viết cho người không biết code) và *Mức độ nghiêm trọng* (Critical / High / Medium / Low kèm lý do, để QC duyệt); ở Run detail: *Gom bug trùng* nhóm các test fail cùng nguyên nhân để chỉ tạo một issue cho mỗi nhóm. Dữ liệu từ app đi qua khối không tin cậy, AI chỉ đọc code, không sửa |
| 📋 | **Test thủ công** | Ca QC chạy tay có trạng thái, người test, lịch sử; thống kê gộp với test tự động |
| 🧮 | **Ma trận build** | Test × build (branch@commit): thấy build nào làm test đổi kết quả; xuất danh sách bug ra CSV |
| ✅ | **QC xác nhận** | Known bug mà run mới nhất đã pass nằm trong hàng đợi *Chờ xác nhận* (*Đã sửa* gỡ known bug, *Chưa đúng* giữ lại); **waiver có hạn** (bắt buộc lý do, tối đa 365 ngày) bỏ qua một test fail khỏi cổng chất lượng đến hết hạn; **nhật ký thay đổi** ghi mọi lần đổi ghi chú, known bug, waiver |
| ⭐ | **Bộ lọc đã lưu** | Nút ngôi sao cạnh tiêu đề mỗi trang: lưu trang kèm bộ lọc đang chọn với một cái tên, mở lại bằng một cú bấm (lưu trong trình duyệt) |
| ⭐ | **Chất lượng test** | Điểm 0–100 từng test (thiếu assert, flaky, tốn model, chạy lâu, trùng, quá dài) kèm lý do |
| 👯 | **Test trùng, tách / gộp** | Phát hiện test cùng tên hoặc cùng các bước, test dài nên tách; mỗi việc có prompt cho Claude Code (dashboard không tự sửa mã test) |
| 💌 | **Gửi phản hồi** | Form góp ý, báo lỗi về chính dashboard: tạo issue trên GitHub của dự án qua `gh`, chỉ sau khi tick xác nhận công khai |
| 🧹 | **Dọn rác** | Cài đặt hệ thống → Dọn dẹp: quét 6 nhóm rác (file ghi dở `.tmp-*`, run lưu thiếu file, log lớn, báo cáo xuất cũ, replay cache cũ / mồ côi, thư mục tạm nhập từ GitHub), cho biết số mục và dung lượng từng nhóm, chỉ xoá nhóm bạn chọn sau popup xác nhận |
| ⚠️ | **Reset All** | Cài đặt hệ thống → Reset: xoá cài đặt, dữ liệu, hoặc cả cấu hình chung của máy. Có popup cảnh báo và phải gõ `RESET`; không có bản sao lưu |
| 🛡️ | **Xác nhận mọi thao tác nguy hiểm** | Một hộp thoại dùng chung cho mọi thao tác xoá, gỡ, dừng run, ghi đè snapshot, bật tự động; mặc định focus vào *Huỷ*, Esc để thoát |
| 🖥️ | **Chạy có / không giao diện** | Công tắc *headed* ở Tự động & lưu trữ → Chạy & lịch (mặc định tắt) và trong hộp thoại Run; áp cho chạy tay, chạy lại, chạy theo lịch và chạy qua MCP |
| 🌳 | **Tests dạng cây thư mục** | Thư mục gập / mở kèm số test và số fail, mỗi file một dòng tóm tắt (pass rate, thời gian TB, trạng thái mới nhất), chọn cả thư mục, nút *Tải lại*; tên test dài tự xuống dòng |
| 🔍 | **Lọc test theo tên** | Trang *Tests*: ô lọc theo tên test (và tên file); thanh nút và bộ lọc dính trên cùng khi cuộn cây thư mục |
| 🔎 | **Chọn test có ô lọc** | Ô chọn test ở QC xác nhận và Mẫu QC: lọc theo tên, file, tag (gõ không dấu vẫn khớp), hiện theo cây, dùng được bằng bàn phím |
| 🧯 | **Live: danh sách test fail riêng** | Ngay dưới Gantt, cập nhật trong lúc chạy; run xong có đủ nút như Runs: Phân tích lỗi, Bước tái hiện, Gửi Linear, Tìm commit gây lỗi, Sửa bằng Claude Code, Chạy lại đúng test |
| 📟 | **Tài nguyên máy & app** | Live hiện CPU, RAM, disk trống của máy (cả khi chưa chạy) và RAM / CPU / số tiến trình của run đang chạy (gồm trình duyệt); Cài đặt hệ thống có bảng cấu hình máy |
| 🎯 | **Chất lượng test: AI đánh giá lại** | Nút *Tính lại* và *AI đánh giá lại* chọn được model và effort cho riêng lần đó |
| 🗺️ | **Coverage chia tab** | Tab *Route* và *Domain trong source*, nhớ tab trên URL |
| 📁 | **Bối cảnh dự án cho AI** | Cài đặt hệ thống → Dự án: nhiều thư mục nguồn kèm mô tả (vd. backend, frontend) và một Prompt về hệ thống, rule, workflow. Mọi lần gọi AI đều gửi kèm (`--append-system-prompt`), AI được đọc các thư mục đó (`--add-dir`, chỉ đọc) |
| 📘 | **Hướng dẫn trong app** | Cài đặt hệ thống → Hướng dẫn: từng bước cài đặt, Claude Code, e2e, mở dashboard, viết và chạy test, đọc kết quả, AI, cấu hình, xử lý sự cố |
| 🔘 | **Nút chỉ hiện icon** | Mặc định nút chỉ còn icon, rê chuột hiện tên; trình đọc màn hình vẫn đọc tên nút. Tắt ở Cài đặt hệ thống → Giao diện |
| 🏷️ | **Gửi Linear: loại Task / Bug** | Hộp thoại Gửi Linear có *Loại* và *Mã issue liên quan* (bắt buộc với Bug); gắn label Bug / Task của team nếu có |
| 🗂️ | **Cài đặt chia tab dọc** | Cài đặt hệ thống và Tự động & lưu trữ chia nhóm ở menu dọc, hiện số liệu tổng quan, nút và công tắc lớn rõ ràng |

> [!TIP]
> **Không cài thêm gì.** Plugin chỉ cần Node (e2e vốn đã cần), không có dependency npm, không bước build, không tải CDN, nên chạy được cả khi không có mạng. Giao diện (~420 KB) được nén gzip khi truyền (~130 KB), nén một lần cho mỗi phiên bản.

---

## 📸 Ảnh chụp

Tất cả ảnh chụp ở giao diện tối (đổi sáng / tối ở Cài đặt hệ thống).

<table>
  <tr>
    <td width="50%"><b>📊 Overview — health score, KPI, pass rate theo run</b><br><img src="docs/images/dark-overview.jpeg" alt="Trang Overview chế độ tối: health score, 5 thẻ KPI có màu trạng thái, biểu đồ pass rate và kết quả theo run"></td>
    <td width="50%"><b>📡 Live — Gantt theo làn, ETA, lọc test fail</b><br><img src="docs/images/dark-live.jpeg" alt="Trang Live đang chạy: thanh tiến độ, ETA, Gantt theo làn"></td>
  </tr>
  <tr>
    <td width="50%"><b>🔍 Run detail — nhóm lỗi, timeline agent, log</b><br><img src="docs/images/dark-run-detail.jpeg" alt="Chi tiết một run: pass rate, nhóm lỗi, danh sách test và chi tiết lỗi"></td>
    <td width="50%"><b>🗂️ Runs — lịch sử các run</b><br><img src="docs/images/dark-runs.jpeg" alt="Danh sách run"></td>
  </tr>
  <tr>
    <td width="50%"><b>🧪 Tests — chọn test, chạy, AI viết test từ ticket</b><br><img src="docs/images/dark-tests.jpeg" alt="Danh sách test với lịch sử và các nút AI"></td>
    <td width="50%"><b>▶️ Hộp thoại chạy — target, retries, trình duyệt, workers</b><br><img src="docs/images/dark-run-dialog.jpeg" alt="Hộp thoại chạy test với chọn trình duyệt và toggle --no-cache"></td>
  </tr>
  <tr>
    <td width="50%"><b>⚖️ So sánh 2 run + visual diff</b><br><img src="docs/images/dark-compare-visual.jpeg" alt="So sánh hai run"></td>
    <td width="50%"><b>🔀 Flaky — điểm, số lần đổi kết quả</b><br><img src="docs/images/dark-flaky.jpeg" alt="Bảng test flaky"></td>
  </tr>
  <tr>
    <td width="50%"><b>🧩 Nhóm lỗi</b><br><img src="docs/images/dark-groups.jpeg" alt="Nhóm lỗi cùng mã"></td>
    <td width="50%"><b>📈 Xu hướng dài hạn</b><br><img src="docs/images/dark-trends.jpeg" alt="Xu hướng theo ngày"></td>
  </tr>
  <tr>
    <td width="50%"><b>🎫 Triage lỗi</b><br><img src="docs/images/dark-triage.jpeg" alt="Trạng thái và người phụ trách của từng lỗi"></td>
    <td width="50%"><b>🪙 Chi phí & cache</b><br><img src="docs/images/dark-cost.jpeg" alt="Token, chi phí, replay cache"></td>
  </tr>
  <tr>
    <td width="50%"><b>🗺️ Bản đồ route</b><br><img src="docs/images/dark-routes.jpeg" alt="Các trang test đi qua"></td>
    <td width="50%"><b>🌿 So sánh branch</b><br><img src="docs/images/dark-branches.jpeg" alt="Test hỏng ở một branch"></td>
  </tr>
  <tr>
    <td width="50%"><b>🧠 Model & ngân sách</b><br><img src="docs/images/dark-models.jpeg" alt="So sánh model"></td>
    <td width="50%"><b>🎯 Gợi ý locator từ replay cache</b><br><img src="docs/images/dark-locators.jpeg" alt="Step agent.act thành locator"></td>
  </tr>
  <tr>
    <td width="50%"><b>✅ Lint câu lệnh agent</b><br><img src="docs/images/dark-lint.jpeg" alt="Cảnh báo câu lệnh agent"></td>
    <td width="50%"><b>🕳️ Khoảng trống coverage</b><br><img src="docs/images/dark-coverage.jpeg" alt="Trang chưa test nào đi qua"></td>
  </tr>
  <tr>
    <td width="50%"><b>🌐 Lỗi theo môi trường</b><br><img src="docs/images/dark-environment.jpeg" alt="Tỉ lệ fail theo target, OS, trình duyệt"></td>
    <td width="50%"><b>🐞 Lỗi phía app</b><br><img src="docs/images/dark-app-errors.jpeg" alt="Console và request lỗi"></td>
  </tr>
  <tr>
    <td width="50%"><b>🚀 Báo cáo phát hành</b><br><img src="docs/images/dark-release.jpeg" alt="So run ở tag git"></td>
    <td width="50%"><b>🔗 Truy vết yêu cầu</b><br><img src="docs/images/dark-traceability.jpeg" alt="Story và test"></td>
  </tr>
  <tr>
    <td width="50%"><b>🌱 Vòng đời test</b><br><img src="docs/images/dark-lifecycle.jpeg" alt="Test mới, bị bỏ, đổi tên"></td>
    <td width="50%"><b>📄 Trang riêng từng test</b><br><img src="docs/images/dark-test-page.jpeg" alt="Lịch sử một test"></td>
  </tr>
  <tr>
    <td width="50%"><b>📁 Nhiều project</b><br><img src="docs/images/dark-projects.jpeg" alt="Các project đã mở dashboard"></td>
    <td width="50%"><b>📰 Digest tuần</b><br><img src="docs/images/dark-digest.jpeg" alt="Tóm tắt Markdown"></td>
  </tr>
  <tr>
    <td width="50%"><b>🖨️ Báo cáo & CSV</b><br><img src="docs/images/dark-report.jpeg" alt="Trang in và xuất CSV"></td>
    <td width="50%"><b>⏱️ Tự động & lưu trữ — worker, watch, lịch chạy, dọn run</b><br><img src="docs/images/dark-settings.jpeg" alt="Worker, watch, lịch chạy, dung lượng"></td>
  </tr>
  <tr>
    <td width="50%"><b>⚙️ Cài đặt hệ thống — theme, setup, doctor</b><br><img src="docs/images/dark-system.jpeg" alt="Cài đặt hệ thống"></td>
    <td width="50%"><b>🛠️ Tự sửa lỗi — chờ bạn duyệt diff trước khi chạy test và tạo PR</b><br><img src="docs/images/dark-system-selfheal.jpeg" alt="Bản sửa của AI đang chờ duyệt với diff và hai nút"></td>
  </tr>
  <tr>
    <td width="50%"><b>🔑 Key & tích hợp — Linear, webhook (toggle sự kiện)</b><br><img src="docs/images/dark-system-keys.jpeg" alt="Linear key, team và webhook"></td>
    <td width="50%"><b>✨ Hỏi AI về bộ test</b><br><img src="docs/images/dark-ask-ai.jpeg" alt="Panel Hỏi AI"></td>
  </tr>
  <tr>
    <td width="50%"><b>◧ Menu trái thu gọn thành thanh icon</b><br><img src="docs/images/dark-nav-collapsed.jpeg" alt="Menu thu gọn"></td>
    <td width="50%"></td>
  </tr>
</table>

---

## 🚀 Cài đặt

> [!IMPORTANT]
> Cần một project đã dùng **e2e** (có `e2e.config.ts`). e2e bản mới yêu cầu **Node ≥ 22.22.3** (hoặc ≥ 24.8). Dashboard cần **Node ≥ 22**; chỉ mục SQLite tuỳ chọn cần Node ≥ 22.13.

### ⚡ Cài bằng một lệnh (máy mới)

Đứng ở thư mục project e2e (có `e2e.config.ts`) rồi chạy:

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/thangvofastboy/e2e-dashboard/main/install.sh | bash
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/thangvofastboy/e2e-dashboard/main/install.ps1 | iex
```

**Chạy không tham số**: script hỏi trước vài câu (Enter = giá trị gợi ý): thư mục project, tạo `e2e.config.ts` nếu chưa có, URL app, lệnh khởi động app, **model AI** cho bước agent của e2e (kèm API key nhập ẩn, hoặc đăng nhập gói subscription), có mở dashboard không. Tóm tắt lựa chọn, hỏi *Bắt đầu cài?*, rồi cài một mạch không hỏi thêm. Có tham số thì dùng tham số và chỉ hỏi phần còn thiếu; `--yes` thì không hỏi gì.

Script in trước danh sách 9 bước, rồi chạy lần lượt với tiêu đề `[n/9]` và dòng *→ Đang …* cho biết đang cài gì, lệnh nào. Phần nào đã có thì bỏ qua (chạy lại bao nhiêu lần cũng được). Cuối cùng là bảng **Tổng kết**: mỗi bước *đã có / đã cài / bỏ qua / làm tay / lỗi* kèm thời gian.

| Bước | Việc | Cách làm |
|:-:|---|---|
| 1 | Phát hiện hệ điều hành | macOS (phiên bản, Apple Silicon / Intel, Homebrew), distro Linux qua `/etc/os-release` (Debian/Ubuntu, Fedora/RHEL, Arch, openSUSE, Alpine), WSL, musl; Windows 10 / 11. Quyết định trình quản lý gói và cách cài Node |
| 2 | git | `apt-get` / `dnf` / `yum` / `pacman` / `zypper` / `apk` theo distro, `brew` (macOS chưa có brew: Command Line Tools), `winget` (Windows) |
| 3 | Node ≥ 22.22.3 (hoặc ≥ 24.8) | [nvm](https://github.com/nvm-sh/nvm), không cần sudo, không đụng Node hệ thống; Alpine (musl): `apk`; Windows: winget `OpenJS.NodeJS.LTS` |
| 4 | Claude Code CLI | `npm install -g @anthropic-ai/claude-code` |
| 5 | Plugin e2e-dashboard (+ tự cập nhật) | `claude plugin marketplace add` + `claude plugin install` (đã cài thì cập nhật); bật auto-update của marketplace (bỏ bằng `--no-auto-update`) |
| 6 | Cấu hình `e2e.config.ts` | Chưa có: tạo bằng `e2e init` (web, skill + MCP cho Claude Code). Có rồi: hỏi URL app và lệnh khởi động app (Enter giữ nguyên) |
| 7 | AI cho e2e | Chọn model cho bước agent (sửa `agents` + import trong config), cài gói npm của provider (`ai`, `zod`, `@ai-sdk/anthropic`, `@openrouter/ai-sdk-provider`…), lưu API key vào `.env` (quyền 600, git-ignore; config được thêm dòng `process.loadEnvFile` vì e2e không tự đọc `.env`) hoặc chạy `npx e2e login …` cho gói subscription |
| 8 | Quick Setup | e2e + `@e2e-dev/web`, `node_modules`, gói AI còn thiếu, Chromium + headless shell (`--with-deps` chỉ trên Debian/Ubuntu), reporter, `.env`, `.gitignore`; mỗi mục in `[bước i/n]` |
| 9 | Mở dashboard | Như gõ `/e2e-dashboard` |

Model AI chọn được:

| Id | Model | Cần |
|---|---|---|
| `vercel` | Vercel AI Gateway | `AI_GATEWAY_API_KEY` |
| `anthropic` | Claude (kể cả credit API của gói Max/Team) | `ANTHROPIC_API_KEY` |
| `openrouter` | OpenRouter | `OPENROUTER_API_KEY` |
| `openai` | OpenAI | `OPENAI_API_KEY` |
| `chatgpt`, `copilot`, `opencode-console`, `grok` | Gói ChatGPT, GitHub Copilot, OpenCode Console, SuperGrok | Đăng nhập một lần: `npx e2e login …` |
| `claude-code` 🧪 | **Thử nghiệm:** Claude dùng đăng nhập Pro/Max của Claude Code CLI, không cần API key | `claude` đã đăng nhập; model `haiku` / `sonnet` / `opus` |
| `openai-compatible` | Model local (Ollama, LM Studio…) | URL server + model id |
| `none` | Không dùng AI, chỉ test bằng locator (mặc định: không cần API key) | |

> [!WARNING]
> **`claude-code` là thử nghiệm.** e2e không hỗ trợ chính thức (e2e khuyên gói Claude Max/Team dùng API key từ credit API hằng tháng, tức `anthropic`). Điều khoản của Anthropic không cho sản phẩm bên thứ ba dùng đăng nhập claude.ai nếu chưa được duyệt: chỉ nên tự dùng trên máy mình, không bật cho cả team. Test ăn chung hạn mức với Claude Code của bạn và chậm hơn API key. Cách chạy: gói cộng đồng [`ai-sdk-provider-claude-code`](https://www.npmjs.com/package/ai-sdk-provider-claude-code) bỏ qua tool của AI SDK, nên dashboard copy vào project file `e2e-dashboard.claude-code.mjs` (commit cùng reporter): file này mô tả tool trong prompt, buộc Claude trả JSON theo schema rồi đổi thành tool call cho agent của e2e. Phiên Claude Code của các lượt này nằm ở thư mục tạm riêng, không lẫn vào `/resume` của project.

Tham số (bash / PowerShell):

| bash | PowerShell | Ý nghĩa |
|---|---|---|
| `--project DIR` | `-Project DIR` | Thư mục project (mặc định: thư mục hiện tại) |
| `--init` | `-Init` | Chưa có `e2e.config.ts` thì tạo, không hỏi |
| `--ai ID` | `-Ai ID` | Model AI cho bước agent (bảng trên); `--gateway` / `-Gateway` là tên cũ |
| `--api-key KEY` | `-ApiKey KEY` | API key của model, lưu vào `.env` (hoặc đặt biến `E2E_AI_API_KEY`) |
| `--ai-login` | `-AiLogin` | Gói subscription: đăng nhập ngay trong lúc cài |
| `--ai-base-url URL`, `--ai-model ID` | `-AiBaseUrl`, `-AiModel` | `openai-compatible`: URL server và model id |
| `--app-url URL` | `-AppUrl URL` | URL app đang test |
| `--app-command "npm run dev"` | `-AppCommand "npm run dev"` | Lệnh khởi động app để runner tự chạy (`""` để bỏ) |
| `-y`, `--yes` | `-Yes` | Không hỏi gì |
| `--no-open` | `-NoOpen` | Cài xong không mở dashboard |
| `--no-auto-update` | `-NoAutoUpdate` | Không bật tự cập nhật plugin (mặc định script bật) |
| `--skip-project` | `-SkipProject` | Chỉ cài máy + plugin |
| `--dry-run` | `-DryRun` | Phát hiện hệ điều hành và in các bước, không cài gì |

Truyền qua pipe: `curl … | bash -s -- --init --app-url http://localhost:5173 --app-command "npm run dev"`. Windows: tải file về rồi chạy `.\install.ps1 -DryRun`. Trên Windows, e2e khuyên chạy trong WSL: mở WSL và dùng `install.sh`. Xong thì gõ `claude` một lần để đăng nhập nếu chưa, và `/reload-plugins` trong phiên Claude Code đang mở.

### Hoặc cài từng bước

**1️⃣ Thêm marketplace và cài plugin** (trong Claude Code):

```text
/plugin marketplace add thangvofastboy/e2e-dashboard
/plugin install e2e-dashboard@e2e-dashboard
/reload-plugins
```

**2️⃣ Mở dashboard** ở thư mục project e2e. Thư mục chưa có `e2e.config.*` (tìm từ thư mục hiện tại trở lên) thì `/e2e-dashboard` tự chạy `npx e2e init` trước (web, skill + MCP cho Claude Code, chưa cài thư viện) rồi mới mở; không tự chạy ở thư mục home hay `/`, bỏ qua bằng `/e2e-dashboard start --no-init`. Project còn thiếu gì (thư viện, gói AI, reporter, `.env`, API key…) thì dashboard hiện popup **Thiết lập project**: liệt kê các bước theo thứ tự, bấm **Cài tất cả** là cài ngay trong popup (từng bước có trạng thái Chờ / Đang cài / Xong / Lỗi, kèm log), API key nhập luôn trong popup. Mở một project khác từ trang *Projects* cũng được hỏi như vậy. *Để sau* thì không hỏi lại trong phiên trình duyệt đó; *Không hỏi lại cho project này* thì nhớ hẳn (vẫn cài được ở *trang 1 Click Setup*).

```text
/e2e-dashboard
```

**3️⃣ (Tuỳ chọn) Bật chế độ xem live:**

```text
/e2e-dashboard setup
```

Lệnh này copy `e2e-dashboard.reporter.mjs` (kèm `.d.mts`) vào project và thêm reporter vào `e2e.config.ts`. Output terminal của e2e vẫn giữ nguyên. Hãy commit 2 file reporter đó: trên CI (`CI=true`) reporter tự tắt, còn máy chưa cài plugin vẫn chạy test bình thường.

> [!NOTE]
> Không cài reporter vẫn có lịch sử: run do Claude chạy được lưu qua hook, run bạn tự chạy được lưu khi dashboard đang mở.

### 🖱️ 1 Click Setup

1 Click Setup kiểm tra máy và project rồi cài mọi thứ còn thiếu để chạy e2e từ dashboard. Phần nào đã có thì bỏ qua, chạy lại bao nhiêu lần cũng được.

**Trên dashboard:**

1. Mở dashboard bằng `/e2e-dashboard`. Project còn thiếu gì thì popup **Thiết lập project** tự hiện.
2. Bấm **Cài tất cả**: các bước chạy lần lượt, mỗi bước có trạng thái (Chờ → Đang cài → Xong, hoặc Lỗi / Bỏ qua) và log.
3. Muốn xem lại hoặc cài tiếp sau này: menu **Tích hợp › 1 Click Setup**. Trang này còn cho nhập API key, chọn model AI cho bước agent, sửa URL app và lệnh khởi động app trong `e2e.config.ts`.
4. Mỗi lệnh đều có nút copy để chạy tay trong terminal khi cần.

**Trong terminal** (dùng khi có bước cần mật khẩu `sudo`, vì trình duyệt không hỏi được mật khẩu):

```text
/e2e-dashboard 1-setup          # xem danh sách bước rồi hỏi trước khi cài
/e2e-dashboard 1-setup --yes    # cài luôn, không hỏi
```

`1-setup` là viết tắt của `setup --quick`. Các bước được kiểm tra:

| Bước | Có rồi thì | Chưa có thì |
|---|---|---|
| Git, GitHub CLI (gh tuỳ chọn, cho đồng bộ CI) | bỏ qua | cài bằng trình quản lý gói của máy (apt-get, dnf, pacman, brew, winget…) |
| Node ≥ 22.22.3 (hoặc ≥ 24.8) | bỏ qua | **làm tay**: in lệnh gợi ý theo hệ điều hành (nvm, brew, apk); không tự cài vì đổi Node dưới chân server đang chạy |
| e2e + `@e2e-dev/web`, `node_modules` | bỏ qua | `npm install -D e2e @e2e-dev/web` |
| Gói AI cho model đang chọn | bỏ qua | `npm install -D ai zod …` theo provider |
| API key của model | bỏ qua | **làm tay**: điền vào `.env` hoặc `/e2e-dashboard ai --api-key …`. Không cần nếu dùng `claude-code` (đăng nhập Claude Code CLI) |
| Chromium + headless shell | bỏ qua | cài bằng bin của `@e2e-dev/web` trong project (Debian/Ubuntu thêm `--with-deps`) |
| Claude Code CLI (cho tính năng AI của dashboard) | bỏ qua | `npm install -g @anthropic-ai/claude-code` |
| Tự cập nhật plugin | bỏ qua | bật auto-update của marketplace trong `settings.json` |
| Reporter, `.env`, `.gitignore` | bỏ qua | như `/e2e-dashboard setup` |

### 📋 Lệnh cài đặt nhanh

| Việc | Lệnh |
|---|---|
| Cài tất cả trên máy mới (macOS / Linux) | `curl -fsSL https://raw.githubusercontent.com/thangvofastboy/e2e-dashboard/main/install.sh \| bash` |
| Cài tất cả trên máy mới (Windows) | `irm https://raw.githubusercontent.com/thangvofastboy/e2e-dashboard/main/install.ps1 \| iex` |
| Chỉ xem sẽ cài gì, không cài | `curl -fsSL …/install.sh \| bash -s -- --dry-run` |
| Thêm marketplace (trong Claude Code) | `/plugin marketplace add thangvofastboy/e2e-dashboard` |
| Cài plugin | `/plugin install e2e-dashboard@e2e-dashboard` rồi `/reload-plugins` |
| Mở dashboard (tự `e2e init` nếu chưa có config) | `/e2e-dashboard` |
| Cài phần còn thiếu của project | `/e2e-dashboard 1-setup --yes` |
| Chọn model AI cho bước agent | `/e2e-dashboard ai --provider anthropic --api-key …` hoặc `/e2e-dashboard ai --provider claude-code` |
| Sửa URL app / lệnh khởi động trong config | `/e2e-dashboard setting --app-url http://localhost:5173 --app-command "npm run dev"` |
| Gắn reporter để xem live | `/e2e-dashboard setup` |
| Cập nhật plugin | `/e2e-dashboard update` |
| Xem trạng thái / tắt server | `/e2e-dashboard status` · `/e2e-dashboard stop` |
| Xem máy và project còn thiếu gì (không cài) | `/e2e-dashboard 1-setup`, trả lời `N` khi được hỏi |
| Xem hệ điều hành và trình quản lý gói sẽ dùng | `/e2e-dashboard os` |

---

## 📖 Hướng dẫn sử dụng

<details open>
<summary>🧑‍💻 <b>Hằng ngày: chạy test và xem kết quả</b></summary>

1. Mở dashboard một lần: `/e2e-dashboard` (server chạy nền, lần sau gõ lại chỉ mở trình duyệt).
2. Chạy test như bình thường (`npx e2e run`), nhờ Claude chạy (*"chạy test checkout"*: Claude dùng tool MCP `e2e_run_start` khi dashboard đang mở), hoặc bấm **Chạy** trên dashboard. Trang **Live** hiện tiến độ từng test, Gantt theo làn, ETA, danh sách test fail riêng và tài nguyên máy.
3. Run xong tự vào **Runs** và **Overview**: thẻ KPI đổi màu theo ngưỡng, health score 0–100, heatmap test × run.
4. Muốn chạy lại: trang **Tests** → tick test hoặc cả thư mục (hoặc *Chọn tất cả fail*) → **Chạy**; hoặc trang **Live** → *Chạy toàn bộ suite* / *Chạy lại* ở từng test fail. Muốn thấy trình duyệt: bật *headed* trong hộp thoại Run.
5. Đang ở trang khác vẫn biết có run đang chạy: nhãn **● Đang chạy 3/9** nổi ở góc dưới, bấm vào là sang Live.
6. Đóng máy cũng không mất gì: lịch sử nằm trong `.e2e-dashboard/` của project. Tắt server bằng `/e2e-dashboard stop`.

</details>

<details>
<summary>🔍 <b>Một test fail: tìm nguyên nhân và sửa</b></summary>

1. **Runs** → bấm run fail → bấm test fail: xem timeline agent, video đồng bộ theo step, screenshot lúc fail, log app, trace.
2. **✨ Phân tích lỗi**: Claude phân loại lỗi app / test / flaky / môi trường, chỉ ra `file:line`, gợi ý sửa; hỏi tiếp trong panel.
3. Lỗi xuất hiện sau một commit? **Tìm commit gây lỗi** sinh sẵn lệnh `git bisect run` cho đúng test đó.
4. **Sửa bằng Claude Code** copy lệnh `/e2e-dashboard:e2e-dashboard fix <run> <test>`; dán vào Claude Code để Claude sửa rồi chạy lại đúng test đó.
5. Cần người khác xem: **Export** (một file HTML tự chứa), **Gửi Linear** (chống trùng), hoặc ghi người phụ trách ở **Triage lỗi**.

</details>

<details>
<summary>🔀 <b>Test lúc pass lúc fail (flaky)</b></summary>

1. Trang **Flaky** xếp test theo điểm; đổi kết quả trên **cùng commit** bị tính nặng hơn.
2. **Chạy ×5** để xác nhận; **Vì sao flaky?** để Claude đọc lịch sử pass/fail theo commit, timing, cache và code test.
3. Chưa sửa kịp: **Cách ly** (mặc định 14 ngày). Run từ dashboard bỏ qua test đó; `/e2e-dashboard quarantine` in lệnh `--grep-invert` cho CI; digest nhắc khi quá hạn.

</details>

<details>
<summary>🚦 <b>Trước khi push / merge</b></summary>

1. Trang **Tests** → *Test bị ảnh hưởng* (so với `main`) → chạy đúng những test liên quan tới thay đổi.
2. `/e2e-dashboard gate` trả mã thoát 1 khi có test mới fail, health hoặc SLO dưới ngưỡng, vượt ngân sách token. Dùng được trong CI.
3. Trang **So sánh 2 run** → *Đăng lên PR* để đưa kết quả (mới fail / đã sửa / vẫn fail) vào PR qua `gh`.

</details>

<details>
<summary>☁️ <b>CI và làm việc theo team</b></summary>

1. Reporter tự tắt khi `CI=true`. Để có lịch sử CI: upload `.e2e/report.json` làm artifact, rồi `import --gh <run id>` hoặc bật tự đồng bộ `"ci": { "github": { … } }` (cần `gh auth login`).
2. Dùng chung lịch sử: đặt `"share": { "dir": "…" }` trong `~/.e2e-dashboard/config.json`, rồi `share push` / `share pull`.
3. Đánh dấu deploy / release từ CI: `/e2e-dashboard mark deploy "v1.5"` (hiện trên biểu đồ xu hướng).
4. Xuất trang tĩnh cho cả team xem: `/e2e-dashboard publish` → thư mục HTML đưa lên GitHub Pages hoặc thư mục chung.

</details>

<details>
<summary>📬 <b>Báo cáo và cảnh báo</b></summary>

1. Digest tuần: `/e2e-dashboard digest` (Markdown để dán Slack/email). Báo cáo tuần / tháng: `/e2e-dashboard report week --send`.
2. Gửi tự động khi dashboard đang mở: `"reports": { "weekly": "mon 09:00" }` trong `.e2e-dashboard/config.json`.
3. Webhook Slack/Discord và email chỉ đặt ở `~/.e2e-dashboard/config.json` (không bao giờ trong repo). Xem [Cảnh báo](#-theo-dõi--báo-cáo-m7) để tuỳ chỉnh luật.
4. Hỏi nhanh ngay trong Claude Code, không cần mở dashboard: *"test nào flaky tuần này?"* (qua MCP server của plugin).

</details>

<details>
<summary>🩺 <b>Gặp sự cố</b></summary>

| Triệu chứng | Cách xử lý |
|---|---|
| `Unknown command: /e2e-dashboard` | `/reload-plugins` (hoặc mở lại Claude Code). Vẫn lỗi: dùng tên đầy đủ `/e2e-dashboard:e2e-dashboard` |
| `Không tìm thấy e2e.config…` | Chạy lệnh trong thư mục project e2e (hoặc thư mục con của nó) |
| Trang Live trống khi chạy test | Chưa gắn reporter: `/e2e-dashboard setup`. Không có reporter thì run vẫn được lưu khi xong |
| Trình duyệt báo `401` | Mở lại bằng `/e2e-dashboard` (URL có token mới; cookie theo từng port) |
| Không thấy run cũ | Retention mặc định giữ 50 run; tăng `"retention"`, ghim run cần giữ. Số liệu dài hạn ở trang **Xu hướng** không bị xoá |
| Server không lên | `/e2e-dashboard status`, xem `.e2e-dashboard/server.log`; port bận thì tự lấy port kế tiếp |
| Màu / hoạt cảnh gây rối mắt | Bật *giảm chuyển động* (Reduce motion) trong hệ điều hành: mọi hoạt cảnh tự tắt |
| Live báo *running* mãi, không chạy được run mới | Run ngoài terminal bị kill giữa chừng: bấm **Dừng run** ở trang Live để xoá trạng thái |
| `report --send` / `digest --send` trả mã 1 | Mọi webhook / email đều gửi lỗi: kiểm tra URL trong `~/.e2e-dashboard/config.json` |

</details>

---

## ⌨️ Lệnh

| Lệnh | | Việc |
|---|:-:|---|
| `/e2e-dashboard` | 🖥️ | Bật server nền nếu chưa chạy, mở trình duyệt, in URL |
| `/e2e-dashboard setup` | 🔌 | Gắn reporter vào `e2e.config.ts` để xem live; chọn trình duyệt mặc định (`E2E_BROWSER`) |
| `/e2e-dashboard config [--init] [--app-url URL] [--app-command "npm run dev"\|--no-command] [--yes]` | 🧩 | Cấu hình `e2e.config.ts`: chưa có thì tạo bằng `e2e init` (`--gateway`, `--engine`); sửa URL app và lệnh khởi động app (hỏi khi có terminal, Enter giữ nguyên); in engine, model, reporter. Trong dashboard: *trang 1 Click Setup* |
| `/e2e-dashboard ai [--provider ID] [--api-key KEY] [--base-url URL] [--model ID] [--login] [--no-install] [--yes]` | 🤖 | AI cho bước agent của e2e: chọn model (sửa `agents` + import trong config), cài gói npm của provider, lưu API key vào `.env`, đăng nhập gói subscription. Có terminal thì hỏi (key nhập ẩn). Trong dashboard: *trang 1 Click Setup (menu Tích hợp)* |
| `/e2e-dashboard autoupdate [on\|off]` | 🔄 | Tự cập nhật plugin: bật / tắt auto-update của marketplace `e2e-dashboard` trong `settings.json` của Claude Code (mặc định Claude Code tắt với marketplace bên thứ ba). Khi bật, Claude Code tải bản mới sau tin nhắn đầu tiên của mỗi phiên; áp dụng sau `/reload-plugins` hoặc lần mở sau. Script cài và trang 1 Click Setup bật sẵn |
| `/e2e-dashboard os` | 🖥️ | Hệ điều hành đang chạy (distro, phiên bản, CPU, WSL) và trình quản lý gói Quick Setup sẽ dùng |
| `/e2e-dashboard setup --quick [--yes]` | ⚡ | Quick Setup: kiểm tra Git, gh, Node, e2e ([tester-army/e2e](https://github.com/tester-army/e2e)) + `@e2e-dev/web`, `node_modules`, Chromium + headless shell, Claude CLI, reporter/.env; hiện lệnh rồi cài phần thiếu (sudo hỏi mật khẩu trong terminal). Trong dashboard: *trang 1 Click Setup* |
| `/e2e-dashboard 1-setup [--yes]` | ⚡ | Viết tắt của `setup --quick` (1 Click Setup trong terminal) |
| `/e2e-dashboard setting …` | 🧩 | Viết tắt của `config …` (cũng nhận `settings`) |
| `/e2e-dashboard doctor [--dry-run]` | 🩺 | Chuyển dữ liệu theo bố cục cũ sang bố cục mới (runs theo ngày, `state/`, `runtime/`), dựng lại chỉ mục SQLite nếu đã bật. `--dry-run` chỉ liệt kê, không ghi |
| `/e2e-dashboard export [runId]` | 📤 | Xuất một run (mặc định là run mới nhất) thành HTML tự chứa |
| `/e2e-dashboard demo <test>` | 🎬 | Chạy đúng một test e2e (`*.e2e.ts`, có thể kèm `:dòng`) với video bật, để quay lại thao tác làm tài liệu hướng dẫn. Video nằm ở tab "Video & ảnh" của run khi xong |
| `/e2e-dashboard status` | ℹ️ | Xem server có đang chạy không |
| `/e2e-dashboard digest [ngày]` | 📰 | In digest Markdown (mặc định 7 ngày), lưu vào `.e2e-dashboard/digests/` |
| `/e2e-dashboard projects` | 📁 | Liệt kê các project đã mở dashboard, health score, URL nếu đang chạy |
| `/e2e-dashboard statusline [install]` | 📟 | Hướng dẫn / cài status line cho Claude Code |
| `/e2e-dashboard quarantine` | 🔒 | Test đang cách ly và lệnh `npx e2e run --grep-invert …` cho CI |
| `/e2e-dashboard import <report.json\|thư mục>` | ☁️ | Nhập report (vd. tải từ CI) vào lịch sử; `import --gh <run id> [--name <artifact>]` tải qua `gh` |
| `/e2e-dashboard share push\|pull [dir]` | 🤝 | Đẩy run của bạn / kéo run của team qua thư mục chung |
| `/e2e-dashboard gate [--max-new-failures N] [--min-health N] [--max-tokens N] [--slo 0.95]` | 🚧 | Cổng chất lượng cho CI / trước khi push; mã thoát 1 khi FAIL |
| `/e2e-dashboard fix [runId] [resultId]` | 🛠️ | In ngữ cảnh test fail; dùng `/e2e-dashboard:e2e-dashboard fix …` để Claude sửa và chạy lại |
| `/e2e-dashboard report [week\|month] [--send]` | 📬 | Báo cáo tuần / tháng (Markdown + HTML); `--send` gửi webhook và email |
| `/e2e-dashboard publish [thư mục]` | 🌐 | Xuất trang báo cáo tĩnh (mặc định `.e2e-dashboard/site`) |
| `/e2e-dashboard mark <deploy\|release\|incident\|env\|note> <mô tả>` | 📍 | Đánh dấu sự kiện lên biểu đồ (dùng được trong CI) |
| `/e2e-dashboard triage` | 🎫 | Lỗi đang cần xử lý và trạng thái |
| `/e2e-dashboard ci-sync` | 🔄 | Kéo report mới từ GitHub Actions ngay |
| `/e2e-dashboard version` | 🏷️ | Version đang cài và có bản mới không (chạy local, không tốn token) |
| `/e2e-dashboard update` | 🔄 | Cập nhật lên tag mới nhất rồi tự `/reload-plugins` |
| `/e2e-dashboard stop` | ⏹️ | Tắt server |

> [!TIP]
> Tất cả lệnh trên chạy local, không tốn token. Nếu cần Claude tự sửa `e2e.config.ts` (config có dạng lạ), dùng tên đầy đủ `/e2e-dashboard:e2e-dashboard setup`: lệnh này nhờ Claude chèn reporter giúp.

---

## ✨ Phân tích bằng AI

Trên trang run: **✨ Phân tích run** (tóm tắt, gom nhóm lỗi, ưu tiên xử lý) hoặc, ở test fail, **✨ Phân tích lỗi**. Kết quả chạy dần trong panel bên phải; *Phân tích lại* bỏ qua cache; ô *Hỏi thêm* tiếp tục cùng phiên (`--resume`).

| | |
|:-:|---|
| 🧠 | Dùng Claude Code CLI bạn đang đăng nhập (`claude -p`), **không cần API key** |
| 🧾 | Prompt gồm lỗi, timeline step, log app, đường dẫn trace và **commit giữa lần pass gần nhất với run này** |
| 🗃️ | Kết quả cache theo run (`runs/<run>/ai/`), xoá theo retention, **nhúng vào file export** |
| 🛡️ | Sandbox: `--restricted`, chỉ có `Read/Grep/Glob`, không MCP, từ chối mọi quyền khác; text của app được rào bằng thẻ có nonce |
| ⏱️ | Tối đa 2 phân tích cùng lúc, timeout 5 phút, đóng panel là dừng |
| 🔀 | **Vì sao flaky?** ở trang Flaky: Claude đọc lịch sử pass/fail theo commit, cache, timing và code test, tách flaky thật khỏi regression |
| 🎯 | **Chuyển thành locator** trên step `agent.act`: Claude đọc test và bản ghi cache, đề xuất code locator thay cho bước agent |
| ☯️ | Nút AI dùng icon âm dương; khi AI hay cài đặt đang chạy, nút đã bấm hiện spinner và đầu trang có thanh tiến độ |

---

## 📊 Phân tích (M2)

Các trang ở nhóm **Phân tích** trên sidebar; mỗi trang chọn được số run gần nhất để phân tích (10–100).

| Trang | Cách tính |
|---|---|
| ❤️ **Health score** (Overview) | Pass rate TB 10 run ×40, độ ổn định (ít flaky) ×25, thời gian so với TB ×15, token so với TB ×10, replay cache ×10; phần chưa có dữ liệu không tính |
| 🔀 **Flaky** | Điểm = tỉ lệ run flaky + tỉ lệ lần đổi kết quả, cộng thêm khi đổi kết quả trên **cùng commit**. Hỏng một lần sau commit mới là regression, không phải flaky |
| ⚖️ **So sánh 2 run** | Chọn 2 run ở trang Runs, hoặc nút *So với baseline / run trước* ở Run detail. Nút 🖼️ trên mỗi dòng mở visual diff |
| 🖼️ **Visual diff** | Cạnh nhau, thanh trượt, hoặc *Khác biệt* (so từng pixel bằng canvas, tô đỏ chỗ khác, % pixel khác). Tự nhận bộ ảnh `-expected / -actual / -diff` của `toHaveScreenshot` |
| 🧩 **Nhóm lỗi** | Chữ ký = mã lỗi + thông báo đã bỏ số, chuỗi trong ngoặc, id, URL + locator. Run detail cũng có panel nhóm lỗi |
| 🪙 **Chi phí & cache** | `usage.estimatedCostUsd` của report, hoặc ước tính theo `"pricing"`; cảnh báo khi vượt `"budget"` |
| 🗺️ **Bản đồ route** | Từ sự kiện navigation, `step.screen.location` và URL lúc fail; id trong path gộp thành `:id` |
| 🌿 **Branch** | Chỉ số 10 run gần nhất mỗi branch, pass rate từng test trên A so với B |
| 🎯 **Gợi ý locator** | Step `agent.act` replay từ cache ở ≥ 3 run: đọc `.e2e/cache/<entry>.json` (trace-1) và dựng code `screen.getByRole(...).tap()`, `.fill()`, `.selectOption()`, `app.open()`… kèm một `expect` |

> [!TIP]
> Muốn visual diff giữa hai run kể cả khi test pass, bật `"screenshots": "all"`: run pass cũng giữ screenshot (không giữ video).

---

## 🔗 Tích hợp (M3)

**🎫 Linear.** Ở test fail bấm **Gửi Linear**. Nội dung issue gồm lỗi, step fail, URL, commit kể từ lần pass, phân tích AI đã lưu, và dòng `fingerprint: e2ed-…` (tên test + dạng lỗi).

- Có `LINEAR_API_KEY` (và `LINEAR_TEAM`, vd. `ENG`, khi tài khoản có nhiều team): server tìm issue chứa fingerprint trước. Đang mở → báo trùng, nút *Thêm comment run này*; đã đóng → tạo issue mới ghi "Tái phát của …"; chưa có → tạo mới.
- Không có key: **Copy cho Claude** tạo prompt để Claude Code dùng Linear MCP làm đúng các bước trên.
- Key chỉ đọc từ biến môi trường hoặc `~/.e2e-dashboard/config.json` → `"linear": { "apiKey", "team" }`, **không bao giờ** từ repo.

**🎟️ Issue Linear → testcase → e2e.** Ở *Cài đặt hệ thống → Tích hợp*, phần **Issue Linear**: nhập email người được giao (mỗi dòng một email, tối đa 20) và các status cần lấy (vd. `Todo`, `In Progress`). Lưu ở `.e2e-dashboard/settings.json` của project. Rồi mở menu **Theo dõi → Issue Linear**:

1. **Lấy lại danh sách**: lấy các issue được giao cho các email đó, có status trong danh sách. Issue đã có testcase hoặc thêm tay được giữ lại khi không còn khớp; lỗi Linear thì danh sách cũ giữ nguyên.
2. **Thêm** một issue bằng mã (`ENG-123`) hoặc link Linear.
3. **Phân tích**: AI đọc tiêu đề, mô tả và comment của issue rồi đề xuất testcase (tiêu đề, các bước, kết quả mong đợi). Đây chỉ là đề xuất: sửa, thêm, xoá rồi bấm **Lưu testcase**. **Mở testcase** mở lại bản đã lưu mà không gọi AI.
4. **Gen e2e**: AI đọc quy ước của project (`e2e.config.*`, vài file `.e2e.ts`) rồi viết một file `tests/linear/<ID>.e2e.ts`, mỗi testcase một `test()`. File đã có thì báo lỗi, không ghi đè.

Cần Linear API key hoặc MCP Linear đã đăng nhập (như *Gửi Linear*). Nội dung issue và comment được coi là dữ liệu, không phải chỉ dẫn cho AI.
**🎬 Record → testcase → test.** Trang *Record thao tác*: nhập URL và tên rồi bấm **Record**. Dashboard mở trình duyệt thật kèm cửa sổ Inspector của `playwright codegen`; thao tác như người dùng, bấm nút assert trong Inspector để thêm kiểm tra, rồi đóng cửa sổ (hoặc bấm **Dừng**).

1. **Testcase**: các thao tác thành bước đọc được; AI gom thành testcase và viết kết quả mong đợi (kiểm tra bạn thêm trong Inspector được coi là bằng chứng chắc chắn). AI lỗi hoặc chưa cấu hình thì vẫn có testcase, bạn điền tay.
2. **Sửa và lưu**: sửa tiêu đề, bước, kết quả mong đợi, đổi tên, rồi **Lưu**: ghi `tests/recorded/<tên>.spec.ts` và `<tên>.cases.json`. Trùng tên thì báo 409, không ghi đè; đổi tên rồi lưu lại.
3. **AI Gen e2e** (tuỳ chọn): AI chuyển testcase đã lưu sang `tests/recorded/<tên>.e2e.ts` theo runner `e2e`.

Giá trị nhạy cảm (ô mật khẩu, OTP, PIN, thẻ, token, query `?token=`…) bị thay bằng `process.env.E2E_SECRET_<n>` trước khi lưu và trước khi gửi cho AI; trang liệt kê các biến cần đặt trong `.env` hoặc môi trường trước khi chạy test. Chỉ ghi được khi dashboard chạy trên máy có màn hình (Linux cần `DISPLAY` hoặc `WAYLAND_DISPLAY`) và đã cài chromium (`npx @e2e-dev/web install chromium`).

**🔐 Trang cần đăng nhập (SSO, OTP, captcha).** Ở trang Record bấm **Đăng nhập trước** (đặt tên phiên, vd `admin`): trình duyệt mở tới URL, bạn đăng nhập (và chuẩn bị sẵn trạng thái cần có) rồi bấm **Xong, lưu phiên**. Cookie và localStorage được lưu ở `.e2e-dashboard/auth/<tên>.json` (thư mục 0700, file 0600, đã nằm trong `.gitignore`). Các lần Record sau chọn phiên đó ở ô *Phiên đăng nhập*: trình duyệt mở ra đã đăng nhập và spec lưu có `test.use({ storageState: '.e2e-dashboard/auth/<tên>.json' })`, nên chạy bằng dashboard là đăng nhập sẵn. Lưu ý: file phiên chứa cookie / token, không commit; phiên hết hạn thì đăng nhập lại cùng tên để ghi đè; test dùng phiên **chỉ chạy được trên máy có file đó** (CI không có sẽ fail). AI Gen e2e không dùng được file phiên của Playwright: AI được dặn bắt đầu từ trang đã đăng nhập và để `// TODO:` cho phần đăng nhập.

**🍪 Dựng phiên từ cookie hoặc link (không cần đăng nhập thủ công, không dùng AI).** Cũng ở trang Record: dán chuỗi `Cookie` từ DevTools (Network → chọn một request tới site đã đăng nhập → Request Headers → `Cookie`) và/hoặc một link đăng nhập một lần, đặt *Tên phiên mới* và URL, rồi bấm **Lưu phiên từ cookie / link**. Chỉ cookie thì ghi thẳng (không mở trình duyệt, máy không có màn hình vẫn làm được); có link thì dashboard mở nó bằng chromium ẩn (kèm cookie dán sẵn) rồi lưu phiên, tối đa 60 giây. Cookie áp dụng cho đúng tên miền của URL (không phủ subdomain). Cookie và link đi qua file tạm 0600, không qua dòng lệnh, không gửi cho AI, và bị che trong mọi thông báo lỗi.

**🤖 Nhờ AI chuẩn bị phiên.** Cần chuẩn bị nhiều hơn một cookie (đăng nhập bằng tài khoản, mở sẵn một mục…)? Viết prompt vào ô *Nhờ AI chuẩn bị phiên*, vd `Đăng nhập bằng {{E2E_ADMIN_USER}} / {{E2E_ADMIN_PASSWORD}}, rồi mở mục Cài đặt`. Dashboard dùng **agent của runner `e2e`** (cần đã bật AI ở Cài đặt → AI): agent làm theo prompt trong trình duyệt ẩn rồi phiên được lưu như các cách trên. Tài khoản, mật khẩu, token viết dạng `{{E2E_TÊN}}` (chỉ tên bắt đầu bằng `E2E_`) và đặt giá trị trong `.env` của project hoặc môi trường: AI chỉ thấy tên, runner mới là bên gõ giá trị, nên giá trị không nằm trong prompt, dòng lệnh hay báo cáo (tối thiểu 6 ký tự, ngưỡng của runner). AI không sinh mã để chạy: dashboard dựng một test tạm theo khuôn cố định và agent chỉ làm được những gì bộ công cụ của runner cho phép. Mỗi lần tốn token, tối đa 3 phút, có hộp xác nhận. Lần chạy này không vào lịch sử run của dashboard.


**📰 Digest tuần.** Trang *Digest tuần* hoặc `/e2e-dashboard digest`: số run, pass rate so với tuần trước, token, replay cache, health score, test mới fail, flaky, nhóm lỗi, step chậm nhất. Muốn tự động hằng tuần: tạo Routine trong Claude Code chạy `/e2e-dashboard digest`.

**📟 Status line.** `/e2e-dashboard statusline install` copy script vào `~/.e2e-dashboard/statusline.mjs` và đặt `statusLine` trong `~/.claude/settings.json` (không ghi đè status line có sẵn). Hiện `🧪 e2e ✓ 42/42 · 97% (10 run) · 5p trước`, hoặc `▶ e2e 3/9` khi đang chạy. Chỉ đọc file, không gọi mạng, im lặng ngoài project e2e.

**🔔 Thông báo desktop.** Khi dashboard đang chạy và một run kết thúc: `osascript` (macOS), `notify-send` (Linux), balloon PowerShell (Windows). Mặc định chỉ báo run fail/flaky; đổi bằng `"notify": "all" | "failures" | "off"`.

**🔒 Cách ly test flaky.** Ở trang Flaky bấm *Cách ly* (14 ngày, kèm lý do). Hộp thoại Run có ô *Bỏ qua test đang cách ly*; `/e2e-dashboard quarantine` in lệnh `--grep-invert` để dùng trong CI. Hết hạn mà chưa gỡ thì digest nhắc.

**🧬 Tìm commit gây lỗi.** Ở test fail bấm *Tìm commit gây lỗi*: dashboard tìm lần pass gần nhất và lần fail đầu tiên, rồi sinh `git bisect start <bad> <good>` + `git bisect run npx e2e run <file:line> --no-cache --retries 0`. Dashboard không tự checkout: bạn chạy lệnh trong terminal.

**☁️ CI và 🤝 team.** Reporter tự tắt trên CI; để xem lịch sử CI, tải artifact chứa `.e2e/report.json` (*Nhập từ GitHub Actions* ở trang Runs, hoặc `import --gh <run id>`). Team dùng chung một thư mục (`"share": { "dir": "…" }` trong `~/.e2e-dashboard/config.json`): `share push` đẩy run của bạn, `share pull` kéo run của người khác (kiểm tra id, schema, không theo symlink; hiện với nguồn `shared`).

**💬 Comment PR.** Ở trang So sánh 2 run bấm *Đăng lên PR*: xem trước Markdown, rồi đăng qua `gh pr comment` lên PR đang mở của branch run B (cần `gh auth login`).

**📄 Trang test.** Bấm tên test ở Tests, Flaky, Tìm kiếm hay trang Run để xem toàn bộ lịch sử của test đó.

**🎯 Test bị ảnh hưởng.** Ở trang Tests, nhập nhánh gốc (mặc định `main`) rồi bấm *Tìm*: dashboard đọc `git diff` (đã commit, chưa commit, file mới), ghép với file test, các route test đã đi qua và từ khoá trong tên test, rồi cho chạy đúng những test đó.

**👀 Watch, lịch chạy, webhook.** Trang *Tự động & lưu trữ*: bật watch (lưu `*.e2e.ts` là chạy lại file đó); lịch chạy `"schedule": { "daily": ["02:00"], "tests": [] }` trong config; webhook đặt ở `~/.e2e-dashboard/config.json` → `"webhooks": [{ "url": "https://hooks.slack.com/…", "events": ["run-failed", "digest"] }]` (hoặc `E2E_DASHBOARD_WEBHOOK`), digest tuần gửi bằng `/e2e-dashboard digest --send`. Mọi thứ chỉ chạy khi dashboard đang mở và bỏ qua test đang cách ly.

**📁 Nhiều project.** Mỗi lần mở dashboard, project được ghi vào `~/.e2e-dashboard/projects.json`. Trang *Projects* hiện mọi project, run gần nhất, health score, nút mở (nếu server đang chạy) hoặc lệnh để mở.

---

## 🚦 Trạng thái & ngưỡng

Mỗi thẻ KPI tự đổi màu theo ngưỡng. Bấm vào chip trạng thái để mở panel **"Cách tính trạng thái"**: ô ứng với giá trị hiện tại được viền màu và gắn nhãn *hiện tại*.

| Chỉ số | ![Tốt](https://img.shields.io/badge/Tốt-16a34a?style=flat-square) | ![Cần chú ý](https://img.shields.io/badge/Cần%20chú%20ý-d97706?style=flat-square) | ![Có vấn đề](https://img.shields.io/badge/Có%20vấn%20đề-dc2626?style=flat-square) |
|---|---|---|---|
| 🎯 Pass rate | ≥ 95% | 80–95% | < 80% |
| ✅ Run gần nhất | passed | flaky / blocked | failed / interrupted / error |
| ⏱️ Thời gian chạy | ≤ +10% so với TB 10 run | +10% → +30% | > +30% |
| 🪙 Token / run | ≤ +10% so với TB 10 run | +10% → +30% | > +30% |
| ♻️ Replay cache | ≥ 80% | 50–80% | < 50% |

Màu không bao giờ đứng một mình: mọi trạng thái đều có icon kèm chữ, để người mù màu và bản in vẫn đọc được.

---

## 🧰 Mở rộng (M6)

**🔌 MCP server.** Plugin tự khai báo server MCP `e2e-dashboard` (`.mcp.json`), nên trong Claude Code có thể hỏi *"test nào flaky tuần này?"*, *"vì sao run vừa rồi fail?"* mà không cần mở dashboard. Server chỉ đọc lịch sử trong `.e2e-dashboard/`, không chạy test.

**🛠️ Sửa bằng Claude Code.** Ở test fail bấm *Sửa bằng Claude Code* → lệnh được copy; dán vào Claude Code. Claude nhận lỗi, step fail, trace, phân tích AI đã lưu, commit kể từ lần pass, quyết định lỗi ở app hay ở test, sửa tối thiểu (không bao giờ xoá hay skip test) rồi chạy lại `npx e2e run <spec> --retries 0`.

**🕳️ Coverage.** Dashboard đọc route của app rồi so với các trang test đã đi qua. Thêm/bỏ route bằng `"coverage": { "routes": ["/help"], "ignore": ["/admin/*"] }`.

**🚧 Cổng chất lượng & 🎯 SLO.** Panel ở Overview và lệnh `gate`. Ngưỡng mặc định: 0 test mới fail; đổi bằng `"gate": { "maxNewFailures": 0, "minHealth": 70, "maxTokens": 200000, "requireSlo": true }` và `"slo": { "passRate": 0.95, "days": 7 }`. So với baseline nếu đã đặt, không thì với run trước.

**📣 Mention owner.** Trong `~/.e2e-dashboard/config.json` (không phải repo): `"mentions": { "@team-web": "<!subteam^S123>", "@ana": "<@U456>" }`. Webhook run fail sẽ tag owner của test fail.

**🎞️ Video.** Để có video của cả test pass (so sánh cạnh nhau), đặt `"videos": "all"`.

---

## 📈 Theo dõi & báo cáo (M7)

**📈 Số liệu dài hạn.** Retention chỉ giữ 50 run, nên mỗi run còn được gom vào `.e2e-dashboard/longterm/` (tổng theo ngày, mỗi test một dòng `[run, fail, flaky]`, các đợt fail → pass). File nhỏ và được giữ mãi; trang **Xu hướng** đọc từ đây: pass rate theo ngày, lịch 12 tháng, MTTR, thời gian đỏ, test fail lâu nhất.

**🎫 Triage.** Trang *Triage lỗi* liệt kê mọi test đang fail. Chọn trạng thái, người phụ trách, ghi chú; link Linear tự gắn nếu đã gửi issue. Trạng thái gắn với đúng lỗi (tên test + dạng lỗi), nên run ngày mai fail như cũ thì không ai phải xem lại.

**📬 Báo cáo tự gửi.** `"reports": { "weekly": "mon 09:00", "monthly": "1 09:00" }` trong `.e2e-dashboard/config.json`. Khi dashboard đang mở, đến giờ sẽ tạo báo cáo (lưu `.e2e-dashboard/reports/*.html`), gửi webhook có sự kiện `report` và email nếu `~/.e2e-dashboard/config.json` có `"email": { "to": ["qa@công-ty.com"] }` (gửi qua `sendmail` trên máy).

**🚨 Cảnh báo.** Mặc định: test fail 3 run liên tiếp, branch chính đỏ quá 24 giờ. Tuỳ chỉnh:

```jsonc
"alerts": [
  { "type": "consecutive-failures", "count": 3 },
  { "type": "pass-rate-below", "value": 0.9, "runs": 10, "scope": "module:checkout" }, // hoặc "tag:@smoke", "owner:@team-qa"
  { "type": "flaky-increase", "factor": 2, "days": 7 },
  { "type": "red-for", "hours": 4, "branch": "main" }
]
```

**🔄 Tự đồng bộ CI.** `"ci": { "github": { "workflow": "e2e.yml", "artifact": "e2e-report", "branch": "main", "intervalMinutes": 30 } }` (cần `gh auth login`).

**🧱 Module, 🔗 truy vết, 📍 sự kiện.** `"modules": { "Checkout": ["tests/checkout/**"] }` (mặc định theo thư mục); `"traceability": { "stories": ["LIN-1", { "id": "LIN-2", "title": "…" }] }` + tag `@LIN-1` trên test; sự kiện thêm ở trang Xu hướng hoặc `/e2e-dashboard mark deploy "v1.5"`. Branch chính: `"mainBranch": "main"` (mặc định main/master).

**🌐 Trang tĩnh.** `/e2e-dashboard publish [thư mục]` xuất `index.html` (90 ngày + lịch 12 tháng) và 10 run gần nhất. Thư mục mặc định `.e2e-dashboard/site`, hoặc `"publish": { "dir": … }` trong `~/.e2e-dashboard/config.json`.

---

## ⚙️ Cấu hình

Mọi thứ đều tuỳ chọn. Tạo `.e2e-dashboard/config.json` trong project e2e:

```jsonc
{
  "output": ".e2e",        // thư mục output của e2e (nếu bạn đổi --output)
  "retention": 50,         // số run giữ lại (run đã ghim không tính)
  "port": 4477,            // port ưu tiên; bận thì tự lấy port kế tiếp
  "ai": { "model": "sonnet", "language": "vi" },  // model và ngôn ngữ trả lời của AI
  "thresholds": {          // ghi đè ngưỡng trạng thái (tỉ lệ 0–1)
    "passRate": { "good": 0.98, "warn": 0.9 },
    "duration": { "good": 0.05, "warn": 0.2 }
  },
  "screenshots": "all",    // giữ screenshot cả của test pass (mốc cho visual diff)
  "pricing": { "inputPerMTok": 3, "outputPerMTok": 15 },  // ước tính chi phí khi report không có
  "budget": { "tokensPerRun": 200000, "costPerRun": 0.5 }, // cảnh báo vượt ngân sách
  "notify": "failures",    // "all" | "failures" | "off"
  "cacheDir": ".e2e/cache", // nếu đổi thư mục replay cache của e2e
  "linear": { "team": "ENG" }, // gợi ý team; API key KHÔNG đặt ở đây
  "budget": { "perModel": { "anthropic/claude-sonnet-4.5": 5 } } // (gộp với budget ở trên) USD theo model
}
```

<details>
<summary>🗂️ <b>Dữ liệu được lưu ở đâu?</b></summary>

```text
<project>/.e2e-dashboard/
├── .gitignore              ← "*": cả thư mục tự bị git bỏ qua
├── config.json             ← (tuỳ chọn) cấu hình ở trên
├── config.json             ← (tuỳ chọn) cấu hình ở trên
├── server.json             ← port + token khi server đang chạy (quyền 0600)
├── state/                  ← cài đặt, triage, cách ly, Linear đã gửi, sự kiện, cảnh báo, CI sync…
├── runtime/                ← server.log, live.json (tiến độ run hiện tại, cho status line)
├── cache/index.sqlite      ← chỉ mục SQLite (chỉ khi bật trong Cài đặt; xoá đi là dựng lại)
├── longterm/               ← số liệu gom theo ngày, giữ mãi (trang Xu hướng)
├── reports/                ← báo cáo tuần / tháng (.html + .md)
├── digests/<ngày>.md       ← digest đã in
├── exports/run-<id>.html   ← file export
├── site/                   ← trang tĩnh (`publish`)
└── runs/YYYY/MM/DD/<giờ>_<runId>/
    ├── report.json         ← bản copy nguyên văn report của e2e
    ├── meta.json           ← tóm tắt: status, số test, token, git, ghim/baseline
    ├── traces/<resultId>.md
    ├── ai/                 ← cache phân tích AI
    └── artifacts/…         ← video / screenshot / log của test không pass
```

Muốn sao lưu thì copy thư mục, muốn xoá lịch sử thì xoá thư mục.
</details>

<details>
<summary>🧭 <b>Cách hoạt động</b></summary>

```mermaid
flowchart LR
  E2E["🧪 npx e2e run"] -->|onEvent| R["🔌 Reporter"]
  E2E -->|ghi .e2e/report.json| W["👀 Watcher"]
  C["🤖 Claude chạy e2e"] -->|PostToolUse| H["🪝 Hook"]
  R -->|POST /api/events| S["🖥️ Server 127.0.0.1"]
  R & W & H -->|"archive() idempotent"| D[("🗂️ .e2e-dashboard/runs")]
  S -->|SSE live| UI["📊 Dashboard"]
  D --> S
  UI -->|Export| X["📤 HTML tự chứa"]
```

Ba nguồn (reporter, watcher, hook) cùng gọi một hàm `archive()`. Hàm này lấy `run.id` làm khoá và ghi qua thư mục tạm rồi `rename`, nên một run chỉ được lưu đúng một lần.
</details>

---

## 🖥️ Pane E2E trong Claude Code

Plugin có sẵn một pane theo dõi run ngay trong session Claude Code, không cần cài thêm gì:

- Trạng thái run, tiến độ `done/total`, thời gian còn lại ước tính, tên các test đang chạy.
- Pass rate và so với run trước; số pass / flaky / fail / skip.
- Gate, SLO, cảnh báo vượt ngân sách token, top test flaky.
- Nút **Chạy test** / **Dừng run** và link mở dashboard web.
- Trên Claude Desktop: vòng tiến độ, thanh kết quả và biểu đồ xu hướng 10 run bằng SVG có chuyển động. Trên terminal: bản text.
- Toast khi run xong, khi SLO vượt mục tiêu hoặc khi vượt ngân sách.

Mở pane bằng `/e2e-pane` (hoặc `/e2e-dashboard pane`). Cần dashboard đang chạy (`/e2e-dashboard`), vì pane đọc `.e2e-dashboard/` và API của dashboard.

| Lệnh | Việc |
|---|---|
| `/e2e-pane` | Mở pane (chỉ poll khi pane đang mở; đóng pane là dừng) |
| `/e2e-pane theme <default\|ocean\|forest\|sunset\|light>` | Đổi theme; không có tên thì xem theme hiện tại |
| `/e2e-pane motion <on\|off>` | Bật / tắt chuyển động của biểu đồ trên Desktop |

Cách hoạt động và giới hạn:

- Tiến độ đọc từ `.e2e-dashboard/runtime/live.json` mỗi giây; `live.json` không được ghi quá 5 phút thì coi là run đã dừng.
- Số liệu lấy từ `/api/runs` (5 giây một lần) và `/api/gate`, `/api/slo`, `/api/cost`, `/api/flaky` (15 giây một lần), bằng port và token trong `.e2e-dashboard/server.json`.
- **Chạy test** gọi `POST /api/run`, **Dừng run** gọi `POST /api/run/stop`.
- Pane hiện link dashboard kèm token: đừng chia sẻ màn hình khi pane đang mở.
- Chưa kiểm chứng đầy đủ trên Claude Desktop: phần vẽ SVG và chuyển động dựa theo tài liệu của mod API. Nếu chuyển động bị chớp, tắt bằng `/e2e-pane motion off`.
- Mã nằm ở `hooks/pane.tsx` (vẽ pane) và `hooks/pane-pure.ts` (hàm thuần có test); lệnh `/e2e-dashboard pane` chuyển tiếp sang `/e2e-pane`.

> Trước đây pane là một mod riêng tên `e2e-dashboard-tab`. Nó đã nằm trong plugin, nên nếu bạn từng cài mod đó hãy gỡ để khỏi mở hai pane: `/plugin uninstall e2e-dashboard-tab@e2e-dashboard` (plugin tự nhắc một lần cho mỗi phiên bản).

---

## 🔄 Cập nhật & phát hành

**Người dùng:** gõ `/e2e-dashboard version` để xem có bản mới, `/e2e-dashboard update` để cập nhật. Lệnh chạy `claude plugin marketplace update` + `claude plugin update`, rồi tự gọi `/reload-plugins`: không cần khởi động lại Claude Code.

**Người phát hành:** mỗi lần merge vào `main` là một bản phát hành có tag `vX.Y.Z`.

```bash
npm run release -- minor          # patch | minor | major | X.Y.Z
npm run release -- minor --push   # đẩy luôn main + tag lên GitHub
```

Script kiểm tra (`npm test`, `claude plugin validate`, `claude plugin test`), nâng version ở `plugin.json`, `package.json`, reporter, **ghim `marketplace.json` vào tag mới**, commit và tạo tag. Workflow `.github/workflows/tag-on-main.yml` tự gắn tag cho version trên `main` nếu còn thiếu (ví dụ khi merge PR trên GitHub).

---

## 🔒 Bảo mật

| | Biện pháp |
|:-:|---|
| 🏠 | Server chỉ nghe `127.0.0.1` và kiểm tra header `Host` (chống DNS rebinding) |
| 🔑 | Mọi request cần token: cookie `HttpOnly; SameSite=Strict` riêng theo từng port. Request POST còn phải có `Origin` khớp |
| 🧱 | Không bao giờ đi theo symlink do repo gài sẵn khi lưu, export hay phục vụ file |
| 🧼 | Mọi nội dung lấy từ report (lỗi, log, reasoning) đều được escape. Link Markdown chỉ nhận `http(s)` |
| 📄 | Artifact HTML/SVG được trả về dạng text kèm `CSP: sandbox`. File export có CSP riêng dựa trên hash |
| 🤐 | Reporter tự tắt trên CI và không bao giờ throw hay làm hỏng run của e2e |
| ▶️ | Lệnh chạy test được dựng từ danh sách tham số đã kiểm tra (`file:line`, tên target/agent, số nguyên có giới hạn), không qua shell, mỗi project một run |
| ✨ | `claude -p` chạy sandbox: không shell, không MCP, chỉ đọc file; dữ liệu report được rào và đánh dấu không tin cậy |
| 🎫 | API key Linear chỉ lấy từ môi trường hoặc `~/.e2e-dashboard/`, không từ repo; Linear chỉ được gọi khi bạn bấm gửi. Nội dung report vào issue được bỏ HTML và không giả được dòng fingerprint |
| 💬 | `gh` và `git` luôn chạy bằng argv, nội dung comment qua stdin; tên branch, run id, artifact đều được kiểm tra trước |
| 📣 | URL webhook chỉ lấy từ `~/.e2e-dashboard/config.json` hoặc biến môi trường, chỉ `https`: repo clone về không thể gửi dữ liệu test tới địa chỉ nó chọn |
| 🎯 | `git diff` chỉ nhận tên nhánh hợp lệ (không bắt đầu bằng `-`); lịch chạy/watch dùng chung runner đã kiểm tra tham số |
| 🤝 | Run kéo từ thư mục team chỉ là dữ liệu: kiểm tra id khớp tên thư mục, schema `report-1`, bỏ symlink, bỏ kết quả AI của người khác |
| 🛠️ | Tự sửa lỗi: AI chỉ sửa trong worktree tạm từ `origin/main`, chỉ đổi file trong `server/ ui/ reporter/ bin/ test/ support/`, không có shell. Commit và push chạy không hook. Trạng thái nằm ngoài repo (`~/.e2e-dashboard/selfheal/`). Người duyệt xem đủ diff văn bản trước khi `npm test` và push; diff quá 12 KB thì bỏ |
| 🔔 | Thông báo desktop truyền tiêu đề/nội dung qua argv hoặc biến môi trường, không qua shell |
| 🎯 | Bản ghi replay cache chỉ đọc khi tên là hash 64 hex, nằm trong project, không qua symlink, ≤ 1 MiB |
| 🧹 | Dọn rác chỉ gồm 6 nhóm cố định, server tự quét lại khi dọn (trang không bao giờ gửi đường dẫn), chỉ xoá mục đủ cũ, không đi qua symlink, thư mục tạm của hệ điều hành chỉ khi tên khớp `e2ed-gh-*` và thuộc về bạn |
| 🧹 | Reset All chỉ xoá đúng các tên trong danh sách cố định của `.e2e-dashboard` (không glob, không theo symlink); không đụng code, file test hay thư mục `.e2e`; cần gõ `RESET`, và bị từ chối khi đang có run |
| 💌 | Phản hồi gửi bằng `gh issue create` với nội dung qua stdin, repo cố định; từ chối khi chưa tick xác nhận, khi nội dung có dạng token hoặc key, và quá 5 lần trong 10 phút |
| 🧠 | AI viết nội dung QC (bug report, tự log bug) chạy **không có công cụ nào** (không đọc được `.env` hay mã nguồn); dữ liệu từ app và test nằm trong khối rào ngẫu nhiên tách khỏi chỉ thị, và kết quả có dạng token / khoá bị bỏ |
| 🤖 | Tự log bug mặc định tắt, chỉ chạy với lỗi do test (không phải hạ tầng), tối đa 5 issue mỗi run và chống trùng theo fingerprint |

---

## 🛠️ Phát triển

```bash
npm test                   # node --test — 359 test, không dependency
claude plugin test .       # test của mod (update / version)
node test/seed-demo.mjs    # project demo 12 run: flaky, 2 branch, route, cache, ảnh visual diff
```

<details>
<summary>📁 <b>Cấu trúc repo</b></summary>

| Thư mục | Vai trò |
|---|---|
| `reporter/` | Reporter tự chứa + `archive()` + retention (được copy vào project người dùng) |
| `server/` | HTTP server, store, live state, watcher, export |
| `bin/` | CLI `dashboard.mjs`, hook `archive.mjs` |
| `hooks/` | Hook PostToolUse + mod `register.ts` (`update` / `version`) |
| `scripts/` | `release.mjs` — nâng version, ghim marketplace, tạo tag |
| `ui/` | ES module thuần (gộp bằng `ui/bundle.mjs`), icon SVG, chart SVG |
| `commands/` | Lệnh `/e2e-dashboard` |
| `docs/superpowers/` | Spec và plan thiết kế |

</details>

---

<div align="center">

Làm cho [e2e](https://github.com/tester-army/e2e) bởi **thangvofastboy** · Xây dựng cùng [Claude Code](https://claude.com/claude-code) 🤖

</div>
