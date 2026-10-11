// Tests affected by the current change: what `git diff` against a base touches, matched to tests
// by their own file, the routes they visit and the words of their titles.
import { execFile } from 'node:child_process';
import { basename, extname } from 'node:path';
import { testKey } from './analytics.mjs';
import { normalizeRoute } from './analytics.mjs';
import { resultAttempts } from '../reporter/e2e-dashboard.reporter.mjs';

const REF = /^(?!-)[\w./@^~-]{1,100}$/;
const git = (cwd, args) => new Promise((ok) => execFile('git', args, { cwd, timeout: 10_000 }, (err, out) => ok(err ? null : String(out))));

// Changed files: committed since the merge base with `base`, plus staged, unstaged and untracked ones.
export async function changedFiles(root, base = 'main') {
  if (!REF.test(base)) throw new Error('invalid base');
  const committed = await git(root, ['diff', '--name-only', `${base}...HEAD`]);
  const local = await git(root, ['diff', '--name-only', 'HEAD']);
  const untracked = await git(root, ['ls-files', '--others', '--exclude-standard']);
  if (committed === null && local === null) return null;
  return [...new Set([committed, local, untracked].filter(Boolean).flatMap((o) => o.split('\n')).map((s) => s.trim()).filter(Boolean))].slice(0, 2000);
}

const STOP = new Set(['src', 'app', 'apps', 'lib', 'components', 'component', 'pages', 'page', 'index', 'main', 'utils', 'util', 'common', 'shared', 'test', 'tests', 'spec', 'e2e', 'api', 'routes', 'route', 'view', 'views', 'layout', 'styles', 'style', 'public', 'assets', 'packages', 'package', 'types', 'hooks', 'store', 'server', 'client', 'web']);

// Words that name a feature: "src/routes/checkout/PaymentForm.tsx" → checkout, payment, form.
export function featureWords(file) {
  return [...new Set(String(file)
    .replace(extname(file), '')
    .split(/[\\/._\-[\]()]+/)
    .flatMap((p) => p.split(/(?<=[a-z])(?=[A-Z])/))
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)))];
}

export function impactedTests(history, files) {
  const tests = new Map();
  for (const { report } of history.slice(0, 10)) {
    for (const r of report?.run?.results ?? []) {
      if (!r || r.kind === 'setup' || tests.has(testKey(r))) continue;
      const routes = new Set();
      for (const a of resultAttempts(report, r)) for (const s of a.steps ?? []) {
        for (const e of s.events ?? []) if (e.kind === 'navigation') routes.add(normalizeRoute(e.detail));
        if (s.screen?.location) routes.add(normalizeRoute(s.screen.location));
      }
      const t = Array.isArray(r.titlePath) ? r.titlePath.join(' › ') : String(r.testId);
      tests.set(testKey(r), { key: testKey(r), title: t, file: r.source?.file ?? r.file, line: r.source?.line ?? null, target: r.targetId, agent: r.agent ?? 'default', routes: [...routes].filter(Boolean), words: new Set(t.toLowerCase().split(/[^a-z0-9à-ỹ]+/i).filter((w) => w.length >= 3)) });
    }
  }
  const out = [];
  const words = new Map(files.map((f) => [f, featureWords(f)]));
  for (const t of tests.values()) {
    const reasons = [];
    for (const f of files) {
      if (f === t.file) {
        reasons.push(`sửa chính file test ${basename(f)}`);
        continue;
      }
      const fw = words.get(f);
      const route = t.routes.find((r) => r.split('/').some((seg) => seg.length >= 3 && fw.includes(seg.toLowerCase())));
      if (route) reasons.push(`${basename(f)} ↔ route ${route}`);
      else {
        const w = fw.find((x) => t.words.has(x));
        if (w) reasons.push(`${basename(f)} ↔ tên test "${w}"`);
      }
    }
    if (reasons.length) out.push({ key: t.key, title: t.title, file: t.file, line: t.line, target: t.target, agent: t.agent, reasons: [...new Set(reasons)].slice(0, 5), direct: reasons.some((r) => r.startsWith('sửa chính')) });
  }
  return out.sort((a, b) => b.direct - a.direct || b.reasons.length - a.reasons.length);
}
