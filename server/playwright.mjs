// Chạy thẳng file test Playwright (*.spec.ts, @playwright/test) của project, không cần chuyển sang *.e2e.ts:
// runner gọi `playwright test` của chính project (node_modules/@playwright/test), reporter JSON ghi ra file,
// rồi playwrightToReport đổi sang report-1 để lưu như một run e2e (đếm theo từng test case).
// Không có step agent / replay cache / token: các trang đó để trống cho run Playwright.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const sha = (s) => createHash('sha256').update(s).digest('hex');

// tests: danh sách "file" hoặc "file:line" (đã qua kiểm tra TEST của runner). File mã (.ts/.js…) không phải *.e2e.* → Playwright;
// thư mục / glob / *.e2e.ts → e2e như cũ; trộn hai loại thì không chạy được trong một lần (hai runner khác nhau).
export function runnerFor(tests) {
  if (!Array.isArray(tests) || !tests.length) return 'e2e';
  const pw = tests.map((t) => {
    const f = String(t).replace(/:\d+$/, '');
    return /\.[cm]?[jt]sx?$/.test(f) && !/\.e2e\.[cm]?[jt]sx?$/.test(f);
  });
  if (pw.every(Boolean)) return 'playwright';
  if (pw.some(Boolean)) return 'mixed';
  return 'e2e';
}

// CLI Playwright Test của project (giống resolveE2eBin: không bao giờ npx)
export function resolvePlaywrightBin(projectRoot) {
  try {
    const dir = join(projectRoot, 'node_modules', '@playwright', 'test');
    JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return join(dir, 'cli.js');
  } catch {
    return null;
  }
}

// cùng tuỳ chọn chạy với e2e, phần Playwright hiểu được; mọi giá trị đã được buildRunArgs kiểm tra trước.
// targets = tên project Playwright (targetId của run Playwright); 'web' là test không thuộc project nào → không lọc.
// grepInvertPw: mẫu cách ly dạng Playwright (quarantineFlags().pw: tên file + tiêu đề, một regex)
export function playwrightArgs({ tests = [], targets = [], grepInvertPw = null, retries, repeatEach, workers, grep, headed, maxFailures, shard } = {}) {
  const args = ['test', ...tests, '--reporter=line,json'];
  for (const t of targets.filter((x) => x !== 'web')) args.push('--project', t);
  if (typeof grepInvertPw === 'string' && grepInvertPw) args.push('--grep-invert', grepInvertPw);
  if (retries !== undefined) args.push('--retries', String(retries));
  if (repeatEach !== undefined) args.push('--repeat-each', String(repeatEach));
  if (workers !== undefined) args.push('--workers', String(workers));
  if (grep !== undefined) args.push('--grep', grep);
  if (maxFailures !== undefined) args.push('--max-failures', String(maxFailures));
  if (shard !== undefined) args.push('--shard', shard);
  if (headed) args.push('--headed');
  return args;
}

// reporter JSON ghi ra đây (PLAYWRIGHT_JSON_OUTPUT_FILE), không ra stdout: stdout là luồng Live
export const playwrightJsonPath = (projectRoot) => join(projectRoot, '.e2e-dashboard', 'runtime', 'playwright-report.json');

const ATTEMPT = { passed: 'passed', failed: 'failed', timedOut: 'failed', skipped: 'skipped', interrupted: 'interrupted' };
const stripAnsi = (s) => String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '');

// steps lồng nhau → danh sách phẳng (hook / fixture cũng là step, như trang chi tiết test của Playwright)
const flatSteps = (steps = [], out = []) => {
  for (const s of steps) {
    out.push({ api: 'step', label: String(s.title ?? '').slice(0, 300), status: s.error ? 'failed' : 'passed', durationMs: s.duration ?? 0 });
    flatSteps(s.steps, out);
  }
  return out;
};

// JSON reporter (JSONReport của @playwright/test) → report-1. spec.file tương đối với config.rootDir, không phải project:
// đổi về tương đối với project để cây Tests và "Chạy lại" dùng đúng đường dẫn.
export function playwrightToReport(json, projectRoot) {
  if (!json || !Array.isArray(json.suites)) throw new Error('Không phải report JSON của Playwright');
  const rootDir = json.config?.rootDir ?? projectRoot;
  const rel = (f) => relative(projectRoot, resolve(rootDir, f)).split('\\').join('/');
  const results = [];
  const walk = (suite, titles) => {
    // suite cấp file có title = tên file: không đưa vào titlePath
    const path = suite.title && suite.title !== suite.file ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const file = rel(spec.file ?? suite.file);
        const titlePath = [...path, spec.title];
        const testId = `${file}::${encodeURIComponent(titlePath.join(' > '))}`; // = junitToReport: cùng khoá lịch sử
        const targetId = t.projectName || 'web';
        const id = sha(`${testId}\0${targetId}\0${results.length}`);
        const attempts = (t.results ?? []).map((r, i) => {
          const status = ATTEMPT[r.status] ?? 'failed';
          const msg = stripAnsi(r.error?.message ?? r.errors?.[0]?.message ?? '');
          return {
            id: `${id}:${i}`, index: i, status, startedAt: r.startTime ?? json.stats?.startTime, durationMs: r.duration ?? 0,
            steps: flatSteps(r.steps), artifacts: [],
            ...(status === 'failed' ? { error: { code: r.status === 'timedOut' ? 'TIMEOUT' : 'ASSERTION', category: 'test', message: msg.slice(0, 2000) || r.status, ...(r.error?.stack ? { details: { observed: stripAnsi(r.error.stack).slice(0, 4000) } } : {}) } } : {}),
            ...(status === 'skipped' ? { skip: { reason: t.annotations?.find((a) => a.type === 'skip')?.description ?? '' } } : {}),
          };
        });
        const last = attempts.at(-1)?.status;
        const status = t.status === 'flaky' ? 'flaky' : t.status === 'skipped' || last === 'skipped' ? 'skipped' : t.status === 'expected' ? 'passed' : last === 'interrupted' ? 'interrupted' : 'failed';
        results.push({
          id, testId, kind: 'test', tags: (spec.tags ?? []).map((x) => String(x).replace(/^@/, '')), declarationIndex: results.length, titlePath, file,
          source: { file, line: spec.line ?? 1, column: spec.column ?? 1 }, targetId, platform: 'web', agent: 'default', repeat: 0, selected: true, status, attempts,
        });
      }
    }
    for (const s of suite.suites ?? []) walk(s, path);
  };
  for (const s of json.suites) walk(s, []);
  const errors = (json.errors ?? []).map((e) => ({ code: 'ERROR', category: 'infrastructure', message: stripAnsi(e.message).slice(0, 1000) }));
  if (!results.length && !errors.length) throw new Error('Playwright không chạy test nào');
  const count = (s) => results.filter((r) => r.status === s).length;
  const summary = { discovered: results.length, selected: results.length, executed: results.length - count('skipped'), passed: count('passed'), failed: count('failed'), interrupted: count('interrupted'), flaky: count('flaky'), skipped: count('skipped') };
  const failed = summary.failed > 0 || summary.interrupted > 0 || errors.length > 0;
  const startedAt = json.stats?.startTime ?? new Date().toISOString();
  const targets = [...new Set(results.map((r) => r.targetId))].map((id, index) => ({ id, index, platform: 'web' }));
  return {
    schemaVersion: 'report-1',
    run: {
      id: randomUUID(), runner: { name: 'playwright', version: json.config?.version ?? '' }, status: failed ? 'failed' : 'passed', exitCode: failed ? 1 : 0,
      startedAt, finishedAt: new Date(Date.parse(startedAt) + (json.stats?.duration ?? 0)).toISOString(),
      targets, serialGroups: [], results, errors, summary, imported: 'playwright',
    },
  };
}
