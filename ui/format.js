export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function fmtDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}s`;
  return `${Math.floor(ms / 3_600_000)}h${String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0')}m`;
}

export function fmtTokens(n) {
  if (n == null) return '—';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function fmtRelative(iso, now = Date.now()) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86_400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86_400)} ngày trước`;
}

export const STATUS = {
  passed: { icon: '✓', label: 'passed' },
  failed: { icon: '✗', label: 'failed' },
  flaky: { icon: '⚠', label: 'flaky' },
  'timed-out': { icon: '⏱', label: 'timed out' },
  interrupted: { icon: '⏹', label: 'interrupted' },
  skipped: { icon: '⤼', label: 'skipped' },
  blocked: { icon: '⛔', label: 'blocked' },
  cancelled: { icon: '⊘', label: 'cancelled' },
  error: { icon: '✗', label: 'error' },
  running: { icon: '●', label: 'running' },
};

export function statusBadge(status) {
  const s = STATUS[status] ?? { icon: '?', label: status };
  return `<span class="badge s-${escapeHtml(status)}">${s.icon} ${escapeHtml(s.label)}</span>`;
}
