// Quét source của app (repo frontend, cấu hình ở "coverage.source") để tìm:
// - route: path literal trong router, href/to/navigate → bổ sung cho coverage theo cấu trúc file
// - domain: host trong URL của code (API, storage, Sentry…), bỏ danh sách nhiễu (w3.org, docs…)
import { readdir, readFile, lstat } from 'node:fs/promises';
import { join, relative, sep, extname } from 'node:path';

const CODE_EXT = new Set(['.tsx', '.jsx', '.ts', '.js', '.mjs', '.cjs', '.vue', '.svelte', '.astro', '.html']);
const SKIP_DIR = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage', '.turbo', '.svelte-kit', 'generated', 'gql', 'docs', '.e2e', '.e2e-dashboard']);

// Host không phải dịch vụ của app: tài liệu, thư viện, chuẩn. Có thể thêm trong "coverage.domainIgnore".
export const DEFAULT_DOMAIN_IGNORE = [
  'w3.org', 'apollographql.com', 'github.com', 'stackoverflow.com', 'quilljs.com', 'goo.gl', 'reactjs.org', 'react.dev',
  'mui.com', 'ant.design', 'mozilla.org', 'schema.org', 'npmjs.com', 'tailwindcss.com', 'example.com', 'localhost',
  'react-hook-form.com', 'reactrouter.com', 'remix.run', 'typescriptlang.org', 'vitejs.dev',
];

const ROUTE_LITERAL = [
  /\bpath\s*:\s*['"`](\/[^'"`\s]*)['"`]/g, // { path: '/reports' }
  /<Route\b[^>]*\bpath\s*=\s*\{?\s*['"`](\/[^'"`\s]*)['"`]/g, // <Route path="/x" />
  /\b(?:href|to)\s*=\s*\{?\s*['"`](\/[^'"`\s]*)['"`]/g, // href="/x", to={'/x'}
  /\b(?:navigate|push|replace)\(\s*['"`](\/[^'"`\s]*)['"`]/g, // navigate('/x')
];
const HOST = /\bhttps?:\/\/((?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?(?=[/'"`\s)]|$)/gi;

// Bỏ comment kiểu // và /* */ đơn giản để route đã bị comment (vd. "// path: '/reports/x'") không bị tính
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
}

// "/x?y=1" và "/x#a" → "/x"; literal có ${…} hoặc đuôi file (asset) thì bỏ
export function cleanPath(p) {
  const s = String(p).split(/[?#]/)[0];
  // chỉ path kiểu URL: chữ, số, - _ . : / (regex literal như /<[^>]*>/g hay chuỗi có ${…} bị loại)
  if (!/^\/[A-Za-z0-9\-_.:/]*$/.test(s) || /\.[a-z0-9]{2,5}$/i.test(s) || s.startsWith('/api/')) return null;
  return s;
}

export function isIgnoredHost(host, ignore = DEFAULT_DOMAIN_IGNORE) {
  return ignore.some((d) => host === d || host.endsWith(`.${d}`));
}

async function walk(dir, visit, depth = 0) {
  if (depth > 12) return;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isSymbolicLink() || SKIP_DIR.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, visit, depth + 1);
    else if (e.isFile() && CODE_EXT.has(extname(e.name))) await visit(p);
  }
}

// root: thư mục repo app (cấu hình "coverage.source"). Quét src/ nếu có, không thì cả root.
export async function scanSource(root, { ignore = [] } = {}) {
  const base = (await lstat(join(root, 'src')).catch(() => null))?.isDirectory() ? join(root, 'src') : root;
  if (!(await lstat(base).catch(() => null))?.isDirectory()) return { routes: new Map(), domains: [], files: 0 };
  const ignoreAll = [...DEFAULT_DOMAIN_IGNORE, ...ignore.filter((x) => typeof x === 'string')];
  const routes = new Map();
  const hosts = new Map();
  let files = 0;
  await walk(base, async (p) => {
    const src = stripComments(await readFile(p, 'utf8').catch(() => '')).slice(0, 1_000_000);
    files++;
    const rel = relative(root, p).split(sep).join('/');
    for (const rx of ROUTE_LITERAL) {
      for (const m of src.matchAll(rx)) {
        const r = cleanPath(m[1]);
        if (r && !routes.has(r)) routes.set(r, rel);
      }
    }
    for (const m of src.matchAll(HOST)) {
      const host = m[1].toLowerCase();
      if (isIgnoredHost(host, ignoreAll)) continue;
      const h = hosts.get(host) ?? { host, count: 0, sample: rel };
      h.count++;
      hosts.set(host, h);
    }
  });
  const domains = [...hosts.values()].sort((a, b) => b.count - a.count || a.host.localeCompare(b.host));
  return { routes, domains, files };
}
