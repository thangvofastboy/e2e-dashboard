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

// Style (Cài đặt hệ thống › Giao diện): mỗi lựa chọn lưu ở localStorage e2ed-<key> và gắn data-<key> lên <html>;
// giá trị mặc định thì bỏ thuộc tính. Bảng màu và màu nhấn có biến thể sáng / tối, đi theo Theme.
export const PALETTES = [['default', 'Mặc định'], ['nord', 'Nord'], ['solarized', 'Solarized'], ['contrast', 'Tương phản cao']];
export const ACCENTS = [['auto', 'Theo bảng màu'], ['blue', 'Xanh dương'], ['violet', 'Tím'], ['emerald', 'Xanh ngọc'], ['rose', 'Hồng'], ['amber', 'Cam']];
export const DENSITIES = [['comfortable', 'Thoáng'], ['normal', 'Vừa'], ['compact', 'Gọn']];
export const RADII = [['sharp', 'Vuông'], ['normal', 'Vừa'], ['round', 'Tròn']];
// kiểu chart chuỗi thời gian (ui/charts.js lineChart); auto = như thiết kế của từng chart (đường hoặc vùng)
export const CHART_TYPES = [['auto', 'Mặc định'], ['line', 'Đường'], ['area', 'Vùng'], ['bar', 'Cột'], ['step', 'Bậc thang']];
const STYLES = { palette: [PALETTES, 'default'], accent: [ACCENTS, 'auto'], density: [DENSITIES, 'normal'], radius: [RADII, 'normal'], chart: [CHART_TYPES, 'auto'] };
export const STYLE_KEYS = Object.keys(STYLES);

export function storedStyle(key) {
  const [opts, def] = STYLES[key];
  const v = get(`e2ed-${key}`);
  return opts.some(([o]) => o === v) ? v : def;
}
export function applyStyle(key, value) {
  if (value === STYLES[key][1]) delete document.documentElement.dataset[key];
  else document.documentElement.dataset[key] = value;
}
export function setStyle(key, value) {
  const [opts, def] = STYLES[key] ?? [];
  if (!opts?.some(([o]) => o === value)) return;
  applyStyle(key, value);
  set(`e2ed-${key}`, value === def ? null : value);
}

// Loại chart chọn ngay trên một chart (thanh Đường / Vùng / Cột / Bậc): nhớ riêng theo tên chart, thắng lựa chọn chung
const CHART_KINDS = CHART_TYPES.map(([v]) => v).filter((v) => v !== 'auto');
export function storedChartType(name) {
  const v = get(`e2ed-chart:${name}`);
  return CHART_KINDS.includes(v) ? v : null;
}
export function setChartType(name, kind) {
  if (kind == null || CHART_KINDS.includes(kind)) set(`e2ed-chart:${name}`, kind); // null: bỏ lựa chọn riêng
}

export function applyPrefs() {
  applyTheme(storedTheme());
  applyFont(storedFont());
  for (const k of STYLE_KEYS) applyStyle(k, storedStyle(k));
}

// Mục menu bị ẩn (Cài đặt hệ thống → Giao diện): Overview và Cài đặt hệ thống luôn hiện để còn đường bật lại.
export const NAV_LOCKED = new Set(['overview', 'system', 'setup']); // 1 Click Setup: không ẩn được, luôn có đường cài khi project thiếu
// Mặc định ẩn các trang phân tích ít dùng; chưa lưu gì thì dùng mặc định, đã lưu [] nghĩa là người dùng chọn hiện hết
export const DEFAULT_HIDDEN_NAV = ['cost', 'models', 'locators', 'lint'];
export function storedHiddenNav() {
  const raw = get('e2ed-nav-hidden');
  if (raw == null) return new Set(DEFAULT_HIDDEN_NAV.filter((x) => !NAV_LOCKED.has(x)));
  try {
    const v = JSON.parse(raw);
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
  set('e2ed-nav-hidden', JSON.stringify([...hidden])); // [] (không bỏ key) để không quay lại mặc định
  applyHiddenNav();
}
