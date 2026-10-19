// Điểm vào duy nhất của plugin: hooks.json chỉ cho một module hook mỗi plugin, nên file này nối hai phần.
// - register.ts: lệnh /e2e-dashboard (mở dashboard, update, version…), cập nhật e2e sau mỗi lần plugin đổi bản, nhắc gỡ mod cũ.
// - pane.tsx: pane E2E trong Claude Code (/e2e-pane). Trước đây là mod riêng e2e-dashboard-tab.
// Engine chỉ cho một on("session.start") không matcher mỗi module nên khởi động của hai phần gộp ở đây; lỗi của một phần
// không làm vỡ phần kia hay session.
import type { Register } from 'claude-code'

import { register as registerPane, startPane } from './pane'
import { register as registerPlugin, startPlugin } from './register'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await startPlugin($).catch(() => undefined)
    await startPane($).catch(() => undefined)
    return next(e)
  })
  registerPlugin(on)
  registerPane(on)
}
