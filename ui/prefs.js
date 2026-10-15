// Tuỳ chọn giao diện của từng người xem (theme, cỡ chữ): chỉ là tiện ích nên lưu localStorage, lỗi storage thì bỏ qua.
const get = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const set = (k, v) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // storage blocked: the choice lasts for this page view only
  }
};

export const FONT_SCALES = [['1', 'Nhỏ'], ['1.1', 'Vừa'], ['1.2', 'Lớn'], ['1.3', 'Rất lớn']];

export const storedTheme = () => get('e2ed-theme'); // 'light' | 'dark' | null = theo hệ thống
export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
export function setTheme(theme) {
  applyTheme(theme);
  set('e2ed-theme', theme === 'light' || theme === 'dark' ? theme : null);
}

export const storedFont = () => (FONT_SCALES.some(([v]) => v === get('e2ed-font')) ? get('e2ed-font') : '1.1');
export function applyFont(scale) {
  document.documentElement.style.setProperty('--fs', scale);
}
export function setFont(scale) {
  if (!FONT_SCALES.some(([v]) => v === scale)) return;
  applyFont(scale);
  set('e2ed-font', scale);
}

export function applyPrefs() {
  applyTheme(storedTheme());
  applyFont(storedFont());
}

// Mục menu bị ẩn (Cài đặt hệ thống → Giao diện): Overview và Cài đặt hệ thống luôn hiện để còn đường bật lại.
export const NAV_LOCKED = new Set(['overview', 'system']);
export function storedHiddenNav() {
  try {
    const v = JSON.parse(get('e2ed-nav-hidden') ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string' && !NAV_LOCKED.has(x)) : []);
  } catch {
    return new Set();
  }
}
export function applyHiddenNav(root = document) {
  const hidden = storedHiddenNav();
  root.querySelectorAll('.nav a[data-nav]').forEach((a) => { a.hidden = hidden.has(a.dataset.nav); });
  root.querySelectorAll('.nav .nav-sec').forEach((s) => { s.hidden = !s.querySelector('a[data-nav]:not([hidden])'); }); // nhóm ẩn hết thì ẩn cả tiêu đề
}
export function setNavHidden(view, hide) {
  const hidden = storedHiddenNav();
  if (hide) hidden.add(view);
  else hidden.delete(view);
  set('e2ed-nav-hidden', hidden.size ? JSON.stringify([...hidden]) : null);
  applyHiddenNav();
}
