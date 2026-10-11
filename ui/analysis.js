// Small helpers shared by the M2/M3 pages (all names are unique across ui/: the bundle has one scope).
import { escapeHtml } from './format.js';
import { icon } from './icons.js';

export const fmtPct = (v) => (v == null || Number.isNaN(v) ? '—' : `${Math.round(v * 100)}%`);
export const fmtPoints = (d) => (d == null ? '—' : `${d > 0 ? '+' : ''}${Math.round(d * 100)} điểm`);
export const fmtUsd = (v) => (v == null ? '—' : v < 0.0001 && v > 0 ? '<$0.0001' : v < 0.01 && v > 0 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);
export const fmtSignedMs = (ms, fmt) => (ms == null ? '—' : `${ms > 0 ? '+' : ms < 0 ? '−' : ''}${fmt(Math.abs(ms))}`);

// "last N runs" picker; the page re-renders on change. The choice lives in the hash-free view state.
let analysisRuns = 30;
export const analysisCount = () => analysisRuns;

export function runCountPicker(onChange) {
  const opts = [10, 20, 30, 50, 100];
  const html = `<label class="count-pick">Phân tích <select data-run-count>${opts.map((n) => `<option value="${n}" ${n === analysisRuns ? 'selected' : ''}>${n} run gần nhất</option>`).join('')}</select></label>`;
  const bind = (root) => root.querySelector('[data-run-count]')?.addEventListener('change', (e) => {
    analysisRuns = Number(e.target.value) || 30;
    onChange();
  });
  return { html, bind };
}

export function pageHead(title, ic, sub = '', right = '') {
  return `<div class="page-head"><div><h1>${icon(ic, { size: 18 })} ${escapeHtml(title)}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div><div class="page-tools">${right}</div></div>`;
}

export function emptyBox(title, body = '') {
  return `<div class="empty-state"><h2>${escapeHtml(title)}</h2>${body ? `<p>${body}</p>` : ''}</div>`;
}

export async function copyToClipboard(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const old = button.innerHTML;
      button.innerHTML = `${icon('check', { size: 14 })}Đã copy`;
      setTimeout(() => (button.innerHTML = old), 1500);
    }
    return true;
  } catch {
    return false;
  }
}

// A bar 0..1 drawn inline (score, stability, pass rate), with its value as text beside it.
export function meter(v, tone = 'info', text = fmtPct(v)) {
  const w = Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100);
  return `<span class="meter tone-${escapeHtml(tone)}" title="${escapeHtml(text)}"><i style="width:${w}%"></i></span><span class="meter-val">${escapeHtml(text)}</span>`;
}

export const toneFor = (v, good = 0.95, warn = 0.8) => (v == null ? 'muted' : v >= good ? 'good' : v >= warn ? 'warn' : 'bad');

// A modal dialog with a header and a body to fill; returns both. Closing removes it.
export function openModal(id, title, ic, html = '<p class="muted">Đang tải…</p>') {
  document.getElementById(id)?.remove();
  const dlg = document.createElement('dialog');
  dlg.id = id;
  dlg.className = 'modal';
  dlg.innerHTML = `<div class="run-form"><header><h2>${icon(ic, { size: 16 })}${escapeHtml(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Đóng">${icon('close')}</button></header><div data-body>${html}</div></div>`;
  document.body.append(dlg);
  dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  return { dlg, body: dlg.querySelector('[data-body]') };
}

// A long span (MTTR, time red): minutes, hours or days.
export function fmtSpan(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} phút`;
  const h = ms / 3_600_000;
  return h < 48 ? `${Math.round(h * 10) / 10} giờ` : `${Math.round((h / 24) * 10) / 10} ngày`;
}

// "Last N days" picker shared by the long-term pages; the page re-renders on change.
export function daysPicker(current, options, onChange) {
  const html = `<label class="count-pick">Khoảng <select data-days-pick>${options.map((n) => `<option value="${n}" ${n === current ? 'selected' : ''}>${n} ngày</option>`).join('')}</select></label>`;
  return { html, bind: (root) => root.querySelector('[data-days-pick]')?.addEventListener('change', (e) => onChange(Number(e.target.value))) };
}
