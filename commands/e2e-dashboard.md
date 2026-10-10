---
description: Mở dashboard e2e (live, lịch sử, debug, phân tích). Tham số tuỳ chọn: setup | export [runId] | stop | status | digest [ngày] | projects | statusline [install]
argument-hint: "[setup|export [runId]|stop|status|digest [ngày]|projects|statusline [install]]"
allowed-tools: Bash(node:*), Read, Edit
---

## Kết quả

!`node "${CLAUDE_PLUGIN_ROOT}/bin/dashboard.mjs" $ARGUMENTS`

## Việc của bạn

- Báo lại kết quả trên cho người dùng trong 1–3 dòng, giữ nguyên URL nếu có. Với `digest`, in lại nguyên văn bản Markdown.
- Nếu kết quả có dòng `NEEDS_MANUAL_EDIT <file>`: mở file config đó, thêm dòng import được in ra và thêm `dashboardReporter` vào mảng `reporters` (nếu config chưa có mảng `reporters` thì thêm `reporters: ['list', dashboardReporter]` để không mất output terminal). Sau đó báo lại.
- Không làm việc gì khác.
