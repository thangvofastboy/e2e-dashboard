# Desktop Ubuntu XFCE (linuxserver/webtop) + app mẫu chép sẵn vào home lần đầu chạy.
FROM lscr.io/linuxserver/webtop:ubuntu-xfce
# script khởi tạo phải thuộc root, nếu không linuxserver bỏ qua; vì vậy chép vào image thay vì mount từ máy host
COPY --chmod=755 <<'SH' /custom-cont-init.d/50-sample-app
#!/usr/bin/with-contenv bash
if [ ! -d /config/sample-app ]; then
  cp -r /defaults/sample-app /config/sample-app
  chown -R abc:abc /config/sample-app
fi
SH
COPY sample-app /defaults/sample-app
