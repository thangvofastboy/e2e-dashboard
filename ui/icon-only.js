// Nút chỉ hiện icon: chữ của nút (button / a.button có svg.icon) bọc vào <span class="btn-label">,
// CSS ẩn kiểu sr-only khi <html class="icon-only"> (trình đọc màn hình vẫn đọc), hover hiện data-tip.
// Số đếm cuối chữ ("Chỉ test fail 2") tách ra .btn-count để vẫn hiện cạnh icon.
const ICON_ONLY_KEY = 'e2ed-iconOnly';
const VOID_TAGS = /^<(br|img|input|hr|wbr)\b/i;

// HTML bên trong một nút → { html, label } (label đã escape như trong HTML), null nếu không cần đổi
function wrapButtonLabel(inner) {
  if (!/<svg\b[^>]*class="icon\b/.test(inner) || inner.includes('btn-label')) return null;
  let depth = 0;
  const texts = [];
  const html = (inner.match(/<[^>]+>|[^<]+/g) ?? []).map((tok) => {
    if (tok[0] === '<') {
      if (tok[1] === '/') depth--;
      else if (!tok.endsWith('/>') && !VOID_TAGS.test(tok)) depth++;
      return tok;
    }
    if (depth || !tok.trim()) return tok;
    texts.push(tok.trim());
    const m = /^(\s*)(.*?)(?:\s+(\d+))?(\s*)$/s.exec(tok);
    return `${m[1]}<span class="btn-label">${m[2]}</span>${m[3] ? ` <span class="btn-count">${m[3]}</span>` : ''}${m[4]}`;
  }).join('');
  return texts.length ? { html, label: texts.join(' ') } : null;
}

const attrOf = (attrs, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1] ?? '';
const tipFor = (label, extra) => [label, extra].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ');

// Bản thuần trên chuỗi HTML (dùng cho test và cho iconOnly bên dưới)
export function iconOnlyHtml(html) {
  const one = (open, attrs, inner, close) => {
    const w = wrapButtonLabel(inner);
    if (!w) return `${open}${attrs}>${inner}${close}`;
    const tip = tipFor(w.label.replace(/"/g, '&quot;'), attrOf(attrs, 'data-tip') || attrOf(attrs, 'title'));
    return `${open}${attrs.replace(/\sdata-tip="[^"]*"/, '')} data-tip="${tip}">${w.html}${close}`;
  };
  return String(html)
    .replace(/(<button\b)([^>]*)>([\s\S]*?)(<\/button>)/g, (_m, o, a, i, c) => one(o, a, i, c))
    .replace(/(<a\b)([^>]*\bclass="[^"]*\bbutton\b[^"]*"[^>]*)>([\s\S]*?)(<\/a>)/g, (_m, o, a, i, c) => one(o, a, i, c));
}

// Bản DOM: chạy sau mỗi lần vẽ trang; chạy lại không đổi gì (đã có .btn-label thì bỏ qua)
export function iconOnly(root) {
  for (const b of root.querySelectorAll('button, a.button')) {
    const w = wrapButtonLabel(b.innerHTML);
    if (!w) continue;
    b.innerHTML = w.html;
    const label = [...b.querySelectorAll('.btn-label, .btn-count')].map((x) => x.textContent.trim()).join(' ');
    b.dataset.tip = tipFor(label, b.dataset.tip || b.getAttribute('title'));
  }
}

export function storedIconOnly() {
  try {
    return localStorage.getItem(ICON_ONLY_KEY) !== '0'; // mặc định bật
  } catch {
    return true;
  }
}
export function setIconOnly(on) {
  document.documentElement.classList.toggle('icon-only', on);
  try {
    localStorage.setItem(ICON_ONLY_KEY, on ? '1' : '0');
  } catch {
    // storage bị chặn: chỉ áp dụng cho lần xem này
  }
}
