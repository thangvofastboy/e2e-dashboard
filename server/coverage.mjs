// Pages of the app no e2e test reaches: the app's routes (Next.js app/ and pages/, sitemap.xml,
// route paths in router code) against the routes tests navigated through (analytics.routeMap).
import { readdir, readFile, lstat } from 'node:fs/promises';
import { join, relative, sep, extname } from 'node:path';
import { normalizeRoute } from './analytics.mjs';

const PAGE_EXT = new Set(['.tsx', '.jsx', '.ts', '.js', '.mdx', '.vue', '.svelte', '.astro']);
const SKIP_DIR = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', '.e2e', '.e2e-dashboard', 'coverage', '.turbo', '.svelte-kit']);

async function walk(dir, visit, depth = 0) {
  if (depth > 12) return;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isSymbolicLink() || SKIP_DIR.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, visit, depth + 1);
    else if (e.isFile()) await visit(p);
  }
}

// app/(shop)/products/[id]/page.tsx → /products/:id ; pages/blog/[...slug].tsx → /blog/:id
export function fileRoute(rel, kind) {
  const parts = rel.split(/[\\/]/);
  const file = parts.pop();
  const name = file.slice(0, -extname(file).length);
  if (kind === 'app') {
    if (name !== 'page') return null;
  } else if (kind === 'pages') {
    if (name.startsWith('_') || parts[0] === 'api') return null;
    if (name !== 'index') parts.push(name);
  } else if (kind === 'routes') {
    // SvelteKit +page, Nuxt/Vue pages-like folders
    if (name !== '+page' && name !== 'index') parts.push(name);
  }
  const segs = parts
    .filter((p) => !/^\(.*\)$/.test(p) && !p.startsWith('@') && !p.startsWith('_'))
    .map((p) => (/^\[.*\]$/.test(p) || /^\$/.test(p) || /^:/.test(p) ? ':id' : p.toLowerCase()));
  return `/${segs.join('/')}`.replace(/\/+$/, '') || '/';
}

const ROUTER_PATH = /(?:\bpath\s*:\s*|<Route\b[^>]*\bpath\s*=\s*\{?)\s*['"`](\/[^'"`]*)['"`]/g;

export async function appRoutes(root, extra = []) {
  const found = new Map();
  const add = (route, source) => {
    const r = normalizeRoute(route.replace(/:\w+/g, '1').replace(/\*$/, ''));
    if (r && !found.has(r)) found.set(r, source);
  };
  for (const [base, kind] of [['app', 'app'], ['src/app', 'app'], ['pages', 'pages'], ['src/pages', 'pages'], ['src/routes', 'routes']]) {
    const dir = join(root, base);
    if (!(await lstat(dir).catch(() => null))?.isDirectory()) continue;
    await walk(dir, async (p) => {
      if (!PAGE_EXT.has(extname(p))) return;
      const r = fileRoute(relative(dir, p).split(sep).join('/'), kind);
      if (r) add(r, `${base}/${relative(dir, p).split(sep).join('/')}`);
    });
  }
  for (const s of ['public/sitemap.xml', 'sitemap.xml', 'static/sitemap.xml']) {
    const xml = await readFile(join(root, s), 'utf8').catch(() => '');
    for (const m of xml.slice(0, 2_000_000).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) add(m[1], s);
  }
  if (!found.size) {
    // no file-based routes: look for router path literals in the source
    await walk(join(root, 'src'), async (p) => {
      if (!PAGE_EXT.has(extname(p)) || found.size > 500) return;
      const src = await readFile(p, 'utf8').catch(() => '');
      for (const m of src.slice(0, 500_000).matchAll(ROUTER_PATH)) add(m[1], relative(root, p).split(sep).join('/'));
    });
  }
  for (const r of extra) if (typeof r === 'string' && r.startsWith('/')) add(r, 'config');
  return found;
}

// "/blog/:id" matches a visited "/blog/hello-world": the route map only folds numeric/hex ids into :id
const routeRx = (route) => new RegExp(`^${route.split('/').map((seg) => (/^[:[]/.test(seg) || seg === '*' ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/')}$`);

export function coverageGaps(routes, map, { ignore = [] } = {}) {
  const ign = ignore.filter((x) => typeof x === 'string').map((x) => normalizeRoute(x));
  const matched = new Set();
  const rows = [...routes].map(([route, source]) => {
    const rx = routeRx(route);
    const hits = map.nodes.filter((n) => n.route === route || (!routes.has(n.route) && rx.test(n.route)));
    hits.forEach((n) => matched.add(n.route));
    const sum = (k) => hits.reduce((s, n) => s + (n[k] ?? 0), 0);
    return { route, source, tested: hits.length > 0, visits: sum('visits'), tests: sum('tests'), failures: sum('failures') };
  }).filter((r) => !ign.includes(r.route));
  const covered = rows.filter((r) => r.tested).length;
  return { total: rows.length, covered, share: rows.length ? covered / rows.length : null, untested: rows.filter((r) => !r.tested), rows: rows.sort((a, b) => a.tested - b.tested || a.route.localeCompare(b.route)), extraTested: map.nodes.filter((n) => !matched.has(n.route)).map((n) => n.route) };
}
