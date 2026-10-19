// Chuỗi Cookie dán từ DevTools (Network → Request Headers → Cookie) → storageState của Playwright.
// Cookie là bí mật: thông báo lỗi không bao giờ chứa tên hay giá trị cookie.

const fail = (message) => Object.assign(new Error(message), { status: 400 });
const NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/; // token theo RFC 6265
const MAX_COOKIES = 100;

// "Cookie: a=1; b=2" hoặc "a=1; b=2" (dấu tách là ; hoặc xuống dòng) → [{ name, value }]; giá trị giữ nguyên, không giải mã
export function parseCookieHeader(text) {
  if (typeof text !== 'string') throw fail('Cookie phải là chuỗi');
  const pairs = text.trim().replace(/^cookie:/i, '').split(/;|\r?\n/).map((p) => p.trim()).filter(Boolean);
  if (!pairs.length) throw fail('Chưa có cookie nào: dán chuỗi Cookie từ DevTools (name=value; name2=value2)');
  if (pairs.length > MAX_COOKIES) throw fail(`Tối đa ${MAX_COOKIES} cookie`);
  return pairs.map((p) => {
    const eq = p.indexOf('=');
    const name = eq < 1 ? '' : p.slice(0, eq).trim();
    if (!NAME.test(name)) throw fail('Cookie sai định dạng: mỗi cookie cần dạng name=value, tên không có khoảng trắng');
    return { name, value: p.slice(eq + 1).trim() };
  });
}

// Cookie dán vào áp dụng cho đúng hostname của `url` (host-only); secure theo scheme vì cookie secure không gửi qua http.
// Header Cookie không mang domain / path / hết hạn nên dùng giá trị an toàn: path "/", phiên trình duyệt (expires -1).
export function cookieState(pairs, url) {
  const u = new URL(url);
  return {
    cookies: pairs.map(({ name, value }) => ({ name, value, domain: u.hostname, path: '/', expires: -1, httpOnly: false, secure: u.protocol === 'https:', sameSite: 'Lax' })),
    origins: [],
  };
}
