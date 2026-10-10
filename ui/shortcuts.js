// Keyboard: "?" help, "g" then a letter to jump between pages, "/" search. Pages add their own keys
// (the run page: j/k, r, a, l) through setPageKeys().
import { openModal } from './analysis.js';
import { escapeHtml } from './format.js';

export const GO_KEYS = { o: ['#/', 'Overview'], r: ['#/runs', 'Runs'], l: ['#/live', 'Live'], t: ['#/tests', 'Tests'], f: ['#/flaky', 'Flaky'], e: ['#/errors', 'Nhóm lỗi'], a: ['#/app-errors', 'Lỗi app'], c: ['#/cost', 'Chi phí'], s: ['#/settings', 'Cài đặt'] };
let pageKeys = {};

export function setPageKeys(keys) {
  pageKeys = keys ?? {};
}

const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function shortcutHelp() {
  const rows = [['?', 'Bảng phím tắt này'], ['/ hoặc Ctrl K', 'Tìm kiếm'], ...Object.entries(GO_KEYS).map(([k, [, label]]) => [`g ${k}`, label]), ...Object.entries(pageKeys).map(([k, v]) => [k, v.label])];
  openModal('keys-dialog', 'Phím tắt', 'bolt', `<table class="table keys"><tbody>${rows.map(([k, v]) => `<tr><td><kbd>${escapeHtml(k)}</kbd></td><td>${escapeHtml(v)}</td></tr>`).join('')}</tbody></table>`);
}

export function bindShortcuts({ onSearch }) {
  let g = false;
  let gTimer = null;
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || document.querySelector('dialog[open]')) return;
    if (g) {
      g = false;
      clearTimeout(gTimer);
      const to = GO_KEYS[e.key];
      if (to) {
        e.preventDefault();
        location.hash = to[0];
      }
      return;
    }
    if (e.key === 'g') {
      g = true;
      gTimer = setTimeout(() => (g = false), 1200);
    } else if (e.key === '?') shortcutHelp();
    else if (e.key === '/') {
      e.preventDefault();
      onSearch();
    } else if (pageKeys[e.key]) {
      e.preventDefault();
      pageKeys[e.key].run();
    }
  });
}
