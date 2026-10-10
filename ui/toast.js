// Short confirmations and errors at the bottom of the screen, announced to screen readers.
import { escapeHtml } from './format.js';
import { icon } from './icons.js';

const TOAST_ICON = { good: 'check', bad: 'x', warn: 'alert', info: 'info' };

export function toast(message, tone = 'good', ms = 3500) {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.append(box);
  }
  const t = document.createElement('div');
  t.className = `toast tone-${tone}`;
  t.innerHTML = `${icon(TOAST_ICON[tone] ?? 'info', { size: 15 })}<span>${escapeHtml(message)}</span>`;
  box.append(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 300);
  }, ms);
}
