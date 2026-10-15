# Máy Ubuntu có giao diện để thử 1 Click Setup

Desktop Ubuntu XFCE chạy trong Docker, mở bằng trình duyệt. Dùng để thử `install.sh` và trang **1 Click Setup** trên một máy "sạch" (chưa có Node, Claude Code, plugin).

## Khởi động

```bash
cd docker/test-desktop
docker compose up -d --build
```

Lần đầu phải tải image (khoảng 1,5 GB) và khởi động desktop, mất vài phút. Xong thì mở **http://localhost:3300** (hoặc https://localhost:3301, chấp nhận chứng chỉ tự ký). Bạn đăng nhập sẵn với người dùng `abc`, có `sudo` không cần mật khẩu.

Muốn dùng cổng khác: `DESKTOP_PORT=4000 DESKTOP_HTTPS_PORT=4001 docker compose up -d --build`.

Bên trong máy:
- `/opt/e2e-dashboard` là mã nguồn repo, chỉ đọc.
- `~/sample-app` là một app mẫu, được chép vào lần đầu container chạy. `npm start` chạy nó ở http://localhost:5173. Nếu không thấy thư mục này, chạy `cp -r /opt/e2e-dashboard/docker/test-desktop/sample-app ~/`.

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

## Mở trang báo 404 hoặc không vào được

1. Kiểm tra container đã chạy và đang dùng cổng nào:
   ```bash
   docker compose ps
   ```
   Cột `PORTS` phải có `0.0.0.0:3300->3000`.
2. Desktop đã khởi động xong chưa:
   ```bash
   docker compose logs -f desktop
   ```
   Chờ tới khi log báo dịch vụ đã sẵn sàng.
3. Xem app nào đang chiếm cổng:
   ```bash
   lsof -i :3300        # macOS / Linux
   netstat -ano | findstr :3300   # Windows
   ```
   Nếu cổng đã có app khác, trình duyệt sẽ mở trang (thường là 404) của app đó. Đổi cổng bằng `DESKTOP_PORT`.
4. Bản cũ của thư mục này dùng cổng 3000, rất hay trùng với dev server hoặc Grafana. Chạy lại để dùng cổng mới:
   ```bash
   docker compose down && docker compose up -d --build
   ```

## Lưu ý

- Cách A cài bản plugin đang có trên `main`. Muốn thử tính năng mới trước khi merge, dùng cách B. Cách B không cài plugin vào Claude Code, nên `/e2e-dashboard` trong Claude chưa có; dashboard vẫn được mở trực tiếp.
- Home (`/config`) nằm trong volume `home` nên giữ lại giữa các lần chạy. Để thử lại từ đầu:
  ```bash
  docker compose down -v && docker compose up -d
  ```
- Nếu Chromium hoặc Playwright báo thiếu bộ nhớ chia sẻ, tăng `shm_size` trong `docker-compose.yml`.
- Máy Apple Silicon: image có bản arm64, chạy được trực tiếp.
