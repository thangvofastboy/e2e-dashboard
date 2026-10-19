// Đọc file spec do `playwright-core codegen` ghi ra thành danh sách bước đọc được (parse theo dòng, không dùng AST).
// Dòng không nhận ra thành bước `other` để không bỏ rơi thao tác nào. Popup / tab mới dùng biến page1, page2…
// nên mọi regex nhận `page\d*` và Step nhớ tên biến đó (`page`) để viết lại đúng khi che giá trị.

const ACTIONS = ['click', 'dblclick', 'fill', 'type', 'pressSequentially', 'press', 'check', 'uncheck', 'selectOption', 'setInputFiles'];
const ACTION_LINE = new RegExp(`^await (page\\d*)\\.(.+)\\.(${ACTIONS.join('|')})\\((.*)\\);?$`);
const GOTO_LINE = /^await (page\d*)\.goto\((.*)\);?$/;
const EXPECT_LINE = /^await expect\((page\d*)\.(.+)\)\.(\w+)\((.*)\);?$/;
const SKIP_LINE = /^(import\s|test(\.\w+)?\(|\}\);?$|\}$)/;
const STRING_ARG = /^\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/;

const unescape = (s) => s.replace(/\\(.)/g, '$1');
const firstString = (args) => {
  const m = STRING_ARG.exec(args ?? '');
  return m ? unescape(m[2]) : null;
};

// Mô tả ngắn của locator bằng tiếng Việt; không nhận ra thì giữ nguyên văn
function describeLocator(locator) {
  const role = /^getByRole\(\s*(['"])(.*?)\1(?:\s*,\s*\{[^}]*?name:\s*(['"])(.*?)\3)?/.exec(locator);
  if (role) {
    const label = { button: 'nút', link: 'liên kết', textbox: 'ô nhập', checkbox: 'ô tích chọn' }[role[2]] ?? role[2];
    return role[4] ? `${label} "${unescape(role[4])}"` : label;
  }
  const by = /^(getByLabel|getByPlaceholder|getByText|getByTestId|getByTitle|getByAltText)\(/.exec(locator);
  if (by) {
    const s = firstString(locator.slice(by[0].length));
    if (s !== null) return by[1] === 'getByText' ? `"${s}"` : by[1] === 'getByTestId' ? `phần tử [${s}]` : `ô "${s}"`;
  }
  const css = /^locator\(/.exec(locator);
  if (css) {
    const s = firstString(locator.slice(css[0].length));
    if (s !== null) return `phần tử ${s}`;
  }
  return locator;
}

// Câu mô tả của một bước; dùng lại khi che giá trị nhạy cảm để câu không còn giá trị gốc
export function stepText(kind, locator, value, extra = '') {
  const target = locator ? describeLocator(locator) : '';
  switch (kind) {
    case 'goto': return `Mở trang ${value ?? ''}`.trim();
    case 'click': return `Bấm ${target}`;
    case 'dblclick': return `Bấm đúp ${target}`;
    case 'fill': return `Nhập "${value ?? ''}" vào ${target}`;
    case 'type':
    case 'pressSequentially': return `Gõ "${value ?? ''}" vào ${target}`;
    case 'press': return `Nhấn phím ${value ?? ''} tại ${target}`;
    case 'check': return `Tích chọn ${target}`;
    case 'uncheck': return `Bỏ chọn ${target}`;
    case 'selectOption': return `Chọn "${value ?? ''}" ở ${target}`;
    case 'setInputFiles': return `Tải lên tệp "${value ?? ''}" ở ${target}`;
    case 'expect': return `Kiểm tra ${target} ${extra}`.trim();
    default: return `Thao tác: ${extra}`;
  }
}

const tidy = (code) => code.replace(/^await\s+/, '').replace(/;$/, '');

export function parseSpec(text) {
  const steps = [];
  let url = null;
  let inUse = false; // đang ở trong khối `test.use({ … })` nhiều dòng (codegen chèn storageState khi có --load-storage)
  String(text ?? '').split('\n').forEach((raw, line) => {
    const code = raw.trim();
    if (inUse) {
      if (/^\}\);?$/.test(code)) inUse = false;
      return;
    }
    if (/^test\.use\(\{\s*$/.test(code)) {
      inUse = true;
      return;
    }
    if (!code || SKIP_LINE.test(code)) return;
    let m = GOTO_LINE.exec(code);
    if (m) {
      const value = firstString(m[2]);
      if (url === null && value !== null) url = value;
      return steps.push({ line, code, page: m[1], kind: 'goto', locator: null, value, text: stepText('goto', null, value) });
    }
    m = EXPECT_LINE.exec(code);
    if (m) return steps.push({ line, code, page: m[1], kind: 'expect', locator: m[2], value: firstString(m[4]), text: stepText('expect', m[2], null, m[3]) });
    m = ACTION_LINE.exec(code);
    if (m) {
      const value = firstString(m[4]);
      return steps.push({ line, code, page: m[1], kind: m[3], locator: m[2], value, text: stepText(m[3], m[2], value) });
    }
    steps.push({ line, code, page: null, kind: 'other', locator: null, value: null, text: stepText('other', null, null, tidy(code)) });
  });
  return { url, steps };
}

const DIACRITICS = /[̀-ͯ]/g;

// Tên → slug an toàn cho tên file: chỉ [a-z0-9-], tối đa 60 ký tự, có thể rỗng
export function slugify(name) {
  return String(name ?? '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}
