# Máy Ubuntu có giao diện để thử 1 Click Setup

Desktop Ubuntu XFCE chạy trong Docker, mở bằng trình duyệt. Dùng để thử `install.sh` và trang **1 Click Setup** trên một máy "sạch" (chưa có Node, Claude Code, plugin).

## Khởi động

```bash
cd docker/test-desktop
docker compose up -d
```

Mở **http://localhost:3000** (hoặc https://localhost:3001). Bạn đăng nhập sẵn với người dùng `abc`, có `sudo` không cần mật khẩu.

Bên trong máy:
- `/opt/e2e-dashboard` là mã nguồn repo, chỉ đọc.
- `~/sample-app` là một app mẫu: `npm start` chạy nó ở http://localhost:5173.

## Thử 1 Click Setup

Mở **Terminal Emulator** trong desktop, rồi chọn một trong hai cách.

### A. Như người dùng thật (cài plugin từ marketplace, nhánh `main`)

```bash
cd ~/sample-app
curl -fsSL https://raw.githubusercontent.com/thangvofastboy/e2e-dashboard/main/install.sh | bash
```

### B. Thử bản đang phát triển (mã trong repo đang mount)

```bash
cd ~/sample-app
E2E_DASHBOARD_PLUGIN_DIR=/opt/e2e-dashboard bash /opt/e2e-dashboard/install.sh
```

Chạy không tham số thì trình cài đặt hỏi lần lượt. Với app mẫu, trả lời như sau:

| Câu hỏi | Trả lời |
| --- | --- |
| URL app | `http://localhost:5173` |
| Lệnh chạy app | `npm start` |
| AI cho e2e | `claude-code` (dùng tài khoản Claude), hoặc một provider có API key |

Hoặc chạy một lệnh không hỏi:

```bash
E2E_DASHBOARD_PLUGIN_DIR=/opt/e2e-dashboard bash /opt/e2e-dashboard/install.sh \
  -y --app-url http://localhost:5173 --app-command "npm start" --ai claude-code
```

Cài xong, dashboard mở trong Firefox của desktop. Các việc cần kiểm tra:

- Trang **1 Click Setup**: các bước, trạng thái, chạy lại.
- Popup mời setup khi mở một project chưa cấu hình.
- Sửa project: thư mục test, các thư mục khác, AI ghi nhớ.

Đăng nhập Claude Code bằng `claude`, rồi `/login` trong terminal của desktop. Nếu dùng API key, đặt `E2E_AI_API_KEY` trước khi chạy, đừng gõ key trên dòng lệnh.

## Lưu ý

- Cách A cài bản plugin đang có trên `main`. Muốn thử tính năng mới trước khi merge, dùng cách B. Cách B không cài plugin vào Claude Code, nên `/e2e-dashboard` trong Claude chưa có; dashboard vẫn được mở trực tiếp.
- Home (`/config`) nằm trong volume `home` nên giữ lại giữa các lần chạy. Để thử lại từ đầu:
  ```bash
  docker compose down -v && docker compose up -d
  ```
- Nếu Chromium hoặc Playwright báo thiếu bộ nhớ chia sẻ, tăng `shm_size` trong `docker-compose.yml`.
- Máy Apple Silicon: image có bản arm64, chạy được trực tiếp.
