# e2e-dashboard — M1 (Lõi + AI cơ bản) — Design

- Ngày: 2026-10-10
- Trạng thái: chờ review
- Repo: `git@github.com:thangvofastboy/e2e-dashboard.git`
- Framework được theo dõi: [tester-army/e2e](https://github.com/tester-army/e2e) (report schema `report-1`)

## 1. Mục tiêu

Một **plugin cho Claude Code**, gọi bằng `/e2e-dashboard`, mở một web dashboard local để:

1. **Theo dõi live** một run e2e (tiến độ từng test/step, Gantt, ETA).
2. **Lưu lịch sử** mọi run (e2e ghi đè `report.json` mỗi lần chạy).
3. **Debug** test fail: timeline agent, video đồng bộ, screenshot, log, trace, source.
4. **Chạy / chạy lại** test (chọn test fail để rerun) ngay từ dashboard.
5. **Phân tích bằng AI** (lỗi, cả run) qua `claude -p`, không cần API key.
6. **Chia sẻ** bằng file HTML tĩnh. (Gửi Linear qua Claude + Linear MCP thuộc M3.)

### Ràng buộc

- **Không cài thêm gì**: chỉ cần Node (đã có vì e2e cần Node) và `claude` CLI. 0 dependency npm, không bước build, không CDN.
- Chỉ chạy **local**, server bind `127.0.0.1`.
- Lưu trữ theo **từng project** đang test.

### Ngoài phạm vi M1

Xem roadmap (mục 10). Đặc biệt: không có Linear, flaky analytics, so sánh run, chart phân tích sâu trong M1.

## 2. Người dùng & luồng chính

Dev chạy e2e trên máy mình (tay hoặc qua Claude). Trong Claude Code gõ `/e2e-dashboard` → trình duyệt mở dashboard của project hiện tại.

| Lệnh | Việc |
|---|---|
| `/e2e-dashboard` | Bật server nền nếu chưa chạy (dùng lại nếu đã chạy), mở trình duyệt, in URL |
| `/e2e-dashboard setup` | Copy reporter vào project và gắn vào `e2e.config.ts` (để có live) |
| `/e2e-dashboard export [runId]` | Xuất HTML tĩnh (mặc định run mới nhất) |
| `/e2e-dashboard stop` | Tắt server |

Lệnh nằm ở `commands/e2e-dashboard.md`, nhận tham số qua `$ARGUMENTS`. Cần xác minh khi implement: gõ `/e2e-dashboard` không namespace có hoạt động không (tên đầy đủ `/e2e-dashboard:e2e-dashboard`).

## 3. Kiến trúc

Repo này vừa là plugin vừa là marketplace (`/plugin marketplace add thangvofastboy/e2e-dashboard` → `/plugin install e2e-dashboard`).

```
.claude-plugin/plugin.json, marketplace.json
commands/e2e-dashboard.md       lệnh duy nhất, điều phối theo tham số
hooks/hooks.json                PostToolUse(Bash) → bin/archive.mjs
bin/
  dashboard.mjs                 start | stop | status | export | setup (CLI mà command gọi)
  archive.mjs                   lưu report vào lịch sử (dùng bởi hook)
server/
  index.mjs                     HTTP: REST + SSE + static UI + files (Range)
  store.mjs                     đọc run, pin/baseline; archive() import từ reporter
  watch.mjs                     fs.watch <output>/report.json
  live.mjs                      trạng thái live, xếp làn Gantt, ETA
  runner.mjs                    spawn `npx e2e run`, dựng lệnh, dừng
  ai.mjs                        spawn `claude -p`, parse stream-json, cache
  git.mjs                       branch/commit/dirty, commit giữa 2 run
  prompts/analyze-failure.md, analyze-run.md
reporter/e2e-dashboard.reporter.mjs   reporter + archive() + retention (tự chứa), setup copy vào project
ui/
  index.html, app.js, router.js, api.js, markdown.js, charts.js (SVG), style.css
  views/overview.js, runs.js, run.js, live.js, tests.js
test/                           node --test
```

Mỗi file một trách nhiệm; `store`, `live`, `runner`, `ai`, `git` không phụ thuộc HTTP và test được độc lập.

### Lưu trữ trong project

```
<project>/.e2e-dashboard/
  config.json                   (tuỳ chọn) output dir, retention, ai.model, ai.language, port
  server.json                   {port, pid, token} khi server chạy
  runs/<startedAt>_<runId>/
    report.json                 bản copy nguyên văn
    meta.json                   tóm tắt (mục 4.2)
    traces/<resultId>.md
    artifacts/...               chỉ của test không pass, giữ đường dẫn tương đối như report
    ai/<cacheKey>.md            kết quả AI
```

`setup` thêm `.e2e-dashboard/` vào `.gitignore` của project.

## 4. Luồng dữ liệu

### 4.1 Thu thập: 4 nguồn, cùng gọi `archive()`

| Nguồn | Khi nào | Ghi chú |
|---|---|---|
| Reporter | Mọi run (sau `setup`) | `onEvent` → `POST /api/events` không await, nuốt lỗi. `onRunFinished` → `archive()`. Nguồn duy nhất có live từng step |
| Watcher | Server đang chạy | `fs.watch` `<output>/report.json`, debounce 500 ms |
| Hook | Claude chạy Bash | `matcher: "Bash"`; `bin/archive.mjs` đọc JSON của hook từ stdin, chỉ làm việc khi `tool_input.command` khớp `\be2e\s+(run|explore)\b`. Luôn exit 0, timeout 10 s |
| Dashboard | Bấm Run/Rerun | server spawn e2e; chưa có reporter thì live = stdout, xong thì watcher archive |

**Reporter trong project**: `setup` copy `reporter/e2e-dashboard.reporter.mjs` thành `<project>/e2e-dashboard.reporter.mjs` (được commit, 0 dependency) và thêm vào `reporters` trong `e2e.config.ts` cạnh reporter hiện có. Reporter:

- tự tắt khi `CI` được set;
- đọc `.e2e-dashboard/server.json` để biết port + token; không có server thì chỉ archive;
- không bao giờ throw, không block; `onRunFinished` tôn trọng `AbortSignal`.

Reporter chạy trong process e2e (không có plugin), nên file reporter **tự chứa** hàm `archive()` và export nó (`export function archive`, `export default reporter`). `server/store.mjs` và `bin/archive.mjs` import `archive` từ chính file `reporter/e2e-dashboard.reporter.mjs` của plugin → một nguồn logic duy nhất; `setup` copy nguyên văn. File có hằng `VERSION`; dashboard cảnh báo khi bản trong project cũ hơn bản của plugin và gợi ý chạy lại `setup`.

### 4.2 `archive(projectRoot, {source, rerunOf?, report?, reportPath?, artifactsRoot?, traces?})`

1. Lấy report:
   - **Reporter** truyền dữ liệu trong bộ nhớ từ `FinishedRun` (`report`, `reportPath`, `artifactsRoot`, `traces`); `reportPath` có thể undefined khi e2e ghi file thất bại, vẫn archive được từ `report`.
   - **Hook / watcher / dashboard** đọc đĩa: `<output>/report.json`, với `<output>` theo thứ tự ưu tiên: `artifactsRoot` server học được từ event `run-started` gần nhất → `output` trong `.e2e-dashboard/config.json` → `.e2e`. Khi `artifactsRoot` từ event khác với thư mục đang watch, watcher chuyển sang theo dõi thư mục mới.
   - `schemaVersion !== 'report-1'` → bỏ qua, ghi cảnh báo.
2. Nếu đã có `runs/*_<run.id>` → dừng (idempotent).
3. Ghi vào `runs/.tmp-<random>/` rồi `rename` thành tên đích; rename thất bại vì đã tồn tại → xoá tmp, coi như thành công (race giữa reporter và watcher).
4. Copy `trace.md` (từ `traces` của FinishedRun, hoặc dò `results/<test>/trace.md`) và artifact của result có `status !== 'passed'`; artifact không có `path` thì bỏ qua; video có `url` giữ nguyên url.
5. `meta.json`: `runId, startedAt, finishedAt, status, exitCode, summary (đếm theo status), tokens (tổng input/output), modelCalls, replay (replayedActions/totalActions), targets, git {branch, commit, dirty}, source, rerunOf, pinned:false, baseline:false, kind ('run'|'explore')`.
6. Retention: giữ 50 run mới nhất (cấu hình được) không tính run `pinned`. Reporter và watcher có thể dọn cùng lúc, nên xoá phải bỏ qua `ENOENT`.

Không có file index; server quét `meta.json` khi cần.

### 4.3 API server

Mọi route dưới `127.0.0.1:<port>`. Request ghi (POST) yêu cầu header `X-E2E-Dashboard-Token` khớp `server.json` **và** `Origin` là chính server (hoặc không có Origin đối với reporter). Sai → 403. Mọi GET (kể cả `/api/*` và `/files/*`) cũng yêu cầu token: lần đầu mở URL `/?token=…`, server đặt cookie `HttpOnly; SameSite=Strict; Path=/` rồi redirect bỏ token khỏi URL. `SameSite=Strict` để tab của site khác không đọc được dữ liệu test (có thể chứa nội dung trang).

| Route | Việc |
|---|---|
| `GET /api/runs` | danh sách meta, mới nhất trước |
| `GET /api/runs/:id` | `{meta, report}` |
| `POST /api/runs/:id/pin`, `/baseline` | bật/tắt; baseline chỉ một run |
| `GET /api/tests` | danh sách test (từ report mới nhất + lịch sử 10 run gần nhất) |
| `GET /files/runs/:id/*` | artifact/trace, hỗ trợ `Range` |
| `GET /api/live` | SSE: snapshot đầu tiên, rồi event |
| `POST /api/events` | reporter đẩy event |
| `POST /api/run` | `{tests:["file:line"], targets?, agents?, retries?, repeatEach?, noCache?, rerunOf?}` |
| `POST /api/run/stop` | SIGINT, 10 s sau SIGTERM |
| `POST /api/ai/:action` | SSE stream kết quả AI (mục 6) |
| `POST /api/ai/:action/followup` | `{sessionId, question}` |

### 4.4 Live, Gantt, ETA

- Trạng thái live giữ trong bộ nhớ, key theo `(testId, target, agent, repeat)`; event lạ bỏ qua.
- `test-started` không có worker id → **xếp làn**: test mới vào làn trống có số nhỏ nhất. Đây là xấp xỉ, không phải worker thật; UI ghi rõ "làn".
- ETA = tổng thời gian trung bình lịch sử của các test còn lại trong `plan` (test chưa có lịch sử dùng trung vị) ÷ số làn đang bận; ẩn nếu chưa có lịch sử.

### 4.5 Chạy / chạy lại test

- Lệnh: `npx e2e run <file:line>... [--target t]... [--agent a]... [--retries n] [--repeat-each n] [--no-cache]`, cwd = project root.
- `file:line` lấy từ `source.file` + `source.line` của result.
- Chọn test thuộc nhiều target: truyền mọi `--target` tương ứng (có thể chạy dư tổ hợp; chấp nhận ở M1).
- Mỗi project chỉ một run tại một thời điểm (server từ chối run thứ hai, 409).
- Run do dashboard khởi động ghi `source: 'dashboard'` và `rerunOf` vào meta khi archive.
- Trước khi dùng, implement phải xác minh `--target`/`--agent` có lặp được nhiều lần không; nếu không thì tách thành nhiều lệnh tuần tự.

## 5. UI

Bố cục **A**: sidebar trái (Overview, Runs, Live, Tests; mục M2 sẽ thêm vào đây), nội dung giữa, **panel AI** bên phải thu gọn được. Hash routing, deep link `#/run/<runId>/test/<resultId>`. Light/dark theo hệ thống.

### Overview
KPI (pass rate, run gần nhất, thời gian TB, token/run); chart pass rate + stacked bar kết quả theo run; chart thời gian và token theo run; danh sách run (status, branch, thời gian, nguồn, 📌).

### Run detail
- Header: status, đếm, thời gian, token, % replay, git (branch@commit, dirty), nút Ghim / Baseline / Export / ✨ Phân tích run.
- Thanh lọc: tag, file, target, agent, status. Chọn test: checkbox, "Chọn tất cả fail", nút **Rerun đã chọn** (mở hộp thoại Run). Nút **Ma trận** chuyển danh sách thành lưới test × target.
- Danh sách test bên trái; bên phải: **timeline agent** theo attempt (chọn attempt), mỗi step có kind/api/label/status/thời lượng/model calls/cache; mở ra thấy events (💭 reasoning, engine action, navigation, poll) và lỗi kèm nút ✨ **Phân tích lỗi**.
- Video: bấm step → `currentTime` = `step.startedAt − attempt.startedAt` (giây); nếu thiếu mốc thì không tua.
- Tab: Screenshot, Log (`attempt.appLog`: log network/console của app có trong report; stdout/stderr `output` chỉ xem được ở Live vì không được lưu vào report), Trace (`trace.md` render Markdown), Source (`file:line`).

### Live
Tiến độ `done/total`, ETA, nút Dừng; Gantt làn; step đang chạy của test được chọn. Không có reporter: hiện stdout và gợi ý `/e2e-dashboard setup`.

### Tests + hộp thoại Run
Mọi test theo file/tag, chấm trạng thái 10 run gần nhất, thời gian TB, checkbox. Hộp thoại Run: test đã chọn, target, agent, retries, repeat-each, `--no-cache` → chạy → chuyển sang Live.

### Export HTML
Một file duy nhất: HTML + CSS + JS của UI, `report.json` + `meta.json` + kết quả AI đã cache nhúng dạng JSON, screenshot nhúng base64. Video không nhúng (quá nặng), ghi chú tên file. Chạy ở chế độ chỉ-đọc (ẩn Run, AI, Live). Mặc định ghi `.e2e-dashboard/exports/run-<id>.html`.

### Chart
`charts.js` tự vẽ SVG: line, stacked bar. Đủ cho M1; loại khác thêm ở M2.

## 6. Hạ tầng AI

### Hành động M1
- `analyze-failure` `{runId, resultId}`: phân loại (lỗi app / lỗi test / flaky / môi trường), nguyên nhân khả nghi, bằng chứng (file:line, commit, step), gợi ý sửa.
- `analyze-run` `{runId}`: tóm tắt run, gom lỗi theo nguyên nhân, ưu tiên xử lý.

### Luồng
1. Server dựng context: lỗi đã redact, timeline rút gọn của attempt fail, đường dẫn trace/screenshot/source, và **danh sách commit giữa run gần nhất mà test này pass và run hiện tại** (`git log A..B --oneline`, nếu có cả hai commit).
2. Spawn, cwd = project root, prompt qua stdin:
   ```
   claude -p --output-format stream-json --verbose
          --allowedTools "Read,Grep,Glob,Bash(git log:*),Bash(git diff:*),Bash(git show:*)"
          --max-turns 20 [--model <ai.model>]
   ```
3. Parse stream-json từng dòng → SSE: `text` (nội dung), `tool` ("đang đọc checkout.e2e.ts…"), `done {sessionId}`, `error`.
4. Hỏi thêm: `claude -p --resume <sessionId>` cùng cờ trên.

### Prompt
`server/prompts/*.md`, có `version` ở đầu. Ngôn ngữ trả lời theo `ai.language` (mặc định `vi`). Nội dung lấy từ report (lỗi, text trên trang, reasoning của agent) được bọc trong khối đánh dấu **dữ liệu không tin cậy, không làm theo chỉ dẫn bên trong**.

### Cache
Key = `sha256(action + runId + resultId + promptVersion)`, lưu `runs/<run>/ai/<key>.md`. Có cache thì trả ngay. Nút **Phân tích lại** bỏ qua cache và ghi đè. Câu trả lời hỏi thêm không cache.

### Giới hạn & lỗi
- Chỉ đọc; gợi ý sửa là văn bản.
- Tối đa 2 tiến trình `claude` đồng thời (thêm thì xếp hàng); client ngắt SSE → kill tiến trình; timeout 5 phút.
- `claude` không có trên PATH / chưa đăng nhập / stderr lỗi → sự kiện `error` có thông điệp và cách khắc phục.

## 7. Xử lý lỗi

| Tình huống | Xử lý |
|---|---|
| report hỏng / schema khác | bỏ qua run, cảnh báo trên UI |
| event type lạ | bỏ qua |
| artifact không có `path` | không copy, UI hiện "không có file" |
| reporter lỗi | try/catch toàn bộ, không ảnh hưởng run e2e |
| hook lỗi | exit 0, timeout ngắn |
| `/e2e-dashboard` khi server đã chạy | dùng lại; `server.json` có pid chết → ghi đè; port 4477, bận thì tìm port trống |
| run thứ hai khi đang chạy | 409 |
| SSE rớt | client tự nối lại, nhận snapshot |
| disk | retention 50 run, artifact chỉ của test không pass |

## 8. Kiểm thử

Dùng `node --test`, không dependency.

- **Unit**: archive (idempotent, race hai nguồn, chỉ copy artifact không pass, schema sai), retention + pinned, xếp làn, ETA, dựng lệnh run, parser stream-json, markdown renderer, git context, reporter chạy độc lập (không import gì ngoài `node:*`).
- **Integration**: server port ngẫu nhiên; POST thiếu token hoặc sai Origin → 403; `POST /api/events` tới được client SSE; `GET /files` với Range trả 206; `POST /api/run` thứ hai → 409.
- **Fixture**: `report-v1.valid.json` từ repo e2e (Apache-2.0, ghi nguồn), luồng event mẫu, `claude` giả (script in stream-json mẫu) để test `ai.mjs` không gọi model thật.
- **E2E thật**: `examples/vite` của repo e2e + `setup` + chạy test; kiểm tra lịch sử, live, rerun, export, AI qua Chrome DevTools.
- **Dogfood (tuỳ chọn)**: test e2e cho chính dashboard.

## 9. Rủi ro & điều cần xác minh khi implement

Kết quả xác minh (2026-10-10, e2e 0.19.0 + @e2e-dev/web 0.14.0 trên `examples/with-vite`, Node 24, Claude Code 2.1.296):

1. `/e2e-dashboard` không namespace: **chưa xác minh** — cần cài plugin vào Claude Code thật (xem README). Cùng lúc kiểm tra `${CLAUDE_PLUGIN_ROOT}` được thay trong `!`-command. Manifest plugin + marketplace đã qua `claude plugin validate`.
2. `--target`/`--agent`: **đã xác minh** — nhận "comma-separated or repeated" (dùng cho M1b).
3. Cờ `claude -p`: **đã xác minh** `--allowedTools`, `--resume <id>`, `--output-format stream-json`; **không thấy `--max-turns`** trong `claude --help` → M1b dùng timeout thay cho giới hạn lượt, hoặc kiểm lại khi viết spec M1b.
4. Sửa `e2e.config.ts`: **đã xác minh** trên config dạng `export default { … } satisfies E2EConfig` — chèn `reporters: ['list', dashboardReporter]`, output terminal giữ nguyên, `tsc --noEmit` sạch nhờ `.d.mts`.
5. Video: **chưa xác minh trên dữ liệu thật** — engine web mặc định không quay video ở run đã thử; logic tua có unit test (`stepVideoOffset`).

Phát hiện thêm khi chạy thật:
- e2e 0.19 cần Node ≥ 22.22.3 (hoặc ≥ 24.8); không ảnh hưởng plugin (plugin chạy trên Node ≥ 20).
- Thư mục kết quả mỗi test tên `<slug>-<16 hex đầu của result.id>` → archive qua hook/watcher dùng hậu tố này để ghép `trace.md` (5/5 đúng trên run thật).
- `artifactsRoot` = `<output>/results`, khớp giả định của watcher.

## 10. Roadmap

| Mốc | Nội dung |
|---|---|
| **M1** (spec này) | Lõi thu thập + server + UI (Overview, Run detail, Live, Tests), timeline agent, video sync, log, ma trận, Gantt + ETA, git context, deep link, lọc, retention + ghim/baseline, chạy/rerun test, export HTML, AI: phân tích lỗi + phân tích run, chart cơ bản |
| **M2** Phân tích & biểu đồ | flaky + heatmap, so sánh 2 run, nhóm lỗi, chi phí & cache, so sánh model + ngân sách, step chậm nhất, visual diff, tìm kiếm, bản đồ route, setup timing, so sánh branch, nhiều project, health score, report flaky/chi phí/so sánh |
| **M3** AI nâng cao & tích hợp | AI: vì sao flaky, nhóm lỗi, chi phí, giải thích khác biệt, finding → test, hỏi AI tự do; Linear (tạo issue, gắn issue, chống trùng); lint câu lệnh agent; agent step → locator; CODEOWNERS; digest tuần; status line; thông báo desktop |

### M1 được tách thành hai phần, mỗi phần một plan

| Phần | Nội dung | Mục spec |
|---|---|---|
| **M1a** Thu thập & xem | plugin + lệnh `/e2e-dashboard` (open/setup/export/stop), reporter + hook + watcher + `archive()`, server chỉ đọc + SSE live, UI Overview / Run detail / Live / Tests (không có hộp thoại Run, không có nút AI), ghim/baseline, export HTML | 2, 3, 4.1–4.4, 5 (trừ Run/AI), 7, 8 |
| **M1b** Điều khiển & AI | `POST /api/run`, `/api/run/stop`, hộp thoại Run, chọn test fail để rerun, hạ tầng AI + `analyze-failure` + `analyze-run`, panel AI | 4.5, 6, phần Run/AI của 5 |

M1a không spawn tiến trình nào nên an toàn hơn để ra trước, và đã dùng được hằng ngày (live, lịch sử, debug, chia sẻ). Plan đầu tiên chỉ cho M1a.
