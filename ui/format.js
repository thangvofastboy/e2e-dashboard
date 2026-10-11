import { icon } from './icons.js';

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

const pad2 = (n) => String(n).padStart(2, '0');
export const fmtDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};

export function fmtRelative(iso, now = Date.now()) {
  const s = (now - Date.parse(iso)) / 1000;
  if (!Number.isFinite(s)) return '—';
  // a future time (clock skew, imported CI runs) or an old one reads better as a date than "vừa xong"
  if (s < -60 || s >= 30 * 86_400) return fmtDate(iso);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86_400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86_400)} ngày trước`;
}

export const STATUS = {
  passed: { icon: 'check', tone: 'good', label: 'passed' },
  failed: { icon: 'x', tone: 'bad', label: 'failed' },
  flaky: { icon: 'alert', tone: 'warn', label: 'flaky' },
  'timed-out': { icon: 'timer', tone: 'bad', label: 'timed out' },
  interrupted: { icon: 'stop', tone: 'warn', label: 'interrupted' },
  skipped: { icon: 'skip', tone: 'muted', label: 'skipped' },
  blocked: { icon: 'ban', tone: 'warn', label: 'blocked' },
  cancelled: { icon: 'ban', tone: 'muted', label: 'cancelled' },
  error: { icon: 'x', tone: 'bad', label: 'error' },
  running: { icon: 'loader', tone: 'info', label: 'running' },
  finished: { icon: 'check', tone: 'info', label: 'finished' },
};

const statusOf = (status) => (Object.hasOwn(STATUS, status) ? STATUS[status] : null) ?? { icon: 'info', tone: 'muted', label: status };

export function statusBadge(status) {
  const s = statusOf(status);
  return `<span class="chip tone-${s.tone}" data-status>${icon(s.icon, { size: 12 })}${escapeHtml(s.label)}</span>`;
}

const COUNT_KEYS = ['passed', 'flaky', 'failed', 'interrupted', 'skipped'];

export function countChips(summary = {}) {
  return COUNT_KEYS.filter((k) => summary[k])
    .map((k) => `<span class="cnt tone-${STATUS[k].tone}" title="${STATUS[k].label}">${icon(STATUS[k].icon, { size: 13, label: STATUS[k].label })}${escapeHtml(summary[k])}</span>`)
    .join('') || '—';
}
