// English UI (beta). The dashboard is written in Vietnamese; with English chosen, a dictionary is
// applied to the rendered page (text nodes and title / aria-label / placeholder), so every view is
// covered without threading a t() through each template. Report text (code, logs, Markdown, AI
// answers) is never touched. Strings not in the dictionary stay in Vietnamese.
const EN = {
  // nav & shell
  'Phân tích': 'Analysis', 'Tích hợp': 'Integrations', 'Nhóm lỗi': 'Error groups', 'Chi phí & cache': 'Cost & cache', 'Bản đồ route': 'Route map',
  'Model & ngân sách': 'Models & budget', 'Gợi ý locator': 'Locator hints', 'Lint agent': 'Agent lint', 'Lỗi app': 'App errors', 'Digest tuần': 'Weekly digest',
  'Tự động & lưu trữ': 'Automation & storage', 'Khoảng trống coverage': 'Coverage gaps', 'Coverage': 'Coverage', 'Môi trường': 'Environments', 'Báo cáo': 'Report',
  'Tìm kiếm': 'Search', 'Hỏi AI': 'Ask AI', 'Sáng / Tối': 'Light / Dark', 'Phím tắt': 'Shortcuts', 'Phím tắt (?)': 'Shortcuts (?)', 'Điều hướng': 'Navigation', 'Mở menu': 'Open menu',
  'Chuyển giao diện sáng / tối': 'Toggle light / dark', 'Có gì mới': "What's new", 'Đóng': 'Close', 'Vị trí': 'Breadcrumb', 'Về Overview': 'Back to Overview',
  'Không tìm thấy trang.': 'Page not found.', 'Đang tải': 'Loading', 'Đang tải…': 'Loading…', 'Không tải được trang': 'Could not load the page', 'Thử lại': 'Retry',
  'Chưa cài reporter — chạy': 'Reporter not installed — run', 'để xem live.': 'to see live progress.',
  // common words
  'Tất cả': 'All', 'Thời gian': 'Duration', 'Run gần nhất': 'Latest run', 'Chưa có run nào': 'No runs yet', 'Chi phí': 'Cost', 'Nguồn': 'Source', 'Bắt đầu': 'Started', 'Kết quả': 'Results',
  'Lỗi': 'Error', 'Khoảng': 'Range', 'Gửi': 'Send', 'Chạy': 'Run', 'Huỷ': 'Cancel', 'Thêm': 'More', 'Gỡ': 'Remove', 'Khác': 'Other', 'Mở': 'Open', 'Chênh': 'Delta', 'Lượt': 'Visits',
  'Thay đổi': 'Change', 'So sánh': 'Compare', 'Trước': 'Before', 'Sau': 'After', 'Tốt': 'Good', 'Cần chú ý': 'Needs attention', 'Có vấn đề': 'Problem', 'Chưa đủ dữ liệu': 'Not enough data',
  'Chưa có dữ liệu': 'No data yet', 'ổn định': 'stable', 'vừa xong': 'just now', 'đang xem': 'viewing', 'đã ghim': 'pinned', 'run trước': 'previous run', 'Thực tế': 'Actual', 'Mong đợi': 'Expected',
  'Thực tế:': 'Actual:', 'Mong đợi:': 'Expected:', 'Mẫu:': 'Pattern:', 'Các bước': 'Steps', 'Tốc độ': 'Speed', 'Dung lượng': 'Storage', 'Câu hỏi': 'Question',
  // overview & health
  'Health score': 'Health score', 'Pass rate (TB 10 run)': 'Pass rate (avg of 10 runs)', 'Độ ổn định (ít flaky)': 'Stability (few flaky)', 'Thời gian so với TB': 'Duration vs average',
  'Token so với TB': 'Tokens vs average', 'Replay cache': 'Replay cache', 'Thời gian chạy': 'Run duration', 'Token / run': 'Tokens / run', 'Pass rate theo run': 'Pass rate by run',
  'Kết quả theo run': 'Results by run', 'Token theo run': 'Tokens by run', 'Test chậm nhất (trung bình)': 'Slowest tests (average)', 'Run gần đây': 'Recent runs', 'Xem tất cả →': 'See all →',
  'Cách tính trạng thái': 'How status is computed', 'so với 10 run gần nhất': 'vs the last 10 runs', 'Ít gọi model, chạy nhanh': 'Few model calls, fast', 'nhiều step phải gọi model': 'many steps call the model', 'Nhiều step phải gọi model': 'Many steps call the model',
  'chưa có agent step': 'no agent steps yet', 'Chưa có agent step': 'No agent steps yet', 'Cổng chất lượng': 'Quality gate',
  // runs & run
  'Runs': 'Runs', 'So sánh 2 run': 'Compare 2 runs', 'Chọn đúng 2 run để so sánh.': 'Pick exactly 2 runs to compare.', 'Run cũ hơn là A.': 'The older run is A.', 'Chọn để so sánh': 'Select to compare',
  'Nhập từ GitHub Actions': 'Import from GitHub Actions', 'Phân tích run': 'Analyze run', 'Phân tích lỗi': 'Analyze failure', 'Ghim': 'Pin', 'Đã ghim': 'Pinned', 'Bỏ ghim': 'Unpin',
  'Đặt làm baseline': 'Set as baseline', 'Bỏ baseline': 'Unset baseline', 'Trạng thái lên GitHub': 'Status to GitHub', 'So với run trước': 'Compare with previous', 'So với baseline': 'Compare with baseline',
  'Ma trận': 'Matrix', 'Chọn tất cả fail': 'Select all failed', 'Gửi Linear': 'Send to Linear', 'Tìm commit gây lỗi': 'Find the breaking commit', 'Sửa bằng Claude Code': 'Fix with Claude Code',
  'Chuyển thành locator': 'Turn into locator', 'Video & ảnh': 'Video & images', 'Không có video.': 'No video.', 'Không có log.': 'No log.', 'Không có step.': 'No steps.', 'Không có test.': 'No tests.',
  'Không có test nào khớp bộ lọc.': 'No test matches the filters.', 'Artifact chỉ được lưu cho test không pass.': 'Artifacts are only kept for tests that did not pass.', 'Mở các vị trí này trong editor.': 'Open these locations in your editor.',
  'Tua video đến step này': 'Seek the video to this step', 'Thêm thao tác': 'More actions', 'Viết test từ explore': 'Write a test from explore',
  // compare
  'A là run gốc (cũ hơn), B là run cần xem.': 'A is the base (older) run, B the one to review.', 'Đổi A ↔ B': 'Swap A ↔ B', 'Đăng lên PR': 'Post to PR', 'Hiện cả test không đổi': 'Show unchanged tests too',
  'Mới fail': 'New failure', 'Vẫn fail': 'Still failing', 'Thành flaky': 'Became flaky', 'Đã sửa': 'Fixed', 'Test mới': 'New test', 'Bị bỏ': 'Removed', 'Skip thay đổi': 'Skip changed', 'Không đổi': 'Unchanged',
  'Hai run giống nhau.': 'The two runs are identical.', 'Xem ảnh': 'View images', 'Cạnh nhau': 'Side by side', 'Thanh trượt': 'Slider', 'Khác biệt': 'Difference',
  'Ảnh mẫu (expected)': 'Baseline (expected)', 'Thực tế (actual)': 'Actual', 'Screenshot giữa 2 run': 'Screenshot across 2 runs', 'Phát / dừng': 'Play / pause', 'Đang so từng pixel…': 'Comparing pixels…',
  // tests & test page
  'Tests': 'Tests', 'Lịch sử (cũ → mới)': 'History (old → new)', '10 run gần nhất (cũ → mới)': 'Last 10 runs (old → new)', 'Test bị ảnh hưởng so với': 'Tests affected compared with', 'Tìm': 'Find',
  'File đã đổi': 'Changed files', 'Chạy test này': 'Run this test', 'Thời gian TB': 'Avg duration', 'Các lần fail': 'Failures', 'Step ở run gần nhất': 'Steps in the latest run',
  'Ảnh lúc fail theo thời gian': 'Failure screenshots over time', 'Thời gian theo run': 'Duration by run', 'Lịch sử của test này': "This test's history", 'Không có lần fail nào trong lịch sử.': 'No failures in the history.',
  'Không tìm thấy test': 'Test not found', 'Chưa có test nào trong lịch sử.': 'No tests in the history yet.',
  // flaky / errors / app errors / lint / locators / models
  'Điểm flaky': 'Flaky score', 'Đổi kết quả': 'Flips', 'Tỉ lệ fail': 'Fail rate', 'Lần gần nhất': 'Latest', 'Vì sao?': 'Why?', 'Cách ly': 'Quarantine', 'Chạy ×5': 'Run ×5', 'Copy lệnh': 'Copy command',
  'Không có test flaky': 'No flaky tests', 'Không có lỗi nào': 'No errors', 'Lỗi phía app': 'App-side errors', 'Không có lỗi app nào': 'No app errors', 'Lint câu lệnh agent': 'Agent instruction lint',
  'Không có cảnh báo': 'No warnings', 'Copy code': 'Copy code', 'Nhờ AI viết lại': 'Ask AI to rewrite', 'Xem run': 'View run', 'Chưa có step nào đủ ổn định': 'No step is stable enough yet',
  'Chưa có dữ liệu model': 'No model data yet', 'Lỗi theo môi trường': 'Failures by environment', 'Hệ điều hành': 'Operating system', 'Trình duyệt': 'Browser', 'Phiên bản e2e': 'e2e version', 'Giờ chạy': 'Hour of run',
  'Route có test': 'Routes with tests', 'Chưa có test': 'No tests yet', 'chưa có test': 'no test yet', 'Viết test': 'Write a test', 'Trang không test nào mở tới': 'Pages no test opens',
  // cost
  'Token / run (TB)': 'Tokens / run (avg)', 'Model call': 'Model calls', 'Chi phí / run (TB)': 'Cost / run (avg)', 'Chi phí theo run': 'Cost by run', 'Kết quả cache của agent.act': 'agent.act cache outcomes',
  'Vì sao không replay được': 'Why replay missed', 'Test tốn token nhất (TB / run)': 'Most token-hungry tests (avg / run)', 'Token theo vai trò model': 'Tokens by model role', 'Step chậm nhất (trung bình)': 'Slowest steps (average)',
  'Thời gian theo giai đoạn': 'Time by phase', 'Setup + hook theo run': 'Setup + hooks by run', 'Thân test': 'Test body', 'Chạy lại từ cache': 'Replayed from cache', 'Agent tiếp quản': 'Agent took over',
  'Không có cache': 'No cache', 'Tắt cache': 'Cache off',
  // projects / digest / settings / report
  'Projects': 'Projects', 'Mở dashboard': 'Open dashboard', 'Lệnh mở': 'Open command', 'Bỏ khỏi danh sách': 'Remove from list', 'Chưa có project nào': 'No projects yet', 'Copy Markdown': 'Copy Markdown',
  'Tải .md': 'Download .md', 'Chế độ watch': 'Watch mode', 'Bật watch': 'Enable watch', 'Lịch chạy': 'Schedule', 'Chưa đặt lịch.': 'No schedule set.', 'Chưa có webhook.': 'No webhooks.', 'Gửi thử': 'Send a test',
  'Xoá video': 'Delete videos', 'Xoá run': 'Delete run', 'Run nặng nhất': 'Largest runs', 'In / Lưu PDF': 'Print / Save PDF', 'Video': 'Video', 'Ảnh': 'Images', 'Trace': 'Trace',
  'Thêm project': 'Add project', 'Chọn thư mục project': 'Choose project folder', 'Đường dẫn': 'Path', 'Thư mục con': 'Subfolders', 'Không có thư mục con': 'No subfolders', 'Chọn thư mục này': 'Choose this folder',
  'Thư mục không tồn tại': 'Folder does not exist', 'Không có quyền đọc thư mục': 'No permission to read folder',
  'Tải dữ liệu về': 'Download data', 'Tên file': 'File name', 'Tải về': 'Download', 'Đang chuẩn bị file…': 'Preparing file…',
  'Thêm lịch chạy': 'Add schedule', 'Sửa lịch chạy': 'Edit schedule', 'Xoá lịch chạy': 'Delete schedule', 'Xoá lịch': 'Delete schedule', 'Chạy ngay': 'Run now', 'Sửa': 'Edit', 'Tên lịch': 'Schedule name', 'Project': 'Project',
  'Giờ chạy trong ngày': 'Times of day', 'Thêm giờ': 'Add time', 'Giờ mới': 'New time', 'Thứ trong tuần': 'Days of week', 'Mỗi ngày': 'Every day', 'Thứ 2–6': 'Mon–Fri', 'Thứ Hai – Thứ Sáu': 'Monday – Friday', 'Thứ 2': 'Mon', 'Thứ 3': 'Tue', 'Thứ 4': 'Wed', 'Thứ 5': 'Thu', 'Thứ 6': 'Fri', 'Thứ 7': 'Sat', 'Chủ nhật': 'Sun',
  'Test sẽ chạy': 'Tests to run', 'Chọn test': 'Pick tests', 'Lọc theo tên hoặc file': 'Filter by name or file', 'Lọc test': 'Filter tests', 'Chọn hết': 'Select all', 'Bỏ chọn': 'Clear', 'Thêm test bằng tay': 'Add tests by hand', 'Đang tải danh sách test…': 'Loading tests…',
  'Mỗi dòng một file hoặc file:dòng, cho test chưa có trong lịch sử run.': 'One file or file:line per line, for tests not in the run history yet.', 'Không có test khớp bộ lọc': 'No tests match the filter', 'Project chưa có run nào: thêm test bằng tay bên dưới hoặc chạy toàn bộ suite.': 'This project has no runs yet: add tests by hand below or run the whole suite.',
  'Bỏ qua test đang cách ly': 'Skip quarantined tests', 'Bật lịch': 'Schedule enabled', 'Lưu lịch': 'Save schedule', 'Đang tắt': 'Disabled', 'Đã thêm lịch chạy': 'Schedule added', 'Đã lưu lịch chạy': 'Schedule saved', 'Chưa có lịch nào tạo trên dashboard.': 'No schedules created on the dashboard yet.',
  'Hiện trong danh sách lịch và thông báo.': 'Shown in the schedule list and notifications.', 'Thêm project ở trang Projects. Dashboard nào đang mở cũng chạy hộ.': 'Add projects on the Projects page. Any open dashboard runs it.', 'theo Settings của project': "project's Settings",
  'Mặc định: trình duyệt đặt ở Settings của project.': "Default: the browser set in the project's Settings.", 'Số test chạy song song. Để trống = mặc định ở Settings của project, hoặc tự động.': "Tests run in parallel. Blank = the project's Settings default, or automatic.",
  'Chọn giờ, thứ, project, test và option như hộp Chạy test. Chỉ chạy khi có ít nhất một dashboard đang mở; dashboard nào mở cũng chạy hộ mọi project.': 'Pick times, days, project, tests and the same options as the Run dialog. Runs only while at least one dashboard is open; any open dashboard runs every project.',
  'Không tải được danh sách lịch.': 'Could not load schedules.', 'Cấu hình bằng file': 'Configure by file', 'Chọn ít nhất một test, hoặc chọn Toàn bộ suite.': 'Pick at least one test, or choose Whole suite.', 'Đang có một run khác chạy ở project này': 'Another run is in progress in this project',
  'Thêm đồng bộ từ CI': 'Add CI sync', 'Sửa đồng bộ từ CI': 'Edit CI sync', 'Sửa cấu hình': 'Edit config', 'Workflow': 'Workflow', 'Artifact': 'Artifact', 'Branch': 'Branch', 'Chu kỳ (phút)': 'Interval (minutes)', 'Lưu': 'Save', 'Đã lưu cấu hình đồng bộ CI': 'CI sync config saved',
  'Tên file workflow trong .github/workflows.': 'Workflow file name in .github/workflows.', 'Tên artifact chứa report. Để trống = tự tìm.': 'Artifact holding the report. Blank = find it automatically.', 'Chỉ lấy run của branch này. Để trống = mọi branch.': 'Only runs of this branch. Blank = every branch.', '5 đến 1440 phút.': '5 to 1440 minutes.',
  '.. (thư mục cha)': '.. (parent folder)', 'Lần tới:': 'Next:', 'Lần gần nhất:': 'Last:', 'đã chạy': 'started',
  // dialogs & AI
  'Chạy toàn bộ suite': 'Run the whole suite', 'Chạy test': 'Run tests', 'Toàn bộ suite': 'Whole suite', 'Danh sách test': 'Test list', 'Phân tích lại': 'Analyze again', 'Hỏi thêm về kết quả này…': 'Ask a follow-up…',
  'Câu hỏi của bạn…': 'Your question…', 'Chat đã lưu': 'Saved chats', 'Xoá chat này': 'Delete this chat', 'Còn lại': 'Remaining', 'Không có test nào đang chạy.': 'No tests running.', 'Chưa có test nào fail.': 'No failed tests yet.', 'Vì sao flaky': 'Why flaky', 'Bước tái hiện': 'Repro steps', 'Tóm tắt run': 'Run summary', 'mới nhất ở trên': 'newest first', 'CPU máy': 'Machine CPU', 'RAM máy': 'Machine RAM', 'CPU test': 'Test CPU', 'RAM test': 'Test RAM', 'Test đang chạy': 'Running tests', 'Chưa chạy': 'Not running', 'Disk trống': 'Free disk', 'trình duyệt + runner': 'browser + runner', 'CPU / RAM của runner hiện khi có run': 'Runner CPU / RAM shows during a run', 'Tự cài': 'Auto', 'Chạy tay': 'Manual', 'Quick Setup xong': 'Quick Setup done', 'Máy đã đủ mọi thứ, không cần cài gì.': 'Everything is installed, nothing to do.', '(tuỳ chọn)': '(optional)', 'Cuộc trò chuyện mới': 'New chat', 'Nhắn cho AI… (Enter gửi, Shift+Enter xuống dòng)': 'Message AI… (Enter to send, Shift+Enter for newline)', 'Đang suy nghĩ…': 'Thinking…', 'Dừng': 'Stop', 'Hỏi AI về bộ test': 'Ask AI about the suite', 'Đang phân tích…': 'Analyzing…', 'Xong.': 'Done.', 'Bảng phím tắt này': 'This shortcut list', 'Test kế tiếp': 'Next test', 'Test trước': 'Previous test',
  'Đang chạy': 'Running', 'Đang nhận dữ liệu live': 'Receiving live data', 'Mở screenshot': 'Open screenshot', 'Mở screenshot lúc fail': 'Open failure screenshot', 'Chạy lại test đang xem': 'Rerun the current test', 'Phân tích lỗi bằng AI': 'Analyze the failure with AI', 'Mô tả issue': 'Issue description', 'Copy cho Claude (Linear MCP)': 'Copy for Claude (Linear MCP)', 'Gửi lên Linear': 'Send to Linear',
  // M6 pages
  'Không tìm thấy route nào của app': 'No app routes found', 'Fail tập trung ở': 'Failures concentrate in',
  'CSV run': 'Runs CSV', 'CSV test': 'Tests CSV', 'CSV flaky': 'Flaky CSV', 'Budget còn lại': 'Budget left', 'Video cạnh nhau (phát đồng bộ)': 'Videos side by side (synced)',
  'Đã copy lệnh: dán vào Claude Code để Claude sửa và chạy lại test': 'Command copied: paste it into Claude Code to have Claude fix and rerun the test',
  // M7 tracking pages
  'Theo dõi': 'Tracking', 'Xu hướng': 'Trends', 'Triage lỗi': 'Triage', 'Module / team': 'Modules / teams', 'Phát hành': 'Releases', 'Truy vết': 'Traceability', 'Vòng đời test': 'Test lifecycle',
  'Xu hướng dài hạn': 'Long-term trends', 'Theo module / team': 'By module / team', 'Báo cáo phát hành': 'Release report', 'Truy vết yêu cầu': 'Requirement traceability',
  'Báo cáo tự động': 'Scheduled reports', 'Cảnh báo': 'Alerts', 'Đồng bộ từ CI': 'CI sync', 'Sự kiện': 'Events', 'Đang fail lâu nhất': 'Failing the longest', 'Theo tuần': 'By week',
  'Pass rate theo ngày': 'Pass rate by day', '12 tháng qua': 'Last 12 months', 'Mới': 'New', 'Đang xem': 'Investigating', 'Đã biết': 'Known', 'Bỏ qua': 'Ignored',
  'Gửi ngay': 'Send now', 'Xem': 'View', 'Xuất trang tĩnh': 'Export static site', 'Đồng bộ ngay': 'Sync now', 'Đánh dấu': 'Mark', 'Sẵn sàng phát hành': 'Ready to release',
  'Có rủi ro': 'At risk', 'Chưa nên phát hành': 'Not ready to release', 'Đang fail': 'Failing', 'Số run': 'Runs', 'Kết quả flaky': 'Flaky results', 'Đang pass': 'Passing',
  'Test bị bỏ': 'Removed tests', 'Đổi tên': 'Renamed', 'Luôn fail': 'Always failing', 'Test đang chạy': 'Active tests', 'Phụ trách': 'Assignee', 'Ghi chú': 'Note', 'Trạng thái': 'Status',
  'Lịch': 'Schedule', 'Gửi lần cuối': 'Last sent', 'Tuần': 'Week', 'Tháng': 'Month', 'Không có cảnh báo nào đang bật.': 'No active alerts.', 'Chưa bật.': 'Not enabled.',
  'Trang báo cáo tĩnh cho cả team': 'Static report site for the team', 'Run được dùng': 'Runs used', 'Bản phát hành': 'Release', 'Pass rate ở tag': 'Pass rate at the tag',
  'Flaky trong bản này': 'Flaky in this release', 'Story': 'Story', 'Điểm': 'Grade', 'Xu hướng ': 'Trend', 'Tất cả test (lâu đời nhất trước)': 'All tests (oldest first)',
  'Tìm test, mã lỗi, URL, branch, commit, run id…': 'Search tests, error codes, URLs, branches, commits, run ids…', 'Không có kết quả.': 'No results.',
};

const PATTERNS = [
  [/^không chạy được \((.+)\)$/, 'could not start ($1)'], [/^(\d+) test$/, '$1 tests'], [/^(\d+) worker$/, '$1 workers'],
  [/^((?:Thứ [2-7]|Chủ nhật)(?:, (?:Thứ [2-7]|Chủ nhật))+)$/, (m) => m.replace(/Thứ ([2-7])/g, (_, d) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d - 2]).replace('Chủ nhật', 'Sun')],
  [/^Đã chọn (\d+) test$/, '$1 tests selected'],
  [/^Không lưu được: (.+)$/, 'Could not save: $1'],
  [/^Đã chạy lịch "(.+)" ở project (.+)$/, 'Started schedule "$1" in project $2'],
  [/^Bỏ giờ (.+)$/, 'Remove $1'],
  [/^Project đã có trong danh sách: (.+)$/, 'Project is already in the list: $1'],
  [/^Đã thêm project: (.+)$/, 'Project added: $1'],
  [/^Không phải thư mục: (.+)$/, 'Not a folder: $1'],
  [/^Dung lượng: (.+)$/, 'Size: $1'],
  [/^Không xuất được: (.+)$/, 'Export failed: $1'],
  [/^(\d+) phút trước$/, '$1 min ago'], [/^(\d+) giờ trước$/, '$1 h ago'], [/^(\d+) ngày trước$/, '$1 days ago'],
  [/^Chạy (\d+) test$/, 'Run $1 tests'], [/^Chạy lại \((\d+)\)$/, 'Rerun ($1)'], [/^(\d+) run gần nhất$/, 'last $1 runs'], [/^(\d+) ngày$/, '$1 days'],
  [/^(\d+) điểm so với run trước$/, '$1 points vs previous run'], [/^([+-]?\d+%) so với TB 10 run$/, '$1 vs 10-run average'], [/^(\d+) test · (\d+) lần$/, '$1 tests · $2 times'],
  [/^Xem thêm (\d+) run \(còn (\d+)\)$/, 'Show $1 more runs ($2 left)'], [/^(\d+) bất thường$/, '$1 anomalies'],
  [/^(\d+) test · (\d+) lượt$/, '$1 tests · $2 visits'], [/^Route test đi qua nhưng không thấy trong app \((\d+)\)$/, 'Routes tests visit that are not in the app ($1)'],
  [/^Hiện thêm (\d+)$/, 'Show $1 more'], [/^làn (\d+) · /, 'lane $1 · '],
];
// chia trang bảng/danh sách (app.js pageItems) và biểu đồ làn ở Live
Object.assign(EN, {
  'Hiện tất cả': 'Show all', 'Thu gọn': 'Collapse',
  'Mỗi cột là một làn, thời gian chạy từ trên xuống. Làn được xếp theo thời gian chạy chồng nhau, không phải số worker thật.':
    'Each column is a lane, time runs top to bottom. Lanes come from overlapping run times, not the real worker count.',
});

const ATTRS = ['title', 'aria-label', 'placeholder', 'data-tip'];
const SKIP = 'code, pre, .md, .ai-body, kbd, textarea, .log, .err, .eg-msg, .hm-label, .hb-label';
let lang = 'vi';

export function translate(text) {
  if (lang !== 'en' || !text) return text;
  const t = text.trim();
  if (!t || !/[à-ỹđ]/i.test(t)) return text;
  const hit = EN[t] ?? PATTERNS.reduce((acc, [rx, to]) => acc ?? (rx.test(t) ? t.replace(rx, to) : null), null);
  return hit ? text.replace(t, hit) : text;
}

export function translateTree(root) {
  if (lang !== 'en' || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement?.closest(SKIP)) continue;
    const t = translate(n.nodeValue);
    if (t !== n.nodeValue) n.nodeValue = t;
  }
  for (const el of root.querySelectorAll?.(ATTRS.map((a) => `[${a}]`).join(',')) ?? []) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v == null) continue;
      const t = translate(v);
      if (t !== v) el.setAttribute(a, t);
    }
  }
}

function storedLang() {
  try {
    return localStorage.getItem('e2ed-lang') === 'en' ? 'en' : 'vi';
  } catch {
    return 'vi';
  }
}

export const currentLang = () => lang;

// Apply the stored choice and keep translating whatever the views render next.
export function initI18n() {
  lang = storedLang();
  document.documentElement.lang = lang;
  if (lang !== 'en') return;
  translateTree(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType === 1) translateTree(n);
      else if (n.nodeType === 3 && !n.parentElement?.closest(SKIP)) {
        const t = translate(n.nodeValue);
        if (t !== n.nodeValue) n.nodeValue = t;
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

export function setLang(next) {
  try {
    localStorage.setItem('e2ed-lang', next);
  } catch {
    // storage blocked: the choice lasts for this page view only
  }
  location.reload(); // simplest way to re-render every view in the other language
}
