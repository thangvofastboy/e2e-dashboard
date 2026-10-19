// Che giá trị nhạy cảm trong file codegen trước khi lưu hoặc gửi cho AI. Không chắc thì che (thà che thừa).
// Giá trị thật biến thành process.env.E2E_SECRET_<n> trong spec và «ẩn» trong danh sách bước.
// Mỗi cặp (ô, giá trị) có biến riêng: nhập sai rồi nhập đúng vào cùng một ô vẫn là hai giá trị khác nhau.
import { parseSpec, stepText } from './recorder-spec.mjs';

export const MASK = '«ẩn»';
const SENSITIVE_NAME = /password|passw|pwd|\bpw\b|\bpass\b|mật khẩu|mat khau|\botp\b|\bpin\b|cvv|card|secret|token|api[-_ ]?key|xác thực|xac thuc|xác nhận|mã bảo mật|security code|\b2fa\b|verification/i;
// tên tham số URL: tách theo ký tự lạ và camelCase rồi so từng từ (client_secret, accessToken, X-Amz-Signature; keyword thì không)
const SECRET_WORDS = new Set(['token', 'secret', 'key', 'code', 'auth', 'session', 'pass', 'password', 'passwd', 'pwd', 'sig', 'signature', 'otp', 'jwt', 'credential', 'credentials', 'sid', 'bearer', 'apikey']);
const KEY_LIKE = /^[A-Za-z0-9+/_=-]{32,}$/; // chuỗi dài giống khoá API / token
const FILL_KINDS = new Set(['fill', 'type', 'pressSequentially', 'selectOption']);
const MIN_SCRUB = 4; // giá trị ngắn hơn không quét lại toàn file được (sẽ phá chuỗi thường)

const esc = (s) => s.replace(/[`\\]|\$\{/g, (m) => `\\${m}`);
const safeDecode = (s) => {
  try { return decodeURIComponent(s); } catch { return s; }
};
const sensitiveParam = (name) => safeDecode(name).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).some((w) => SECRET_WORDS.has(w));
// phím gõ ra một ký tự: 'a', 'Shift+B'; Enter / Tab / Backspace… không phải ký tự gõ
const typedChar = (key) => (key?.length === 1 ? key : /^Shift\+(.)$/.exec(key ?? '')?.[1]?.toUpperCase() ?? null);
// các dạng một giá trị có thể nằm trong file spec: nguyên văn và đã escape theo từng kiểu nháy
const forms = (v) => {
  const bs = v.replace(/\\/g, '\\\\');
  return [v, bs.replace(/'/g, "\\'"), bs.replace(/"/g, '\\"'), bs.replace(/`/g, '\\`')];
};

// Che mật khẩu trong userinfo, query và fragment của URL; trả null nếu không có gì để che
function redactUrl(value, env, values) {
  const shown = [];
  const code = [];
  let hit = false;
  const lit = (s) => { shown.push(s); code.push(esc(s)); };
  const sec = (label, raw) => {
    hit = true;
    values.add(raw);
    shown.push(MASK);
    code.push(`\${${env(`url:${label}`, raw)}}`);
  };
  let rest = value;
  const ui = /^([a-z][a-z0-9+.-]*:\/\/[^/?#@:]*:)([^/?#@]+)@/i.exec(rest);
  if (ui) {
    lit(ui[1]);
    sec('userinfo', ui[2]);
    lit('@');
    rest = rest.slice(ui[0].length);
  }
  const params = (str) => str.split('&').forEach((p, i) => {
    if (i) lit('&');
    const eq = p.indexOf('=');
    if (eq > 0 && eq < p.length - 1 && sensitiveParam(p.slice(0, eq))) {
      lit(p.slice(0, eq + 1));
      sec(p.slice(0, eq), p.slice(eq + 1));
    } else lit(p);
  });
  const hashAt = rest.indexOf('#');
  const main = hashAt < 0 ? rest : rest.slice(0, hashAt);
  const q = main.indexOf('?');
  if (q < 0) lit(main);
  else {
    lit(main.slice(0, q + 1));
    params(main.slice(q + 1));
  }
  if (hashAt >= 0) {
    lit('#');
    const frag = rest.slice(hashAt + 1);
    if (frag.includes('=')) params(frag);
    else lit(frag);
  }
  return hit ? { shown: shown.join(''), code: `\`${code.join('')}\`` } : null;
}

export function redactSpec(text) {
  const src = String(text ?? '');
  const lines = src.split('\n');
  const { steps } = parseSpec(src);
  const edits = new Map(); // chỉ số dòng → dòng mới, hoặc null = xoá dòng
  const envOf = new Map(); // (ô, giá trị) → tên biến
  const values = new Set();
  const env = (where, value) => {
    const key = `${where}\u0000${value}`;
    if (!envOf.has(key)) envOf.set(key, `E2E_SECRET_${envOf.size + 1}`);
    return `process.env.${envOf.get(key)}`;
  };
  const out = [];
  const edit = (step, code, extra = {}) => {
    edits.set(step.line, /^\s*/.exec(lines[step.line])[0] + code);
    out.push({ ...step, ...extra, code });
  };

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const pg = s.page ?? 'page';
    const sensitive = Boolean(s.locator) && SENSITIVE_NAME.test(s.locator);
    if (s.kind === 'goto' && s.value) {
      const r = redactUrl(s.value, env, values);
      if (r) {
        edit(s, `await ${pg}.goto(${r.code});`, { value: r.shown, text: stepText('goto', null, r.shown) });
        continue;
      }
    } else if (FILL_KINDS.has(s.kind) && s.value !== null && (sensitive || KEY_LIKE.test(s.value))) {
      values.add(s.value);
      edit(s, `await ${pg}.${s.locator}.${s.kind}(${env(s.locator, s.value)});`, { value: MASK, text: stepText(s.kind, s.locator, MASK) });
      continue;
    } else if (s.kind === 'press' && sensitive && typedChar(s.value) !== null) {
      // gõ từng phím vào ô nhạy cảm: gộp cả chuỗi thành một bước fill; phím như Enter/Tab giữ nguyên
      let typed = '';
      let j = i;
      while (j < steps.length && steps[j].kind === 'press' && steps[j].page === s.page && steps[j].locator === s.locator && typedChar(steps[j].value) !== null) {
        typed += typedChar(steps[j].value);
        if (j > i) edits.set(steps[j].line, null);
        j++;
      }
      values.add(typed);
      edit(s, `await ${pg}.${s.locator}.fill(${env(s.locator, typed)});`, { kind: 'fill', value: MASK, text: stepText('fill', s.locator, MASK) });
      i = j - 1;
      continue;
    } else if (s.kind === 'expect' && sensitive && s.value !== null) {
      const matcher = /^await expect\(page\d*\..+?\)\.(to[A-Z]\w*)\(/.exec(s.code)?.[1] ?? 'toHaveValue';
      values.add(s.value);
      edit(s, `await expect(${pg}.${s.locator}).${matcher}(${env(s.locator, s.value)});`, { value: MASK });
      continue;
    } else if (s.kind === 'setInputFiles' && s.value) {
      const base = s.value.split(/[\\/]/).pop();
      if (base !== s.value) {
        edit(s, `await ${pg}.${s.locator}.setInputFiles('${base.replace(/['\\]/g, '\\$&')}');`, { value: base, text: stepText('setInputFiles', s.locator, base) });
        continue;
      }
    }
    out.push(s);
  }

  // lưới an toàn: giá trị bí mật còn sót ở dòng khác (vd getByText('S3cr3t!')), cả dạng đã escape, cũng bị che
  const known = [...new Set([...values].filter((v) => v.length >= MIN_SCRUB).flatMap(forms))].sort((a, b) => b.length - a.length);
  const scrub = (v) => (typeof v === 'string' ? known.reduce((acc, secret) => acc.split(secret).join(MASK), v) : v);
  const spec = scrub(lines.flatMap((l, i) => (edits.has(i) ? (edits.get(i) === null ? [] : [edits.get(i)]) : [l])).join('\n'));
  return {
    spec,
    steps: out.map((s) => ({ ...s, code: scrub(s.code), text: scrub(s.text), value: scrub(s.value) })),
    secrets: [...envOf.values()],
  };
}
