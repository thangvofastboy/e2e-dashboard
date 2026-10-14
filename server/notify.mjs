// Desktop notification when a run finishes (M3). No shell: title and body are argv or env values,
// so text from the report can never become a command.
import { execFile as nodeExecFile } from 'node:child_process';

const MODES = new Set(['all', 'failures', 'off']);

export function notifyMode(cfg) {
  return MODES.has(cfg?.notify) ? cfg.notify : cfg?.notify === false ? 'off' : cfg?.notify === true ? 'all' : 'failures';
}

export function notifyCommand(title, body, platform = process.platform) {
  const t = String(title).slice(0, 120);
  const b = String(body).slice(0, 240);
  if (platform === 'darwin') return ['osascript', ['-e', 'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run', t, b], {}];
  if (platform === 'win32') {
    const ps = 'Add-Type -AssemblyName System.Windows.Forms; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(8000, $env:E2ED_TITLE, $env:E2ED_BODY, 0); Start-Sleep -Seconds 9; $n.Dispose()';
    return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { env: { ...process.env, E2ED_TITLE: t, E2ED_BODY: b } }];
  }
  // `--`: tiêu đề / nội dung bắt đầu bằng "-" (tên test trong cảnh báo) không bị đọc thành option của notify-send
  return ['notify-send', ['--app-name=e2e-dashboard', ...(/^-/.test(t) || /^-/.test(b) ? ['--'] : []), t, b], {}];
}

export function runMessage(meta, project = '') {
  const s = meta.summary ?? {};
  const n = (v) => Number(v) || 0;
  const failed = n(s.failed) + n(s.interrupted);
  const ok = n(s.passed) + n(s.flaky);
  const title = meta.status === 'passed' ? `e2e ✓ passed${n(s.flaky) ? ` (${n(s.flaky)} flaky)` : ''}` : `e2e ✗ ${failed ? `${failed} fail` : meta.status}`;
  const secs = meta.durationMs != null ? Math.round(meta.durationMs / 1000) : null;
  const body = [project, meta.git?.branch, `${ok}/${ok + failed} pass`, secs != null ? `${Math.floor(secs / 60)}m${String(secs % 60).padStart(2, '0')}s` : null].filter(Boolean).join(' · ');
  return { title, body };
}

export function createNotifier({ mode = 'failures', project = '', platform = process.platform, execImpl = nodeExecFile } = {}) {
  const seen = new Set();
  return {
    // `anomalies`: tests of this run far slower or costlier than their history (insights.anomalies)
    runFinished(meta, { anomalies = 0 } = {}) {
      if (mode === 'off' || !meta?.runId || seen.has(meta.runId)) return false;
      seen.add(meta.runId);
      if (mode === 'failures' && meta.status === 'passed' && !meta.summary?.flaky && !anomalies) return false;
      const msg = runMessage(meta, project);
      const title = meta.status === 'passed' && anomalies && !meta.summary?.flaky ? `e2e ⚠ ${anomalies} test bất thường` : msg.title;
      const body = anomalies ? `${msg.body} · ${anomalies} bất thường (chậm/tốn hơn hẳn mọi khi)` : msg.body;
      const [cmd, args, opts] = notifyCommand(title, body, platform);
      try {
        execImpl(cmd, args, { timeout: 15_000, windowsHide: true, ...opts }, () => {}); // no notifier installed: nothing to do
      } catch {
        // spawn failure: notifications are best-effort
      }
      return true;
    },
    // a free-form message (alerts): shown unless notifications are off
    message(title, body) {
      if (mode === 'off') return false;
      const [cmd, args, opts] = notifyCommand(String(title).slice(0, 120), String(body).slice(0, 300), platform);
      try {
        execImpl(cmd, args, { timeout: 15_000, windowsHide: true, ...opts }, () => {});
      } catch {
        // best-effort
      }
      return true;
    },
  };
}
