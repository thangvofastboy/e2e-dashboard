# e2e-dashboard M1a (Thu thập & xem) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plugin Claude Code `/e2e-dashboard` mở dashboard local hiển thị live + lịch sử + chi tiết debug các run của framework e2e (tester-army/e2e), xuất được HTML tĩnh.

**Architecture:** Một file reporter tự chứa (`reporter/e2e-dashboard.reporter.mjs`) vừa là e2e Reporter vừa export `archive()`; hook Claude Code, watcher của server và reporter cùng gọi `archive()` để lưu run vào `<project>/.e2e-dashboard/runs/`. Server Node thuần (`node:http`) phục vụ REST + SSE + UI. UI là ES module thuần, được "bundle" bằng một hàm nối file nhỏ để vừa phục vụ server vừa nhúng vào HTML export.

**Tech Stack:** Node ≥ 20 (chỉ `node:*`), `node --test`, HTML/CSS/JS thuần, SVG tự vẽ. 0 dependency npm, không bước build.

**Spec:** `docs/superpowers/specs/2026-10-10-e2e-dashboard-m1-design.md` (phần M1a, mục 10)

## Global Constraints

- 0 dependency npm; chỉ import `node:*` ở server/bin/reporter; UI không tải CDN.
- Reporter file chỉ import `node:*` (nó được copy vào project người dùng).
- Server bind `127.0.0.1`; mọi request (GET lẫn POST) cần token (cookie `HttpOnly; SameSite=Strict; Path=/` hoặc header `X-E2E-Dashboard-Token`); POST có `Origin` phải là chính server.
- Thư mục dữ liệu: `<project>/.e2e-dashboard/` (`config.json`, `server.json`, `runs/<startedAt>_<runId>/`, `exports/`).
- Report chỉ nhận `schemaVersion === 'report-1'`.
- Retention mặc định 50 run, không tính run `pinned`.
- Port mặc định 4477, bận thì thử tới 4497.
- Reporter tắt khi biến môi trường `CI` được set; không bao giờ throw.
- Hook luôn exit 0.
- Ngôn ngữ UI: tiếng Việt.

## Review Focus

1. **Config chưa có `reporters`**: `setup` thêm reporter mà quên `'list'` sẽ làm mất toàn bộ output terminal của e2e (doc: "A config with only reporter objects has no built-in terminal output"). Phải chèn `reporters: ['list', dashboardReporter]`. Test ở Task 10 (`patchConfig keeps list output…`).
2. **Test thuộc serial group**: `results[i].attempts` có thể rỗng, attempt thật nằm ở `run.serialGroups[].attempts[].members[]` theo `testId`. Timeline/trạng thái không được trống. Test ở Task 11 (`flattenResults rebuilds serial-group attempts`).
3. **Đường dẫn artifact chứa `..` hoặc tuyệt đối** (report bị sửa tay / hỏng): archive và `/files` không được đọc/ghi ra ngoài thư mục run. Test ở Task 3 (`artifact paths escaping…`) và Task 8 (`files … never escape the run dir`).
4. **`report.json` đang ghi dở khi watcher đọc**: JSON.parse lỗi phải bị bỏ qua (thử lại sau), không crash server, không archive rác. Test ở Task 3 (`half-written report`) và Task 9 (`ignoring a half-written file first`).
5. **Run bị ngắt (Ctrl-C) / `run.status = 'interrupted'`, không có `finishedAt`**: archive và UI vẫn hiển thị (thời lượng "—"). Test ở Task 2 (`interrupted run…`) và Task 11 (`fmtDuration(null)`).

Ngoài ra, nội dung lấy từ app (lỗi, reasoning, log, tên branch) là dữ liệu không tin cậy: mọi chỗ render đều qua `escapeHtml`/`renderMarkdown` (Task 11–12), artifact HTML/SVG được phục vụ dạng text + `CSP: sandbox` (Task 8), JSON nhúng trong export qua `embedJson` (Task 16).

---

## File Structure

```
package.json                         type:module, script test                                  (Task 1)
.claude-plugin/plugin.json           manifest plugin                                           (Task 1)
.claude-plugin/marketplace.json      marketplace 1 plugin, source "./"                         (Task 1)
reporter/e2e-dashboard.reporter.mjs  VERSION, summarize, safeJoin, readConfig, archive,
                                     applyRetention, readServerInfo, createReporter, default   (Task 2–4)
bin/project.mjs                      findConfig, findProjectRoot                               (Task 5)
bin/archive.mjs                      hook entry: đọc stdin JSON, gọi archive                   (Task 5)
hooks/hooks.json                     PostToolUse Bash → bin/archive.mjs                        (Task 5)
server/store.mjs                     listRuns, findRunDir, getRun, setFlag, testHistory        (Task 6)
server/live.mjs                      createLive, estimateEta                                   (Task 7)
ui/bundle.mjs                        bundleUi(uiDir) → string                                  (Task 8)
server/app.mjs                       createApp(): auth, API, files (Range), UI, SSE            (Task 8, 16)
server/watch.mjs                     watchReport, outputFromArtifactsRoot                      (Task 9)
server/main.mjs                      startServer: port, server.json, watcher                   (Task 9)
bin/dashboard.mjs                    start | setup | export | stop | status                    (Task 10, 16)
commands/e2e-dashboard.md            lệnh /e2e-dashboard                                       (Task 10)
ui/format.js, ui/model.js            định dạng, view model của report                          (Task 11)
ui/markdown.js, ui/charts.js         markdown an toàn, chart SVG                               (Task 12)
ui/api.js, ui/router.js              fetch/SSE/export data, hash routing                       (Task 13)
ui/index.html, ui/style.css, ui/app.js   shell, layout, tokens light/dark                      (Task 8, 13–16)
ui/views/overview.js                 Overview + Runs                                           (Task 13)
ui/views/run.js                      Run detail                                                (Task 14, 16)
ui/views/live.js, ui/views/tests.js  Live + Tests                                              (Task 15)
server/export.mjs                    buildExportHtml, exportRun, embedJson                     (Task 16)
README.md                                                                                       (Task 17)
test/*.test.mjs, test/seed-demo.mjs, test/fixtures/report-v1.valid.json, test/fixtures/NOTICE
```

---

### Task 1: Scaffold plugin + fixture + test runner

**Files:**
- Create: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `test/fixtures/report-v1.valid.json`, `test/fixtures/NOTICE`, `test/manifest.test.mjs`

**Interfaces:**
- Produces: `npm test` chạy `node --test test/*.test.mjs` (chỉ file `*.test.mjs`, để `test/seed-demo.mjs` không bị chạy như test); fixture `test/fixtures/report-v1.valid.json` (report-1 hợp lệ: 1 result `failed` có attempt + artifact video `path` và video `url`, 1 result `skipped`, `run.status: "failed"`).

- [ ] **Step 1: Viết test manifest**

`test/manifest.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const json = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));

test('plugin manifest names the plugin e2e-dashboard', () => {
  assert.equal(json('.claude-plugin/plugin.json').name, 'e2e-dashboard');
});

test('marketplace lists the plugin from repo root', () => {
  const m = json('.claude-plugin/marketplace.json');
  assert.equal(m.plugins[0].name, 'e2e-dashboard');
  assert.equal(m.plugins[0].source, './');
});

test('fixture is a report-1 document', () => {
  assert.equal(json('test/fixtures/report-v1.valid.json').schemaVersion, 'report-1');
});
```

- [ ] **Step 2: Chạy, xác nhận fail**

Run: `node --test test/manifest.test.mjs`
Expected: FAIL (ENOENT `.claude-plugin/plugin.json`)

- [ ] **Step 3: Tạo các file**

`package.json`:
```json
{
  "name": "e2e-dashboard",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": { "test": "node --test test/*.test.mjs" }
}
```

`.claude-plugin/plugin.json`:
```json
{
  "name": "e2e-dashboard",
  "version": "0.1.0",
  "description": "/e2e-dashboard: live, history and debugging dashboard for e2e (tester-army/e2e) test runs",
  "author": { "name": "thangvofastboy" }
}
```

`.claude-plugin/marketplace.json`:
```json
{
  "name": "e2e-dashboard",
  "owner": { "name": "thangvofastboy" },
  "description": "Dashboard for e2e (tester-army/e2e) test runs",
  "plugins": [
    { "name": "e2e-dashboard", "source": "./", "description": "/e2e-dashboard: live, history and debugging dashboard for e2e test runs" }
  ]
}
```

Fixture: tải nguyên văn từ repo e2e:
```bash
mkdir -p test/fixtures
gh api repos/tester-army/e2e/contents/packages/e2e/schema/fixtures/report-v1.valid.json --jq .content | base64 -d > test/fixtures/report-v1.valid.json
```

`test/fixtures/NOTICE`:
```
report-v1.valid.json is copied from https://github.com/tester-army/e2e
(packages/e2e/schema/fixtures/report-v1.valid.json), licensed Apache-2.0.
```

- [ ] **Step 4: Chạy, xác nhận pass**

Run: `npm test`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json test/fixtures/report-v1.valid.json test/fixtures/NOTICE test/manifest.test.mjs
git commit -m "chore: scaffold e2e-dashboard plugin and test fixture"
```

---

### Task 2: `summarize()` — meta của một run

**Files:**
- Create: `reporter/e2e-dashboard.reporter.mjs` (phần đầu)
- Test: `test/summarize.test.mjs`

**Interfaces:**
- Produces:
  - `export const VERSION = '0.1.0'`
  - `export const DATA_DIR = '.e2e-dashboard'`
  - `export function summarize(report, { source, rerunOf = null, git = null }) → Meta`
  - `Meta = { runId, startedAt, finishedAt|null, durationMs|null, status, exitCode, kind:'run'|'explore', summary, tokens:{input,output}, modelCalls, costUsd|null, replay:{replayed,total}, targets:string[], git:{branch|null,commit|null,dirty|null}|null, source, rerunOf, pinned:false, baseline:false, schemaVersion, reporterVersion }`
  - `export function runDirName(report) → string` (`<startedAt với : và . thay bằng ->_<runId>`)

- [ ] **Step 1: Viết test**

`test/summarize.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarize, runDirName } from '../reporter/e2e-dashboard.reporter.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));

test('summarize counts tokens, model calls and replay across all steps', () => {
  const m = summarize(fixture(), { source: 'hook' });
  assert.equal(m.runId, '018f0f5c-7b2a-7abc-8abc-0123456789ab');
  assert.equal(m.status, 'failed');
  assert.equal(m.kind, 'run');
  assert.equal(m.durationMs, 1000);
  assert.deepEqual(m.summary, fixture().run.summary);
  assert.ok(m.tokens.input > 0 && m.tokens.output > 0);
  assert.ok(m.modelCalls >= 1);
  assert.ok(m.replay.total >= m.replay.replayed);
  assert.deepEqual(m.targets, ['web']);
  assert.equal(m.source, 'hook');
  assert.equal(m.pinned, false);
});

test('summarize prefers run.vcs over the git fallback', () => {
  const r = fixture();
  r.run.vcs = { commit: 'a'.repeat(40), branch: 'main', dirty: true };
  const m = summarize(r, { source: 'hook', git: { commit: 'b'.repeat(40), branch: 'x', dirty: false } });
  assert.deepEqual(m.git, { commit: 'a'.repeat(40), branch: 'main', dirty: true });
});

test('interrupted run without finishedAt has null duration', () => {
  const r = fixture();
  r.run.status = 'interrupted';
  delete r.run.finishedAt;
  const m = summarize(r, { source: 'watcher' });
  assert.equal(m.finishedAt, null);
  assert.equal(m.durationMs, null);
  assert.equal(m.status, 'interrupted');
});

test('explore runs are marked as explore', () => {
  const r = fixture();
  r.run.explore = { goal: 'x' };
  assert.equal(summarize(r, { source: 'hook' }).kind, 'explore');
});

test('runDirName is filesystem safe and ends with the run id', () => {
  assert.equal(runDirName(fixture()), '2026-07-24T12-00-00-000Z_018f0f5c-7b2a-7abc-8abc-0123456789ab');
});
```

- [ ] **Step 2: Chạy, xác nhận fail**

Run: `node --test test/summarize.test.mjs`
Expected: FAIL (cannot find module)

- [ ] **Step 3: Implement**

`reporter/e2e-dashboard.reporter.mjs`:
```js
// e2e-dashboard reporter. Self-contained: imports only node:* so it can be copied into any e2e project.
// Exported archive() is also used by the e2e-dashboard plugin (hook + server).
import { mkdir, readFile, writeFile, copyFile, rename, rm, readdir, stat } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const VERSION = '0.1.0';
export const DATA_DIR = '.e2e-dashboard';

function allSteps(report) {
  const out = [];
  for (const r of report.run.results ?? []) for (const a of r.attempts ?? []) out.push(...(a.steps ?? []));
  for (const g of report.run.serialGroups ?? [])
    for (const a of g.attempts ?? []) for (const m of a.members ?? []) out.push(...(m.steps ?? []));
  return out;
}

export function summarize(report, { source, rerunOf = null, git = null }) {
  const run = report.run;
  const tokens = { input: 0, output: 0 };
  let modelCalls = 0;
  const replay = { replayed: 0, total: 0 };
  for (const s of allSteps(report)) {
    modelCalls += s.metrics?.modelCalls ?? 0;
    if (s.cache) {
      replay.replayed += s.cache.replayedActions ?? 0;
      replay.total += s.cache.totalActions ?? 0;
    }
    for (const e of s.events ?? []) {
      if (e.kind !== 'model') continue;
      tokens.input += e.inputTokens ?? 0;
      tokens.output += e.outputTokens ?? 0;
    }
  }
  const finishedAt = run.finishedAt ?? null;
  return {
    runId: run.id,
    startedAt: run.startedAt,
    finishedAt,
    durationMs: finishedAt ? Date.parse(finishedAt) - Date.parse(run.startedAt) : null,
    status: run.status,
    exitCode: run.exitCode ?? null,
    kind: run.explore ? 'explore' : 'run',
    summary: run.summary,
    tokens,
    modelCalls,
    costUsd: run.usage?.estimatedCostUsd ?? null,
    replay,
    targets: (run.targets ?? []).map((t) => t.id),
    git: run.vcs
      ? { commit: run.vcs.commit, branch: run.vcs.branch ?? null, dirty: run.vcs.dirty ?? null }
      : git,
    source,
    rerunOf,
    pinned: false,
    baseline: false,
    schemaVersion: report.schemaVersion,
    reporterVersion: VERSION,
  };
}

export function runDirName(report) {
  return `${report.run.startedAt.replace(/[:.]/g, '-')}_${report.run.id}`;
}
```

- [ ] **Step 4: Chạy, xác nhận pass**

Run: `node --test test/summarize.test.mjs`
Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
git add reporter/e2e-dashboard.reporter.mjs test/summarize.test.mjs
git commit -m "feat(reporter): summarize a report-1 run into meta"
```

---

### Task 3: `archive()` + retention

**Files:**
- Modify: `reporter/e2e-dashboard.reporter.mjs` (thêm vào cuối)
- Test: `test/archive.test.mjs`

**Interfaces:**
- Consumes: `summarize`, `runDirName`, `DATA_DIR` (Task 2)
- Produces:
  - `export function safeJoin(root, rel) → string|null` (null nếu `rel` rỗng, tuyệt đối, hoặc thoát khỏi `root`)
  - `export function readConfig(projectRoot) → object` (`.e2e-dashboard/config.json`, `{}` nếu không có/hỏng)
  - `export async function archive(projectRoot, { source, rerunOf?, report?, reportPath?, artifactsRoot?, traces?, outputDir?, keep? }) → { status: 'archived'|'exists'|'skipped', runDir?, reason? }`
    - `reason`: `'no-report' | 'unreadable' | 'unsupported-schema'`
    - `traces`: `Map|object` resultId → đường dẫn (tương đối project root hoặc tuyệt đối)
  - `export async function applyRetention(projectRoot, keep = 50) → string[]` (tên thư mục đã xoá)
  - Thư mục run: `report.json`, `meta.json` (Meta + `traces: {resultId: 'traces/<resultId>.md'}`), `traces/`, `artifacts/<path gốc>`

- [ ] **Step 1: Viết test**

`test/archive.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { archive, applyRetention, safeJoin } from '../reporter/e2e-dashboard.reporter.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));
const VIDEO = 'web/tests_example.e2e.ts__opens_app/attempt-0/video/video.webm';

function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

// Project with .e2e/report.json, a video artifact and a trace page next to it.
function makeProject(mutate = (r) => r) {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  const report = mutate(fixture());
  put(root, '.e2e/report.json', JSON.stringify(report));
  put(root, `.e2e/results/${VIDEO}`, 'webm');
  put(root, '.e2e/results/web/tests_example.e2e.ts__opens_app/trace.md', '# trace');
  return { root, report };
}

const runs = (root) => readdirSync(join(root, '.e2e-dashboard/runs')).filter((n) => !n.startsWith('.'));
const failFirst = (r) => { r.run.results[0].status = 'failed'; return r; };

test('archives report from disk with artifacts and trace of non-passed results', async () => {
  const { root, report } = makeProject(failFirst);
  const res = await archive(root, { source: 'hook' });
  assert.equal(res.status, 'archived');
  const meta = JSON.parse(readFileSync(join(res.runDir, 'meta.json'), 'utf8'));
  assert.equal(meta.source, 'hook');
  assert.ok(existsSync(join(res.runDir, 'report.json')));
  assert.ok(existsSync(join(res.runDir, 'artifacts', VIDEO)));
  const id = report.run.results[0].id;
  assert.equal(meta.traces[id], `traces/${id}.md`);
  assert.equal(readFileSync(join(res.runDir, meta.traces[id]), 'utf8'), '# trace');
});

test('does not copy artifacts of passed results', async () => {
  const { root } = makeProject((r) => { r.run.results[1].attempts[0].artifacts = []; return r; });
  const res = await archive(root, { source: 'hook' });
  assert.equal(existsSync(join(res.runDir, 'artifacts', VIDEO)), false);
});

test('second archive of the same run is a no-op', async () => {
  const { root } = makeProject();
  await archive(root, { source: 'hook' });
  assert.equal((await archive(root, { source: 'watcher' })).status, 'exists');
  assert.equal(runs(root).length, 1);
});

test('concurrent archives of the same run produce one run directory', async () => {
  const { root } = makeProject();
  const results = await Promise.all([archive(root, { source: 'reporter' }), archive(root, { source: 'watcher' })]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['archived', 'exists']);
  assert.equal(runs(root).length, 1);
});

test('artifact paths escaping the artifacts root are ignored', async () => {
  const { root } = makeProject((r) => {
    failFirst(r);
    r.run.results[0].attempts[0].artifacts[0].path = '../../../outside.txt';
    return r;
  });
  put(root, 'outside.txt', 'secret');
  const res = await archive(root, { source: 'hook' });
  assert.equal(res.status, 'archived');
  assert.equal(existsSync(join(res.runDir, 'outside.txt')), false);
  assert.equal(safeJoin('/a/b', '../c'), null);
  assert.equal(safeJoin('/a/b', '/etc/passwd'), null);
  assert.equal(safeJoin('/a/b', 'c/d'), '/a/b/c/d');
});

test('unsupported schema and half-written report are skipped', async () => {
  const { root } = makeProject((r) => { r.schemaVersion = 'report-2'; return r; });
  assert.deepEqual(await archive(root, { source: 'hook' }), { status: 'skipped', reason: 'unsupported-schema' });
  writeFileSync(join(root, '.e2e/report.json'), '{"schemaVersion":"rep');
  assert.deepEqual(await archive(root, { source: 'hook' }), { status: 'skipped', reason: 'unreadable' });
  const empty = mkdtempSync(join(tmpdir(), 'e2ed-'));
  assert.deepEqual(await archive(empty, { source: 'hook' }), { status: 'skipped', reason: 'no-report' });
});

test('in-memory report archives even when reportPath is undefined', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  const res = await archive(root, { source: 'reporter', report: fixture(), reportPath: undefined });
  assert.equal(res.status, 'archived');
});

test('explicit traces map is used when given', async () => {
  const { root, report } = makeProject(failFirst);
  put(root, 'custom/trace.md', '# custom');
  const id = report.run.results[0].id;
  const res = await archive(root, { source: 'reporter', report, traces: new Map([[id, 'custom/trace.md']]) });
  assert.equal(readFileSync(join(res.runDir, `traces/${id}.md`), 'utf8'), '# custom');
});

test('retention keeps the newest N and every pinned run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  const dirs = [];
  for (let i = 0; i < 4; i++) {
    const r = fixture();
    r.run.id = `018f0f5c-7b2a-7abc-8abc-00000000000${i}`;
    r.run.startedAt = `2026-07-2${i}T12:00:00.000Z`;
    dirs.push((await archive(root, { source: 'hook', report: r, keep: 100 })).runDir);
  }
  const metaPath = join(dirs[0], 'meta.json');
  writeFileSync(metaPath, JSON.stringify({ ...JSON.parse(readFileSync(metaPath, 'utf8')), pinned: true }));
  const removed = await applyRetention(root, 2);
  assert.equal(removed.length, 1);
  assert.ok(removed[0].includes('00000000001'));
  assert.equal(runs(root).length, 3);
  assert.deepEqual(await applyRetention(root, 2), []);
});
```

- [ ] **Step 2: Chạy, xác nhận fail**

Run: `node --test test/archive.test.mjs`
Expected: FAIL (`archive` is not exported)

- [ ] **Step 3: Implement** (thêm vào cuối `reporter/e2e-dashboard.reporter.mjs`)

```js
export function safeJoin(root, rel) {
  if (typeof rel !== 'string' || rel === '' || isAbsolute(rel)) return null;
  const base = resolve(root);
  const p = resolve(base, rel);
  const r = relative(base, p);
  return r && !r.startsWith('..') && !isAbsolute(r) ? p : null;
}

export function readConfig(projectRoot) {
  try {
    return JSON.parse(readFileSync(join(projectRoot, DATA_DIR, 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}

function gitInfo(cwd) {
  try {
    const git = (args) =>
      execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
    return { commit: git(['rev-parse', 'HEAD']), branch: git(['rev-parse', '--abbrev-ref', 'HEAD']), dirty: git(['status', '--porcelain']) !== '' };
  } catch {
    return null;
  }
}

// Attempts (normal + serial group) whose result did not pass, with their attempt- and step-level artifacts.
function nonPassedArtifacts(report) {
  const out = [];
  const take = (a) => {
    out.push(...(a.artifacts ?? []));
    for (const s of a.steps ?? []) out.push(...(s.artifacts ?? []));
    for (const m of a.members ?? []) for (const s of m.steps ?? []) out.push(...(s.artifacts ?? []));
  };
  for (const r of report.run.results ?? []) if (r.status !== 'passed') (r.attempts ?? []).forEach(take);
  for (const g of report.run.serialGroups ?? []) if (g.status !== 'passed') (g.attempts ?? []).forEach(take);
  return out;
}

async function copyInto(srcRoot, dstRoot, rel) {
  const src = safeJoin(srcRoot, rel);
  const dst = safeJoin(dstRoot, rel);
  if (!src || !dst || !existsSync(src)) return false;
  await mkdir(dirname(dst), { recursive: true });
  await copyFile(src, dst);
  return true;
}

async function findFiles(dir, name, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await findFiles(p, name, out);
    else if (e.name === name) out.push(p);
  }
  return out;
}

// resultId -> absolute trace.md path. Without an explicit map, a trace belongs to the result
// whose artifact paths live under the trace's directory.
// ponytail: directory-prefix heuristic, verified against a real run in Task 12.
async function resolveTraces(projectRoot, report, artRoot, traces) {
  const map = new Map();
  if (traces) {
    for (const [id, p] of traces instanceof Map ? traces : Object.entries(traces)) map.set(id, resolve(projectRoot, p));
    return map;
  }
  const found = await findFiles(artRoot, 'trace.md');
  for (const r of report.run.results ?? []) {
    const paths = (r.attempts ?? []).flatMap((a) => (a.artifacts ?? []).map((x) => x.path).filter(Boolean));
    const hit = found.find((t) => {
      const dir = relative(artRoot, dirname(t)).split(sep).join('/');
      return paths.some((p) => p.startsWith(`${dir}/`));
    });
    if (hit) map.set(r.id, hit);
  }
  return map;
}

export async function archive(projectRoot, { source, rerunOf = null, report, reportPath, artifactsRoot, traces, outputDir, keep } = {}) {
  const cfg = readConfig(projectRoot);
  const output = resolve(projectRoot, outputDir ?? cfg.output ?? '.e2e');
  if (!report) {
    try {
      report = JSON.parse(await readFile(reportPath ?? join(output, 'report.json'), 'utf8'));
    } catch (e) {
      return { status: 'skipped', reason: e.code === 'ENOENT' ? 'no-report' : 'unreadable' };
    }
  }
  if (report?.schemaVersion !== 'report-1' || !report.run?.id) return { status: 'skipped', reason: 'unsupported-schema' };

  const runsDir = join(projectRoot, DATA_DIR, 'runs');
  await mkdir(runsDir, { recursive: true });
  const name = runDirName(report);
  const existing = (await readdir(runsDir)).find((d) => d.endsWith(`_${report.run.id}`));
  if (existing) return { status: 'exists', runDir: join(runsDir, existing) };

  const artRoot = resolve(projectRoot, artifactsRoot ?? join(output, 'results'));
  const tmp = join(runsDir, `.tmp-${randomBytes(6).toString('hex')}`);
  const final = join(runsDir, name);
  await mkdir(tmp);
  try {
    await writeFile(join(tmp, 'report.json'), JSON.stringify(report));
    const traceMeta = {};
    for (const [id, abs] of await resolveTraces(projectRoot, report, artRoot, traces)) {
      if (!existsSync(abs)) continue;
      await mkdir(join(tmp, 'traces'), { recursive: true });
      await copyFile(abs, join(tmp, 'traces', `${id}.md`));
      traceMeta[id] = `traces/${id}.md`;
    }
    for (const a of nonPassedArtifacts(report)) if (a.path) await copyInto(artRoot, join(tmp, 'artifacts'), a.path);
    const meta = { ...summarize(report, { source, rerunOf, git: report.run.vcs ? null : gitInfo(projectRoot) }), traces: traceMeta };
    await writeFile(join(tmp, 'meta.json'), JSON.stringify(meta, null, 2));
    await rename(tmp, final);
  } catch (e) {
    await rm(tmp, { recursive: true, force: true });
    if (e.code === 'ENOTEMPTY' || e.code === 'EEXIST') return { status: 'exists', runDir: final };
    throw e;
  }
  await applyRetention(projectRoot, keep ?? cfg.retention ?? 50);
  return { status: 'archived', runDir: final };
}

export async function applyRetention(projectRoot, keep = 50) {
  const runsDir = join(projectRoot, DATA_DIR, 'runs');
  let names;
  try {
    names = (await readdir(runsDir)).filter((n) => !n.startsWith('.')).sort().reverse(); // names start with ISO time
  } catch {
    return [];
  }
  const removed = [];
  let kept = 0;
  for (const n of names) {
    let meta;
    try {
      meta = JSON.parse(await readFile(join(runsDir, n, 'meta.json'), 'utf8'));
    } catch {
      continue; // being written or removed by a concurrent archive
    }
    if (meta.pinned || ++kept <= keep) continue;
    await rm(join(runsDir, n), { recursive: true, force: true });
    removed.push(n);
  }
  return removed;
}
```

- [ ] **Step 4: Chạy, xác nhận pass**

Run: `npm test`
Expected: tất cả PASS (manifest 3, summarize 5, archive 9)

- [ ] **Step 5: Commit**

```bash
git add reporter/e2e-dashboard.reporter.mjs test/archive.test.mjs
git commit -m "feat(reporter): idempotent archive with retention"
```

---

### Task 4: Reporter object (live events + archive khi run xong)

**Files:**
- Modify: `reporter/e2e-dashboard.reporter.mjs` (thêm vào cuối)
- Test: `test/reporter.test.mjs`

**Interfaces:**
- Consumes: `archive`, `DATA_DIR` (Task 3)
- Produces:
  - `export function readServerInfo(projectRoot) → { port, token, pid } | null`
  - `export function createReporter({ env = process.env, fetchImpl = globalThis.fetch } = {}) → { name: 'e2e-dashboard', onEvent(event), onRunFinished(run, signal) }`
  - `export default createReporter()` (không side effect lúc construct)
  - Mỗi event được `POST http://127.0.0.1:<port>/api/events` với header `x-e2e-dashboard-token`, body = event JSON nguyên văn.

- [ ] **Step 1: Viết test**

`test/reporter.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReporter } from '../reporter/e2e-dashboard.reporter.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));

function project({ server = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  mkdirSync(join(root, '.e2e-dashboard'), { recursive: true });
  if (server) writeFileSync(join(root, '.e2e-dashboard/server.json'), JSON.stringify({ port: 4477, token: 't0k', pid: 1 }));
  return root;
}
const started = (root) => ({ type: 'run-started', seq: 0, at: '2026-07-24T12:00:00.000Z', projectRoot: root, artifactsRoot: join(root, '.e2e/results') });
const finished = (root) => ({ report: fixture(), status: 'failed', exitCode: 1, projectRoot: root, reportPath: undefined, artifactsRoot: join(root, '.e2e/results'), traces: new Map() });

test('posts every event to the running dashboard with the token', async () => {
  const root = project();
  const calls = [];
  const r = createReporter({ env: {}, fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true }; } });
  r.onEvent(started(root));
  r.onEvent({ type: 'plan', seq: 1, total: 2, files: [] });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'http://127.0.0.1:4477/api/events');
  assert.equal(calls[0].init.headers['x-e2e-dashboard-token'], 't0k');
  assert.equal(JSON.parse(calls[1].init.body).type, 'plan');
});

test('does nothing on CI', async () => {
  const root = project();
  const calls = [];
  const r = createReporter({ env: { CI: 'true' }, fetchImpl: async (...a) => calls.push(a) });
  r.onEvent(started(root));
  assert.equal(await r.onRunFinished(finished(root), new AbortController().signal), undefined);
  assert.equal(calls.length, 0);
});

test('never throws: rejected fetch, garbage event, missing server', async () => {
  const root = project({ server: false });
  const r = createReporter({ env: {}, fetchImpl: () => Promise.reject(new Error('ECONNREFUSED')) });
  assert.doesNotThrow(() => r.onEvent(null));
  assert.doesNotThrow(() => r.onEvent(started(root)));
  assert.doesNotThrow(() => r.onEvent({ type: 'plan' }));
});

test('archives the finished run and returns a dashboard row', async () => {
  const root = project();
  const r = createReporter({ env: {}, fetchImpl: async () => ({ ok: true }) });
  r.onEvent(started(root));
  const rows = await r.onRunFinished(finished(root), new AbortController().signal);
  assert.equal(readdirSync(join(root, '.e2e-dashboard/runs')).length, 1);
  assert.equal(rows[0].label, 'Dashboard');
  assert.match(rows[0].text, /^http:\/\/127\.0\.0\.1:4477\/#\/run\//);
});

test('skips archive when the signal is already aborted', async () => {
  const root = project();
  const r = createReporter({ env: {}, fetchImpl: async () => ({ ok: true }) });
  const ac = new AbortController();
  ac.abort();
  assert.equal(await r.onRunFinished(finished(root), ac.signal), undefined);
});
```

- [ ] **Step 2: Chạy, xác nhận fail**

Run: `node --test test/reporter.test.mjs`
Expected: FAIL (`createReporter` is not exported)

- [ ] **Step 3: Implement** (thêm vào cuối file reporter)

```js
export function readServerInfo(projectRoot) {
  try {
    const s = JSON.parse(readFileSync(join(projectRoot, DATA_DIR, 'server.json'), 'utf8'));
    return s.port && s.token ? s : null;
  } catch {
    return null;
  }
}

export function createReporter({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  let server = null;
  const post = (event) => {
    if (!server) return;
    fetchImpl(`http://127.0.0.1:${server.port}/api/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-e2e-dashboard-token': server.token },
      body: JSON.stringify(event),
    }).catch(() => {
      server = null; // dashboard went away; stop trying for this run
    });
  };
  return {
    name: 'e2e-dashboard',
    onEvent(event) {
      if (env.CI) return;
      try {
        if (event?.type === 'run-started') server = readServerInfo(event.projectRoot);
        if (event) post(event);
      } catch {
        // onEvent must never throw: a throw quarantines the reporter
      }
    },
    async onRunFinished(run, signal) {
      if (env.CI || signal?.aborted) return;
      try {
        const res = await archive(run.projectRoot, {
          source: 'reporter',
          report: run.report,
          reportPath: run.reportPath,
          artifactsRoot: run.artifactsRoot,
          traces: run.traces,
        });
        const s = server ?? readServerInfo(run.projectRoot);
        if (res.status !== 'skipped' && s) return [{ label: 'Dashboard', text: `http://127.0.0.1:${s.port}/#/run/${run.report.run.id}` }];
      } catch (e) {
        return [{ label: 'Dashboard', text: `archive failed: ${e.message}` }];
      }
    },
  };
}

export default createReporter();
```

- [ ] **Step 4: Chạy, xác nhận pass**

Run: `npm test`
Expected: tất cả PASS

- [ ] **Step 5: Commit**

```bash
git add reporter/e2e-dashboard.reporter.mjs test/reporter.test.mjs
git commit -m "feat(reporter): stream events to dashboard and archive on finish"
```

---

### Task 5: Hook Claude Code — archive sau `e2e run|explore`

**Files:**
- Create: `bin/project.mjs`, `bin/archive.mjs`, `hooks/hooks.json`
- Test: `test/hook.test.mjs`

**Interfaces:**
- Consumes: `archive` (Task 3)
- Produces:
  - `bin/project.mjs`: `export const CONFIG_NAMES = ['e2e.config.ts', 'e2e.config.mts', 'e2e.config.js', 'e2e.config.mjs']`, `export function findConfig(dir) → string|null`, `export function findProjectRoot(start) → string|null` (đi ngược lên tới thư mục có e2e config)
  - `bin/archive.mjs`: `export const E2E_COMMAND`, `export function outputFlag(command) → string|undefined`, `export async function handleHook(payload, env = process.env) → {status, ...}`; chạy trực tiếp thì đọc stdin JSON và luôn exit 0.

- [ ] **Step 1: Viết test**

`test/hook.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleHook, outputFlag, E2E_COMMAND } from '../bin/archive.mjs';
import { findProjectRoot } from '../bin/project.mjs';

const fixture = readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8');
const SCRIPT = fileURLToPath(new URL('../bin/archive.mjs', import.meta.url));

function project(output = '.e2e') {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  writeFileSync(join(root, 'e2e.config.ts'), 'export default {}');
  mkdirSync(join(root, output), { recursive: true });
  writeFileSync(join(root, output, 'report.json'), fixture);
  mkdirSync(join(root, 'tests/sub'), { recursive: true });
  return root;
}

test('matches e2e run/explore commands only', () => {
  for (const c of ['npx e2e run', 'pnpm exec e2e run tests/a.e2e.ts', "bunx e2e explore 'checkout'", 'cd app && npx e2e run --retries 2'])
    assert.ok(E2E_COMMAND.test(c), c);
  for (const c of ['npx e2e init', 'ls e2e', 'npx e2e-dashboard run', 'echo e2e'])
    assert.ok(!E2E_COMMAND.test(c), c);
});

test('reads --output from the command', () => {
  assert.equal(outputFlag('npx e2e run --output out'), 'out');
  assert.equal(outputFlag('npx e2e run --output=out/x'), 'out/x');
  assert.equal(outputFlag('npx e2e run'), undefined);
});

test('finds the project root from a nested cwd', () => {
  const root = project();
  assert.equal(findProjectRoot(join(root, 'tests/sub')), root);
  assert.equal(findProjectRoot(tmpdir()), null);
});

test('archives after an e2e run, honouring --output', async () => {
  const root = project('out');
  const res = await handleHook({ cwd: join(root, 'tests/sub'), tool_input: { command: 'npx e2e run --output out' } }, {});
  assert.equal(res.status, 'archived');
});

test('ignores other commands', async () => {
  const root = project();
  assert.equal((await handleHook({ cwd: root, tool_input: { command: 'git status' } }, {})).status, 'ignored');
});

test('script exits 0 even on garbage stdin', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { input: 'not json' });
  assert.equal(r.status, 0);
});
```

- [ ] **Step 2: Chạy, xác nhận fail**

Run: `node --test test/hook.test.mjs`
Expected: FAIL (cannot find module `../bin/archive.mjs`)

- [ ] **Step 3: Implement**

`bin/project.mjs`:
```js
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const CONFIG_NAMES = ['e2e.config.ts', 'e2e.config.mts', 'e2e.config.js', 'e2e.config.mjs'];

export function findConfig(dir) {
  for (const n of CONFIG_NAMES) if (existsSync(join(dir, n))) return join(dir, n);
  return null;
}

export function findProjectRoot(start) {
  let d = resolve(start);
  for (;;) {
    if (findConfig(d)) return d;
    const parent = dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}
```

`bin/archive.mjs`:
```js
#!/usr/bin/env node
// PostToolUse(Bash) hook: after Claude runs `e2e run|explore`, archive the report. Always exits 0.
import { pathToFileURL } from 'node:url';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { findProjectRoot } from './project.mjs';

export const E2E_COMMAND = /(^|[\s;&|(])e2e\s+(run|explore)\b/;

export function outputFlag(command) {
  return command.match(/--output(?:=|\s+)(\S+)/)?.[1];
}

export async function handleHook(payload, env = process.env) {
  const command = payload?.tool_input?.command;
  if (typeof command !== 'string' || !E2E_COMMAND.test(command)) return { status: 'ignored' };
  const root = findProjectRoot(payload.cwd ?? env.CLAUDE_PROJECT_DIR ?? process.cwd());
  if (!root) return { status: 'ignored' };
  return archive(root, { source: 'hook', outputDir: outputFlag(command) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  setTimeout(() => process.exit(0), 10_000).unref();
  let input = '';
  process.stdin.on('data', (c) => (input += c));
  process.stdin.on('end', async () => {
    try {
      await handleHook(JSON.parse(input));
    } catch {
      // never block Claude
    }
    process.exit(0);
  });
}
```

Lưu ý regex: `(^|[\s;&|(])e2e` thay cho `\be2e` để `npx e2e-dashboard run` và `my-e2e run` không khớp.

`hooks/hooks.json`:
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/archive.mjs\"", "timeout": 15 }
        ]
      }
    ]
  }
}
```

- [ ] **Step 4: Chạy, xác nhận pass**

Run: `npm test`
Expected: tất cả PASS

- [ ] **Step 5: Commit**

```bash
git add bin/project.mjs bin/archive.mjs hooks/hooks.json test/hook.test.mjs
git commit -m "feat(hook): archive e2e report after Claude runs e2e"
```

---

### Task 6: Store — đọc lịch sử, ghim/baseline, lịch sử theo test

**Files:**
- Create: `server/store.mjs`
- Test: `test/store.test.mjs`

**Interfaces:**
- Consumes: `archive`, `DATA_DIR`, `safeJoin` (Task 3)
- Produces:
  - `export async function listRuns(root) → Array<Meta & { dir }>` (mới nhất trước; bỏ qua thư mục hỏng/`.tmp-*`)
  - `export async function findRunDir(root, runId) → string|null` (runId phải khớp `/^[0-9a-f-]{8,}$/i`)
  - `export async function getRun(root, runId) → { meta, report, dir } | null`
  - `export async function setFlag(root, runId, flag: 'pinned'|'baseline', value: boolean) → Meta|null` (baseline độc quyền)
  - `export async function testHistory(root, n = 10) → Array<TestRow>`
  - `TestRow = { key, testId, title, file, line, target, agent, tags, history: Array<{ runId, status }>, avgDurationMs|null }`; `key = testId|target|agent`; history mới nhất trước.

- [ ] **Step 1: Viết test**

`test/store.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { listRuns, getRun, setFlag, testHistory, findRunDir } from '../server/store.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));
const id = (i) => `018f0f5c-7b2a-7abc-8abc-00000000000${i}`;

async function projectWithRuns(n) {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  for (let i = 0; i < n; i++) {
    const r = fixture();
    r.run.id = id(i);
    r.run.startedAt = `2026-07-2${i}T12:00:00.000Z`;
    r.run.results[0].status = i % 2 ? 'failed' : 'passed';
    await archive(root, { source: 'hook', report: r });
  }
  return root;
}

test('listRuns returns newest first', async () => {
  const root = await projectWithRuns(3);
  assert.deepEqual((await listRuns(root)).map((m) => m.runId), [id(2), id(1), id(0)]);
  assert.deepEqual(await listRuns(mkdtempSync(join(tmpdir(), 'e2ed-'))), []);
});

test('getRun returns meta and report; unknown or malicious ids return null', async () => {
  const root = await projectWithRuns(1);
  const run = await getRun(root, id(0));
  assert.equal(run.report.run.id, id(0));
  assert.equal(run.meta.runId, id(0));
  assert.equal(await getRun(root, id(9)), null);
  assert.equal(await findRunDir(root, '../../etc'), null);
});

test('pin persists and baseline is exclusive', async () => {
  const root = await projectWithRuns(2);
  assert.equal((await setFlag(root, id(0), 'pinned', true)).pinned, true);
  await setFlag(root, id(0), 'baseline', true);
  await setFlag(root, id(1), 'baseline', true);
  const metas = await listRuns(root);
  assert.deepEqual(metas.filter((m) => m.baseline).map((m) => m.runId), [id(1)]);
  assert.equal(metas.find((m) => m.runId === id(0)).pinned, true);
  await assert.rejects(setFlag(root, id(0), 'dir', true));
});

test('testHistory lists each test with per-run statuses, newest first', async () => {
  const root = await projectWithRuns(3);
  const rows = await testHistory(root, 10);
  const row = rows.find((r) => r.testId === fixture().run.results[0].testId);
  assert.deepEqual(row.history.map((h) => h.status), ['passed', 'failed', 'passed']);
  assert.equal(row.target, 'web');
  assert.equal(row.title, 'opens app');
  assert.equal(row.line, 3);
  assert.ok(row.avgDurationMs > 0);
});
```

- [ ] **Step 2: Chạy, xác nhận fail**

Run: `node --test test/store.test.mjs`
Expected: FAIL (cannot find module `../server/store.mjs`)

- [ ] **Step 3: Implement**

`server/store.mjs`:
```js
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from '../reporter/e2e-dashboard.reporter.mjs';

const runsDir = (root) => join(root, DATA_DIR, 'runs');
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

export async function listRuns(root) {
  let names;
  try {
    names = await readdir(runsDir(root));
  } catch {
    return [];
  }
  const metas = [];
  for (const dir of names.filter((n) => !n.startsWith('.')).sort().reverse()) {
    try {
      metas.push({ ...(await readJson(join(runsDir(root), dir, 'meta.json'))), dir });
    } catch {
      // half-written or removed concurrently
    }
  }
  return metas;
}

export async function findRunDir(root, runId) {
  if (typeof runId !== 'string' || !/^[0-9a-f-]{8,}$/i.test(runId)) return null;
  const names = await readdir(runsDir(root)).catch(() => []);
  const dir = names.find((d) => d.endsWith(`_${runId}`));
  return dir ? join(runsDir(root), dir) : null;
}

export async function getRun(root, runId) {
  const dir = await findRunDir(root, runId);
  if (!dir) return null;
  return { meta: await readJson(join(dir, 'meta.json')), report: await readJson(join(dir, 'report.json')), dir };
}

async function writeMeta(dir, meta) {
  const { dir: _ignored, ...rest } = meta;
  await writeFile(join(dir, 'meta.json'), JSON.stringify(rest, null, 2));
  return rest;
}

export async function setFlag(root, runId, flag, value) {
  if (flag !== 'pinned' && flag !== 'baseline') throw new Error(`unknown flag ${flag}`);
  const dir = await findRunDir(root, runId);
  if (!dir) return null;
  if (flag === 'baseline' && value) {
    for (const m of await listRuns(root))
      if (m.baseline && m.runId !== runId) await writeMeta(join(runsDir(root), m.dir), { ...m, baseline: false });
  }
  const meta = await readJson(join(dir, 'meta.json'));
  return writeMeta(dir, { ...meta, [flag]: Boolean(value) });
}

const resultDuration = (r) => (r.attempts ?? []).reduce((s, a) => s + (a.durationMs ?? 0), 0);

export async function testHistory(root, n = 10) {
  const rows = new Map();
  for (const m of (await listRuns(root)).slice(0, n)) {
    let report;
    try {
      report = await readJson(join(runsDir(root), m.dir, 'report.json'));
    } catch {
      continue;
    }
    for (const r of report.run.results ?? []) {
      if (r.kind === 'setup') continue;
      const key = `${r.testId}|${r.targetId}|${r.agent ?? 'default'}`;
      if (!rows.has(key))
        rows.set(key, {
          key,
          testId: r.testId,
          title: r.titlePath.join(' › '),
          file: r.source?.file ?? r.file,
          line: r.source?.line ?? null,
          target: r.targetId,
          agent: r.agent ?? 'default',
          tags: r.tags ?? [],
          history: [],
          durations: [],
        });
      const row = rows.get(key);
      row.history.push({ runId: m.runId, status: r.status });
      if (r.status !== 'skipped') row.durations.push(resultDuration(r));
    }
  }
  return [...rows.values()].map(({ durations, ...row }) => ({
    ...row,
    avgDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
  }));
}
```

- [ ] **Step 4: Chạy, xác nhận pass**

Run: `npm test`
Expected: tất cả PASS

- [ ] **Step 5: Commit**

```bash
git add server/store.mjs test/store.test.mjs
git commit -m "feat(server): run store with pin, baseline and per-test history"
```

---

### Task 7: Trạng thái live — events → snapshot, làn Gantt, ETA

**Files:**
- Create: `server/live.mjs`
- Test: `test/live.test.mjs`

**Interfaces:**
- Produces:
  - `export function createLive({ throttleMs = 250 } = {}) → { apply(event), snapshot(), subscribe(fn) → unsubscribe, flush() }`
  - `Snapshot = { runId, status: 'idle'|'running'|'finished'|'interrupted', runStatus: null|'passed'|'failed'|'blocked'|'error'|'interrupted' (từ `run-finished`), startedAt, finishedAt, artifactsRoot, total, done, lanes: number, tests: LiveTest[], output: Array<{ pair, stream, text }>, error|null }`
  - `LiveTest = { key, testId, title, file, target, agent, repeat, lane, status, startedAt, finishedAt|null, durationMs|null, activity|null, steps: Array<{ stepId, kind, api, label, status, durationMs|null, error|null }> }`
  - `key = testId|target|agent|repeat`
  - `export function estimateEta(snapshot, avgByKey: Map<string, number>) → number|null` (ms còn lại)
  - Subscriber nhận snapshot, tối đa 1 lần mỗi `throttleMs`; `flush()` gửi ngay (dùng cho test và khi `run-finished`).

- [ ] **Step 1: Viết test**

`test/live.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLive, estimateEta } from '../server/live.mjs';

const at = (s) => `2026-07-24T12:00:${String(s).padStart(2, '0')}.000Z`;
const started = (testId, s) => ({ type: 'test-started', at: at(s), testId, agent: 'default', repeat: 0, title: testId, file: 'a.e2e.ts', target: 'web' });
const finished = (testId, s, status = 'passed') => ({
  type: 'test-finished', at: at(s),
  result: { testId, targetId: 'web', agent: 'default', repeat: 0, status, attempts: [{ durationMs: 1000 }] },
});

test('tracks run lifecycle, counts and lanes (lowest free lane is reused)', () => {
  const live = createLive();
  live.apply({ type: 'run-started', at: at(0), runId: 'r1', artifactsRoot: '/x' });
  live.apply({ type: 'plan', at: at(0), total: 3, files: [] });
  live.apply(started('A', 1));
  live.apply(started('B', 1));
  live.apply(finished('A', 2));
  live.apply(started('C', 3));
  const s = live.snapshot();
  assert.equal(s.status, 'running');
  assert.equal(s.total, 3);
  assert.equal(s.done, 1);
  const lane = (id) => s.tests.find((t) => t.testId === id).lane;
  assert.deepEqual([lane('A'), lane('B'), lane('C')], [0, 1, 0]);
  assert.equal(s.lanes, 2);
  live.apply({ type: 'run-finished', at: at(9), status: 'failed', exitCode: 1 });
  assert.equal(live.snapshot().status, 'finished');
  assert.equal(live.snapshot().runStatus, 'failed');
});

test('records step progress by stepId', () => {
  const live = createLive();
  live.apply({ type: 'run-started', at: at(0), runId: 'r1' });
  live.apply(started('A', 1));
  const base = { type: 'step', testId: 'A', agent: 'default', repeat: 0, target: 'web' };
  const identity = { attemptId: 'x', attemptIndex: 0, stepId: 's1', stepIndex: 0 };
  live.apply({ ...base, progress: { phase: 'start', kind: 'agent', api: 'agent.act', label: 'buy', identity } });
  live.apply({ ...base, progress: { phase: 'activity', api: 'agent.act', activity: 'model', identity } });
  let t = live.snapshot().tests[0];
  assert.equal(t.steps[0].status, 'running');
  assert.equal(t.activity, 'model');
  live.apply({ ...base, progress: { phase: 'end', kind: 'agent', api: 'agent.act', label: 'buy', status: 'failed', durationMs: 50, modelCalls: 1, error: { message: 'nope' }, identity } });
  t = live.snapshot().tests[0];
  assert.equal(t.steps[0].status, 'failed');
  assert.equal(t.steps[0].error.message, 'nope');
});

test('ignores unknown events and malformed input; caps output', () => {
  const live = createLive();
  live.apply({ type: 'run-started', at: at(0), runId: 'r1' });
  live.apply({ type: 'brand-new-event' });
  live.apply(null);
  live.apply({ type: 'step', testId: 'missing', progress: { phase: 'start' } });
  for (let i = 0; i < 600; i++) live.apply({ type: 'output', at: at(1), pair: undefined, stream: 'stdout', text: `l${i}` });
  const s = live.snapshot();
  assert.equal(s.output.length, 500);
  assert.equal(s.output.at(-1).text, 'l599');
});

test('subscribers receive throttled snapshots; flush sends immediately', () => {
  const live = createLive({ throttleMs: 10_000 });
  const got = [];
  const off = live.subscribe((s) => got.push(s));
  live.apply({ type: 'run-started', at: at(0), runId: 'r1' });
  live.apply(started('A', 1));
  live.flush();
  assert.equal(got.length, 1);
  assert.equal(got[0].tests.length, 1);
  off();
  live.flush();
  assert.equal(got.length, 1);
});

test('estimateEta uses history averages for remaining tests divided by lanes', () => {
  const snap = { status: 'running', total: 4, done: 2, lanes: 2, tests: [] };
  assert.equal(estimateEta(snap, new Map([['a', 2000], ['b', 4000]])), 3000); // 2 left × 3000 avg ÷ 2 lanes
  assert.equal(estimateEta(snap, new Map()), null);
  assert.equal(estimateEta({ ...snap, status: 'finished' }, new Map([['a', 1]])), null);
});
```

- [ ] **Step 2: Chạy, xác nhận fail**

Run: `node --test test/live.test.mjs`
Expected: FAIL (cannot find module `../server/live.mjs`)

- [ ] **Step 3: Implement**

`server/live.mjs`:
```js
// In-memory state of the current run, built from e2e reporter events.
const MAX_OUTPUT = 500;

const empty = () => ({
  runId: null, status: 'idle', runStatus: null, startedAt: null, finishedAt: null, artifactsRoot: null,
  total: 0, done: 0, lanes: 0, tests: [], output: [], error: null,
});

export function createLive({ throttleMs = 250 } = {}) {
  let state = empty();
  let byKey = new Map();
  let busy = []; // lane index -> true while a test runs there
  const subs = new Set();
  let timer = null;

  const keyOf = (testId, target, agent, repeat) => `${testId}|${target}|${agent ?? 'default'}|${repeat ?? 0}`;
  const takeLane = () => {
    let i = busy.indexOf(false);
    if (i === -1) i = busy.push(false) - 1;
    busy[i] = true;
    state.lanes = Math.max(state.lanes, busy.length);
    return i;
  };

  const notify = () => {
    clearTimeout(timer);
    timer = null;
    const snap = structuredClone(state);
    for (const fn of subs) fn(snap);
  };
  const schedule = () => {
    if (!timer) timer = setTimeout(notify, throttleMs);
  };

  function apply(e) {
    if (!e || typeof e !== 'object') return;
    switch (e.type) {
      case 'run-started':
        state = { ...empty(), runId: e.runId ?? null, status: 'running', startedAt: e.at, artifactsRoot: e.artifactsRoot ?? null };
        byKey = new Map();
        busy = [];
        break;
      case 'plan':
        state.total = e.total ?? 0;
        break;
      case 'test-started': {
        const key = keyOf(e.testId, e.target, e.agent, e.repeat);
        const t = {
          key, testId: e.testId, title: e.title, file: e.file, target: e.target, agent: e.agent ?? 'default', repeat: e.repeat ?? 0,
          lane: takeLane(), status: 'running', startedAt: e.at, finishedAt: null, durationMs: null, activity: null, steps: [],
        };
        if (byKey.has(key)) state.tests = state.tests.filter((x) => x.key !== key); // serial member re-run
        byKey.set(key, t);
        state.tests.push(t);
        break;
      }
      case 'step': {
        const t = byKey.get(keyOf(e.testId, e.target, e.agent, e.repeat));
        const p = e.progress;
        if (!t || !p) return;
        const stepId = p.identity?.stepId ?? `${p.api}:${t.steps.length}`;
        let s = t.steps.find((x) => x.stepId === stepId);
        if (p.phase === 'start') {
          t.steps.push({ stepId, kind: p.kind, api: p.api, label: p.label, status: 'running', durationMs: null, error: null });
        } else if (p.phase === 'end' && s) {
          Object.assign(s, { status: p.status, durationMs: p.durationMs ?? null, error: p.error ?? null });
          t.activity = null;
        } else if (p.phase === 'activity') {
          t.activity = p.activity;
        }
        break;
      }
      case 'test-finished': {
        const r = e.result ?? {};
        const t = byKey.get(keyOf(r.testId, r.targetId, r.agent, r.repeat));
        state.done += 1;
        if (!t) break;
        Object.assign(t, {
          status: r.status, finishedAt: e.at, activity: null,
          durationMs: (r.attempts ?? []).reduce((sum, a) => sum + (a.durationMs ?? 0), 0),
        });
        busy[t.lane] = false;
        break;
      }
      case 'output':
        state.output.push({ pair: e.pair ?? null, stream: e.stream, text: e.text });
        if (state.output.length > MAX_OUTPUT) state.output.splice(0, state.output.length - MAX_OUTPUT);
        break;
      case 'run-error':
        state.error = e.error ?? null;
        break;
      case 'run-interrupted':
        state.status = 'interrupted';
        break;
      case 'run-finished':
        state.status = state.status === 'interrupted' ? 'interrupted' : 'finished';
        state.runStatus = e.status ?? null; // report-level verdict: passed | failed | blocked | error | interrupted
        state.finishedAt = e.at;
        break;
      default:
        return; // new event types are added over time; ignore them
    }
    if (e.type === 'run-finished') notify();
    else schedule();
  }

  return {
    apply,
    snapshot: () => structuredClone(state),
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    flush: notify,
  };
}

export function estimateEta(snapshot, avgByKey) {
  if (snapshot.status !== 'running' || !avgByKey.size) return null;
  const remaining = Math.max(0, snapshot.total - snapshot.done);
  const values = [...avgByKey.values()];
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.round((remaining * avg) / Math.max(1, snapshot.lanes));
}
```

- [ ] **Step 4: Chạy, xác nhận pass**

Run: `npm test`
Expected: tất cả PASS

- [ ] **Step 5: Commit**

```bash
git add server/live.mjs test/live.test.mjs
git commit -m "feat(server): live run state with lanes and ETA"
```

---

### Task 8: HTTP app — xác thực, API, file (Range), SSE, bundle UI

**Files:**
- Create: `ui/bundle.mjs`, `server/app.mjs`, `ui/index.html`, `ui/style.css`, `ui/app.js` (bản tạm, Task 11–12 thay)
- Test: `test/bundle.test.mjs`, `test/app.test.mjs`

**Interfaces:**
- Consumes: `safeJoin`, `VERSION` (Task 3); `listRuns`, `getRun`, `findRunDir`, `setFlag`, `testHistory` (Task 6); `createLive`, `estimateEta` (Task 7)
- Produces:
  - `ui/bundle.mjs`: `export async function bundleUi(uiDir, entry = 'app.js') → string` — nối các ES module theo thứ tự phụ thuộc, bỏ dòng `import … from './…'`, bỏ chữ `export ` trước khai báo. **Quy ước cho mọi file trong `ui/`:** chỉ dùng `import { a, b } from './x.js'` (một dòng), chỉ `export function|const|let|class|async function`, không `export default`, tên top-level không trùng giữa các file.
  - `server/app.mjs`: `export function createApp({ projectRoot, token, uiDir, live, onEvent? }) → (req, res) => Promise<void>`
  - Cookie: `e2ed=<token>; HttpOnly; SameSite=Strict; Path=/`. Header: `x-e2e-dashboard-token`.
  - Routes:

| Method | Path | Trả về |
|---|---|---|
| GET | `/?token=…` (bất kỳ path) | 302 về path, set cookie |
| GET | `/`, `/app.js`, `/style.css` | UI |
| GET | `/api/info` | `{ version, project, reporter: { installed, version, latest } }` |
| GET | `/api/runs` | `Meta[]` |
| GET | `/api/runs/:id` | `{ meta, report }` hoặc 404 |
| POST | `/api/runs/:id/pin`, `/api/runs/:id/baseline` | body `{ value: boolean }` → Meta |
| GET | `/api/tests` | `TestRow[]` |
| GET | `/api/live` | SSE, mỗi message `data: <Snapshot + { etaMs }>` |
| POST | `/api/events` | body = event; 204 |
| GET | `/files/runs/:id/<rel>` | file trong thư mục run, hỗ trợ Range |

- [ ] **Step 1: Viết test bundle**

`test/bundle.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleUi } from '../ui/bundle.mjs';

test('orders modules by dependency, includes each once, strips import/export', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ui-'));
  mkdirSync(join(dir, 'views'));
  writeFileSync(join(dir, 'b.js'), 'export const base = 2;\n');
  writeFileSync(join(dir, 'views/c.js'), "import { base } from '../b.js';\nexport function triple() { return base * 3; }\n");
  writeFileSync(join(dir, 'app.js'), "import { base } from './b.js';\nimport { triple } from './views/c.js';\nglobalThis.__out = base + triple();\n");
  const code = await bundleUi(dir);
  assert.doesNotMatch(code, /^\s*(import|export)\s/m);
  assert.equal(code.match(/const base = 2/g).length, 1);
  assert.ok(code.indexOf('const base') < code.indexOf('function triple'));
  new Function(code)();
  assert.equal(globalThis.__out, 8);
});

test('rejects export default', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ui-'));
  writeFileSync(join(dir, 'app.js'), 'export default 1;\n');
  await assert.rejects(bundleUi(dir), /export default/);
});
```

- [ ] **Step 2: Chạy, xác nhận fail**

Run: `node --test test/bundle.test.mjs`
Expected: FAIL (cannot find module)

- [ ] **Step 3: Implement bundle**

`ui/bundle.mjs`:
```js
// Tiny concatenating bundler for the dashboard UI: one script for the server and the HTML export.
import { readFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';

const IMPORT = /^\s*import\s*\{[^}]*\}\s*from\s*['"](\.{1,2}\/[^'"]+)['"];?\s*$/gm;

export async function bundleUi(uiDir, entry = 'app.js') {
  const seen = new Set();
  const parts = [];
  async function visit(file) {
    if (seen.has(file)) return;
    seen.add(file);
    const src = await readFile(file, 'utf8');
    if (/^\s*export\s+default\b/m.test(src)) throw new Error(`export default is not supported: ${file}`);
    for (const [, spec] of src.matchAll(IMPORT)) await visit(resolve(dirname(file), spec));
    const body = src.replace(IMPORT, '').replace(/^(\s*)export\s+(?=(async\s+)?function|const|let|class)/gm, '$1');
    parts.push(`// ${relative(uiDir, file)}\n${body}`);
  }
  await visit(resolve(uiDir, entry));
  return `(() => {\n'use strict';\n${parts.join('\n')}\n})();\n`;
}
```

- [ ] **Step 4: Chạy test bundle, xác nhận pass**

Run: `node --test test/bundle.test.mjs`
Expected: 2 PASS

- [ ] **Step 5: Viết test app**

`test/app.test.mjs`:
```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';

const TOKEN = 'tok-123';
const VIDEO = 'web/tests_example.e2e.ts__opens_app/attempt-0/video/video.webm';
const UI = fileURLToPath(new URL('../ui', import.meta.url));
let server, base, runId;

function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

before(async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  const report = JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));
  report.run.results[0].status = 'failed';
  report.run.results[0].attempts[0].artifacts.push({ id: 'h', kind: 'other', mediaType: 'text/html', path: 'web/page.html', redaction: 'complete', producer: { kind: 'attempt' } });
  runId = report.run.id;
  put(root, '.e2e/report.json', JSON.stringify(report));
  put(root, `.e2e/results/${VIDEO}`, 'webm-bytes');
  put(root, '.e2e/results/web/page.html', '<script>alert(1)</script>');
  await archive(root, { source: 'hook' });
  server = http.createServer(createApp({ projectRoot: root, token: TOKEN, uiDir: UI, live: createLive({ throttleMs: 1 }) }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const auth = { 'x-e2e-dashboard-token': TOKEN };

test('rejects requests without token', async () => {
  assert.equal((await fetch(`${base}/api/runs`)).status, 401);
});

test('token in URL sets a strict HttpOnly cookie and redirects', async () => {
  const res = await fetch(`${base}/?token=${TOKEN}`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/');
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const runs = await fetch(`${base}/api/runs`, { headers: { cookie: cookie.split(';')[0] } });
  assert.equal(runs.status, 200);
  assert.equal((await runs.json())[0].runId, runId);
});

test('rejects foreign Host header (DNS rebinding)', async () => {
  const status = await new Promise((resolve) => {
    http.get(`${base}/api/runs`, { headers: { ...auth, host: 'evil.example:80' } }, (res) => resolve(res.statusCode));
  });
  assert.equal(status, 403);
});

test('POST requires same Origin', async () => {
  const body = JSON.stringify({ value: true });
  const bad = await fetch(`${base}/api/runs/${runId}/pin`, { method: 'POST', headers: { ...auth, origin: 'http://evil.example', 'content-type': 'application/json' }, body });
  assert.equal(bad.status, 403);
  const ok = await fetch(`${base}/api/runs/${runId}/pin`, { method: 'POST', headers: { ...auth, origin: base, 'content-type': 'application/json' }, body });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).pinned, true);
});

test('run detail and 404', async () => {
  assert.equal((await (await fetch(`${base}/api/runs/${runId}`, { headers: auth })).json()).report.run.id, runId);
  assert.equal((await fetch(`${base}/api/runs/018f0f5c-0000-0000-0000-000000000000`, { headers: auth })).status, 404);
});

test('files support Range and never escape the run dir', async () => {
  const res = await fetch(`${base}/files/runs/${runId}/artifacts/${VIDEO}`, { headers: { ...auth, range: 'bytes=0-3' } });
  assert.equal(res.status, 206);
  assert.equal(await res.text(), 'webm');
  assert.equal(res.headers.get('content-range'), 'bytes 0-3/10');
  assert.equal((await fetch(`${base}/files/runs/${runId}/..%2F..%2Fmeta.json`, { headers: auth })).status, 404);
});

test('HTML artifacts are served inert', async () => {
  const res = await fetch(`${base}/files/runs/${runId}/artifacts/web/page.html`, { headers: auth });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain/);
  assert.match(res.headers.get('content-security-policy'), /sandbox/);
});

test('events posted by the reporter reach SSE clients', async () => {
  const sse = await fetch(`${base}/api/live`, { headers: auth });
  const reader = sse.body.getReader();
  await reader.read(); // initial snapshot
  await fetch(`${base}/api/events`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'run-started', at: '2026-07-24T12:00:00.000Z', runId: 'live-1' }) });
  let text = '';
  while (!text.includes('live-1')) text += new TextDecoder().decode((await reader.read()).value);
  await reader.cancel();
  assert.match(text, /^data: /m);
});

test('serves the UI bundle', async () => {
  const res = await fetch(`${base}/app.js`, { headers: auth });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
});
```

- [ ] **Step 6: Chạy, xác nhận fail**

Run: `node --test test/app.test.mjs`
Expected: FAIL (cannot find module `../server/app.mjs`)

- [ ] **Step 7: Implement app + UI tạm**

`ui/index.html`:
```html
<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>e2e dashboard</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div id="app"></div>
  <script src="/app.js"></script>
</body>
</html>
```

`ui/style.css`:
```css
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; }
```

`ui/app.js` (tạm):
```js
document.getElementById('app').textContent = 'e2e-dashboard';
```

`server/app.mjs`:
```js
import { readFile, stat } from 'node:fs/promises';
import { createReadStream, readFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { safeJoin, VERSION } from '../reporter/e2e-dashboard.reporter.mjs';
import { listRuns, getRun, findRunDir, setFlag, testHistory } from './store.mjs';
import { estimateEta } from './live.mjs';
import { bundleUi } from '../ui/bundle.mjs';

const COOKIE = 'e2ed';
const MAX_BODY = 1024 * 1024;
const FILE_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.webm': 'video/webm', '.mp4': 'video/mp4', '.json': 'application/json',
  '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8',
  '.html': 'text/plain; charset=utf-8', '.htm': 'text/plain; charset=utf-8', '.svg': 'text/plain; charset=utf-8',
};
const UI_CSP = "default-src 'self'; img-src 'self' data:; media-src 'self' https:; style-src 'self' 'unsafe-inline'";

const same = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cookieToken = (req) =>
  (req.headers.cookie ?? '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === COOKIE)?.[1];

function send(res, status, body, headers = {}) {
  const isText = typeof body === 'string';
  res.writeHead(status, { 'content-type': isText ? 'text/plain; charset=utf-8' : 'application/json', ...headers });
  res.end(isText ? body : JSON.stringify(body));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

async function serveFile(req, res, path) {
  const st = await stat(path).catch(() => null);
  if (!st?.isFile()) return send(res, 404, 'not found');
  const headers = {
    'content-type': FILE_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
    'content-security-policy': 'sandbox',
  };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (m && (m[1] || m[2])) {
    const start = m[1] === '' ? Math.max(0, st.size - Number(m[2])) : Number(m[1]);
    const end = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
    if (start > end) return send(res, 416, '', { 'content-range': `bytes */${st.size}` });
    res.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${st.size}` });
    return createReadStream(path, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'content-length': st.size });
  createReadStream(path).pipe(res);
}

function reporterStatus(projectRoot) {
  try {
    const src = readFileSync(join(projectRoot, 'e2e-dashboard.reporter.mjs'), 'utf8');
    return { installed: true, version: src.match(/VERSION = '([^']+)'/)?.[1] ?? null, latest: VERSION };
  } catch {
    return { installed: false, version: null, latest: VERSION };
  }
}

export function createApp({ projectRoot, token, uiDir, live, onEvent = () => {} }) {
  let avgByKey = new Map();
  const refreshAverages = () =>
    testHistory(projectRoot, 10)
      .then((rows) => {
        avgByKey = new Map(rows.filter((r) => r.avgDurationMs != null).map((r) => [r.key, r.avgDurationMs]));
      })
      .catch(() => {});
  refreshAverages();
  const withEta = (s) => ({ ...s, etaMs: estimateEta(s, avgByKey) });

  async function route(req, res) {
    const url = new URL(req.url, 'http://local');
    const port = req.socket.localPort;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) return send(res, 403, 'bad host');

    const urlToken = url.searchParams.get('token');
    if (urlToken !== null) {
      if (!same(urlToken, token)) return send(res, 401, 'token sai');
      res.writeHead(302, { 'set-cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`, location: url.pathname });
      return res.end();
    }
    if (!same(req.headers['x-e2e-dashboard-token'], token) && !same(cookieToken(req), token))
      return send(res, 401, 'Mở dashboard bằng lệnh /e2e-dashboard trong Claude Code.');
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)
      return send(res, 403, 'bad origin');

    const p = url.pathname;
    const ui = { 'content-security-policy': UI_CSP, 'cache-control': 'no-store' };
    if (req.method === 'GET') {
      if (p === '/') return send(res, 200, await readFile(join(uiDir, 'index.html'), 'utf8'), { ...ui, 'content-type': 'text/html; charset=utf-8' });
      if (p === '/app.js') return send(res, 200, await bundleUi(uiDir), { ...ui, 'content-type': 'text/javascript; charset=utf-8' });
      if (p === '/style.css') return send(res, 200, await readFile(join(uiDir, 'style.css'), 'utf8'), { ...ui, 'content-type': 'text/css; charset=utf-8' });
      if (p === '/api/info') return send(res, 200, { version: VERSION, project: basename(projectRoot), reporter: reporterStatus(projectRoot) });
      if (p === '/api/runs') return send(res, 200, await listRuns(projectRoot));
      if (p === '/api/tests') return send(res, 200, await testHistory(projectRoot, 10));
      if (p === '/api/live') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        const write = (s) => res.write(`data: ${JSON.stringify(withEta(s))}\n\n`);
        write(live.snapshot());
        const off = live.subscribe(write);
        const beat = setInterval(() => res.write(': ping\n\n'), 15_000);
        req.on('close', () => {
          off();
          clearInterval(beat);
        });
        return;
      }
      let m = /^\/api\/runs\/([^/]+)$/.exec(p);
      if (m) {
        const run = await getRun(projectRoot, m[1]);
        return run ? send(res, 200, { meta: run.meta, report: run.report }) : send(res, 404, { error: 'run not found' });
      }
      m = /^\/files\/runs\/([^/]+)\/(.+)$/.exec(p);
      if (m) {
        const dir = await findRunDir(projectRoot, m[1]);
        const file = dir && safeJoin(dir, decodeURIComponent(m[2]));
        return file ? serveFile(req, res, file) : send(res, 404, 'not found');
      }
    }
    if (req.method === 'POST') {
      if (p === '/api/events') {
        const event = await readBody(req);
        live.apply(event);
        if (event?.type === 'run-started') refreshAverages();
        onEvent(event);
        res.writeHead(204);
        return res.end();
      }
      const m = /^\/api\/runs\/([^/]+)\/(pin|baseline)$/.exec(p);
      if (m) {
        const { value } = await readBody(req);
        const meta = await setFlag(projectRoot, m[1], m[2] === 'pin' ? 'pinned' : 'baseline', value);
        return meta ? send(res, 200, meta) : send(res, 404, { error: 'run not found' });
      }
    }
    send(res, 404, 'not found');
  }

  return async (req, res) => {
    try {
      await route(req, res);
    } catch (e) {
      if (!res.headersSent) send(res, e.status ?? (e instanceof SyntaxError ? 400 : 500), { error: e.message });
      else res.end();
    }
  };
}
```

- [ ] **Step 8: Chạy, xác nhận pass**

Run: `npm test`
Expected: tất cả PASS

- [ ] **Step 9: Commit**

```bash
git add ui/bundle.mjs ui/index.html ui/style.css ui/app.js server/app.mjs test/bundle.test.mjs test/app.test.mjs
git commit -m "feat(server): authenticated HTTP API, files with Range, live SSE"
```

---

### Task 9: Watcher + process server (`server/main.mjs`)

**Files:**
- Create: `server/watch.mjs`, `server/main.mjs`
- Test: `test/watch.test.mjs`, `test/main.test.mjs`

**Interfaces:**
- Consumes: `archive`, `DATA_DIR`, `readConfig` (Task 3); `createApp` (Task 8); `createLive` (Task 7)
- Produces:
  - `export function outputFromArtifactsRoot(artifactsRoot) → string` (`.../results` → thư mục cha; khác thì giữ nguyên)
  - `export function watchReport({ projectRoot, outputDir, artifactsRoot?, debounceMs = 500, onResult = () => {} }) → { close(), retarget(outputDir, artifactsRoot?) }` — theo dõi **thư mục** output (e2e thay file bằng file mới, watch file sẽ mất), gọi `archive(source:'watcher')`; `unreadable` → thử lại một lần sau 1 s.
  - `export async function startServer({ projectRoot, port = 4477, token = randomToken(), uiDir }) → { port, token, url, close() }` — thử port `port..port+20` (port 0 = ngẫu nhiên), ghi `.e2e-dashboard/server.json` `{ port, pid, token, version }`, `close()` xoá file đó.
  - Chạy trực tiếp: `node server/main.mjs <projectRoot>` → in một dòng JSON `{ port, url }` ra stdout; SIGINT/SIGTERM → `close()` rồi exit 0.

- [ ] **Step 1: Viết test watcher**

`test/watch.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { watchReport, outputFromArtifactsRoot } from '../server/watch.mjs';

const fixture = readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8');
const waitFor = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};
const runCount = (root) => (existsSync(join(root, '.e2e-dashboard/runs')) ? readdirSync(join(root, '.e2e-dashboard/runs')).filter((n) => !n.startsWith('.')).length : 0);

test('outputFromArtifactsRoot strips a trailing results dir', () => {
  assert.equal(outputFromArtifactsRoot('/p/.e2e/results'), '/p/.e2e');
  assert.equal(outputFromArtifactsRoot('/p/out'), '/p/out');
});

test('archives when report.json appears, ignoring a half-written file first', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  mkdirSync(join(root, '.e2e'));
  const results = [];
  const w = watchReport({ projectRoot: root, outputDir: join(root, '.e2e'), debounceMs: 50, onResult: (r) => results.push(r) });
  try {
    writeFileSync(join(root, '.e2e/report.json'), fixture.slice(0, 40));
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(runCount(root), 0);
    writeFileSync(join(root, '.e2e/report.json'), fixture);
    assert.ok(await waitFor(() => runCount(root) === 1), 'run archived');
    assert.ok(results.some((r) => r.status === 'archived'));
  } finally {
    w.close();
  }
});

test('output dir that does not exist yet is picked up once created', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  const w = watchReport({ projectRoot: root, outputDir: join(root, '.e2e'), debounceMs: 50 });
  try {
    mkdirSync(join(root, '.e2e'));
    await new Promise((r) => setTimeout(r, 1200));
    writeFileSync(join(root, '.e2e/report.json'), fixture);
    assert.ok(await waitFor(() => runCount(root) === 1), 'run archived');
  } finally {
    w.close();
  }
});
```

- [ ] **Step 2: Chạy, xác nhận fail**

Run: `node --test test/watch.test.mjs`
Expected: FAIL (cannot find module)

- [ ] **Step 3: Implement watcher**

`server/watch.mjs`:
```js
import { watch, existsSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';

export function outputFromArtifactsRoot(artifactsRoot) {
  return basename(artifactsRoot) === 'results' ? dirname(artifactsRoot) : artifactsRoot;
}

export function watchReport({ projectRoot, outputDir, artifactsRoot, debounceMs = 500, onResult = () => {} }) {
  let watcher = null;
  let timer = null;
  let poll = null;
  let closed = false;

  const run = async (retry = true) => {
    const res = await archive(projectRoot, { source: 'watcher', outputDir, artifactsRoot }).catch((e) => ({ status: 'error', reason: e.message }));
    if (res.status === 'skipped' && res.reason === 'unreadable' && retry && !closed) timer = setTimeout(() => run(false), 1000);
    onResult(res);
  };

  function start() {
    if (closed) return;
    if (!existsSync(outputDir)) {
      // ponytail: 1 s poll until the output dir exists; fs.watch cannot watch a missing path
      poll = setTimeout(start, 1000);
      return;
    }
    watcher = watch(outputDir, (_event, file) => {
      if (file && file !== 'report.json') return;
      clearTimeout(timer);
      timer = setTimeout(run, debounceMs);
    });
    watcher.on('error', () => {
      watcher?.close();
      watcher = null;
      poll = setTimeout(start, 1000); // directory removed (e.g. rm -rf .e2e); wait for it to come back
    });
  }

  start();
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      clearTimeout(poll);
      watcher?.close();
    },
    retarget(nextOutput, nextArtifacts) {
      if (nextOutput === outputDir) return;
      outputDir = nextOutput;
      artifactsRoot = nextArtifacts;
      watcher?.close();
      watcher = null;
      clearTimeout(poll);
      start();
    },
  };
}
```

- [ ] **Step 4: Chạy test watcher, xác nhận pass**

Run: `node --test test/watch.test.mjs`
Expected: 3 PASS

- [ ] **Step 5: Viết test server process**

`test/main.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { startServer } from '../server/main.mjs';

const freePort = () => new Promise((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

test('writes server.json, answers with the token, removes server.json on close', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  const s = await startServer({ projectRoot: root, port: 0 });
  try {
    const info = JSON.parse(readFileSync(join(root, '.e2e-dashboard/server.json'), 'utf8'));
    assert.equal(info.port, s.port);
    assert.equal(info.pid, process.pid);
    assert.equal(info.token, s.token);
    assert.match(s.url, new RegExp(`^http://127\\.0\\.0\\.1:${s.port}/\\?token=`));
    const res = await fetch(`http://127.0.0.1:${s.port}/api/info`, { headers: { 'x-e2e-dashboard-token': s.token } });
    assert.equal(res.status, 200);
  } finally {
    await s.close();
  }
  assert.equal(existsSync(join(root, '.e2e-dashboard/server.json')), false);
});

test('takes the next port when the preferred one is busy', async () => {
  const port = await freePort();
  const a = await startServer({ projectRoot: mkdtempSync(join(tmpdir(), 'e2ed-')), port });
  const b = await startServer({ projectRoot: mkdtempSync(join(tmpdir(), 'e2ed-')), port });
  try {
    assert.equal(a.port, port);
    assert.notEqual(b.port, port);
  } finally {
    await a.close();
    await b.close();
  }
});
```

- [ ] **Step 6: Chạy, xác nhận fail**

Run: `node --test test/main.test.mjs`
Expected: FAIL (cannot find module)

- [ ] **Step 7: Implement server main**

`server/main.mjs`:
```js
#!/usr/bin/env node
import http from 'node:http';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DATA_DIR, VERSION, readConfig } from '../reporter/e2e-dashboard.reporter.mjs';
import { createApp } from './app.mjs';
import { createLive } from './live.mjs';
import { watchReport, outputFromArtifactsRoot } from './watch.mjs';

const UI_DIR = fileURLToPath(new URL('../ui', import.meta.url));
const randomToken = () => randomBytes(24).toString('hex');

function listen(server, port) {
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', fail);
      ok(server.address().port);
    });
  });
}

export async function startServer({ projectRoot, port, token = randomToken(), uiDir = UI_DIR }) {
  const cfg = readConfig(projectRoot);
  const preferred = port ?? cfg.port ?? 4477;
  const live = createLive();
  const watcher = watchReport({ projectRoot, outputDir: resolve(projectRoot, cfg.output ?? '.e2e') });
  const app = createApp({
    projectRoot, token, uiDir, live,
    onEvent: (e) => {
      if (e?.type === 'run-started' && e.artifactsRoot) watcher.retarget(outputFromArtifactsRoot(e.artifactsRoot), e.artifactsRoot);
    },
  });
  const server = http.createServer(app);
  let bound;
  for (let p = preferred; ; p++) {
    try {
      bound = await listen(server, p);
      break;
    } catch (e) {
      if (e.code !== 'EADDRINUSE' || preferred === 0 || p >= preferred + 20) {
        watcher.close();
        throw e;
      }
    }
  }
  const infoPath = join(projectRoot, DATA_DIR, 'server.json');
  await mkdir(join(projectRoot, DATA_DIR), { recursive: true });
  await writeFile(infoPath, JSON.stringify({ port: bound, pid: process.pid, token, version: VERSION }), { mode: 0o600 });
  return {
    port: bound,
    token,
    url: `http://127.0.0.1:${bound}/?token=${token}`,
    async close() {
      watcher.close();
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
      await rm(infoPath, { force: true });
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const s = await startServer({ projectRoot: resolve(process.argv[2] ?? process.cwd()) });
  process.stdout.write(`${JSON.stringify({ port: s.port, url: s.url })}\n`);
  const stop = () => s.close().finally(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
```

- [ ] **Step 8: Chạy, xác nhận pass**

Run: `npm test`
Expected: tất cả PASS

- [ ] **Step 9: Commit**

```bash
git add server/watch.mjs server/main.mjs test/watch.test.mjs test/main.test.mjs
git commit -m "feat(server): report watcher and server process with server.json"
```

---

### Task 10: CLI `bin/dashboard.mjs` (start/stop/status/setup) + lệnh `/e2e-dashboard`

**Files:**
- Create: `bin/dashboard.mjs`, `commands/e2e-dashboard.md`
- Test: `test/dashboard.test.mjs`

**Interfaces:**
- Consumes: `findProjectRoot`, `findConfig` (Task 5); `readServerInfo`, `DATA_DIR` (Task 3/4); `server/main.mjs` chạy như process (Task 9)
- Produces:
  - `export function patchConfig(source) → { source, patched: boolean, reason?: 'already'|'unknown-shape' }`
  - `export async function setup(root) → string[]` (các dòng in ra; có dòng `NEEDS_MANUAL_EDIT` khi không tự sửa được config)
  - `export async function start(root, { open = true } = {}) → { url, reused: boolean }`
  - `export async function stop(root) → boolean`
  - `export async function main(argv, cwd) → { code: number, out: string }`; subcommand: (rỗng) | `setup` | `stop` | `status`. Task 13 thêm `export`.
  - File log server: `.e2e-dashboard/server.log` (stderr của server).

- [ ] **Step 1: Viết test**

`test/dashboard.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { patchConfig, setup, start, stop, main } from '../bin/dashboard.mjs';

const IMPORT = "import dashboardReporter from './e2e-dashboard.reporter.mjs';";

test('patchConfig adds the reporter to an existing reporters array', () => {
  const src = "import { web } from '@e2e-dev/web';\nexport default {\n  reporters: ['list', 'junit'],\n};\n";
  const r = patchConfig(src);
  assert.equal(r.patched, true);
  assert.ok(r.source.includes(IMPORT));
  assert.match(r.source, /reporters: \['list', 'junit', dashboardReporter\]/);
  assert.ok(r.source.indexOf(IMPORT) > r.source.indexOf("from '@e2e-dev/web'"));
});

test('patchConfig keeps list output when the config had no reporters', () => {
  for (const src of [
    "export default {\n  targets: [],\n} satisfies E2EConfig;\n",
    "import { defineConfig } from 'e2e';\nexport default defineConfig({\n  targets: [],\n});\n",
  ]) {
    const r = patchConfig(src);
    assert.equal(r.patched, true, src);
    assert.match(r.source, /reporters: \['list', dashboardReporter\],/);
  }
});

test('patchConfig is idempotent and refuses unknown shapes', () => {
  const once = patchConfig("export default {\n  targets: [],\n};\n").source;
  assert.deepEqual(patchConfig(once), { source: once, patched: false, reason: 'already' });
  const odd = 'const config = makeConfig();\nexport default config;\n';
  assert.deepEqual(patchConfig(odd), { source: odd, patched: false, reason: 'unknown-shape' });
});

function project(config = "export default {\n  targets: [],\n};\n") {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  writeFileSync(join(root, 'e2e.config.ts'), config);
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
  return root;
}

test('setup copies reporter + types, patches config, gitignore is idempotent', async () => {
  const root = project();
  await setup(root);
  await setup(root);
  assert.ok(existsSync(join(root, 'e2e-dashboard.reporter.mjs')));
  assert.ok(existsSync(join(root, 'e2e-dashboard.reporter.d.mts')));
  assert.match(readFileSync(join(root, 'e2e.config.ts'), 'utf8'), /dashboardReporter\]/);
  const gi = readFileSync(join(root, '.gitignore'), 'utf8');
  assert.equal(gi.split('\n').filter((l) => l === '.e2e-dashboard/').length, 1);
});

test('setup asks for a manual edit when the config shape is unknown', async () => {
  const root = project('export default makeConfig();\n');
  const lines = await setup(root);
  assert.ok(lines.some((l) => l.startsWith('NEEDS_MANUAL_EDIT')));
});

test('start spawns a detached server, second start reuses it, stop ends it', async () => {
  const root = project();
  const a = await start(root, { open: false });
  try {
    assert.equal(a.reused, false);
    assert.ok(readFileSync(join(root, '.gitignore'), 'utf8').split('\n').includes('.e2e-dashboard/'));
    const b = await start(root, { open: false });
    assert.equal(b.reused, true);
    assert.equal(b.url, a.url);
    const { token, port } = JSON.parse(readFileSync(join(root, '.e2e-dashboard/server.json'), 'utf8'));
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/info`, { headers: { 'x-e2e-dashboard-token': token } })).status, 200);
  } finally {
    assert.equal(await stop(root), true);
  }
  assert.equal(existsSync(join(root, '.e2e-dashboard/server.json')), false);
  assert.equal(await stop(root), false);
});

test('stale server.json (dead pid) is replaced', async () => {
  const root = project();
  await setup(root); // creates .e2e-dashboard/
  writeFileSync(join(root, '.e2e-dashboard/server.json'), JSON.stringify({ port: 1, pid: 2 ** 22 + 12345, token: 'x' }));
  const s = await start(root, { open: false });
  try {
    assert.equal(s.reused, false);
  } finally {
    await stop(root);
  }
});

test('main reports a missing e2e project', async () => {
  const r = await main([], mkdtempSync(join(tmpdir(), 'e2ed-')));
  assert.equal(r.code, 1);
  assert.match(r.out, /e2e\.config/);
});
```

- [ ] **Step 2: Chạy, xác nhận fail**

Run: `node --test test/dashboard.test.mjs`
Expected: FAIL (cannot find module)

- [ ] **Step 3: Implement**

`bin/dashboard.mjs`:
```js
#!/usr/bin/env node
// Entry for /e2e-dashboard: start | setup | stop | status (Task 13 adds export).
import { spawn } from 'node:child_process';
import { readFile, writeFile, copyFile, mkdir, rm, appendFile } from 'node:fs/promises';
import { existsSync, openSync, closeSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DATA_DIR, readServerInfo } from '../reporter/e2e-dashboard.reporter.mjs';
import { findProjectRoot, findConfig } from './project.mjs';

const PLUGIN = fileURLToPath(new URL('..', import.meta.url));
const MAIN = join(PLUGIN, 'server/main.mjs');
const REPORTER = join(PLUGIN, 'reporter/e2e-dashboard.reporter.mjs');
const IMPORT_LINE = "import dashboardReporter from './e2e-dashboard.reporter.mjs';";
const TYPES = "import type { Reporter } from 'e2e';\ndeclare const reporter: Reporter;\nexport default reporter;\n";

export function patchConfig(source) {
  if (source.includes('e2e-dashboard.reporter')) return { source, patched: false, reason: 'already' };
  let out = source;
  if (/reporters\s*:\s*\[/.test(out)) {
    out = out.replace(/(reporters\s*:\s*\[)([^\]]*)\]/, (_m, open, items) =>
      `${open}${items.trim() ? `${items.replace(/,?\s*$/, '')}, ` : ''}dashboardReporter]`);
  } else if (/export\s+default\s+(defineConfig\s*\(\s*)?\{/.test(out)) {
    out = out.replace(/export\s+default\s+(defineConfig\s*\(\s*)?\{/, (m) => `${m}\n  reporters: ['list', dashboardReporter],`);
  } else {
    return { source, patched: false, reason: 'unknown-shape' };
  }
  const imports = [...out.matchAll(/^import .*;\s*$/gm)];
  const at = imports.length ? imports.at(-1).index + imports.at(-1)[0].length : 0;
  out = at ? `${out.slice(0, at)}\n${IMPORT_LINE}${out.slice(at)}` : `${IMPORT_LINE}\n${out}`;
  return { source: out, patched: true };
}

async function ensureGitignore(root) {
  const p = join(root, '.gitignore');
  const cur = existsSync(p) ? await readFile(p, 'utf8') : '';
  if (cur.split(/\r?\n/).includes(`${DATA_DIR}/`)) return;
  await appendFile(p, `${cur && !cur.endsWith('\n') ? '\n' : ''}${DATA_DIR}/\n`);
}

export async function setup(root) {
  const lines = [];
  await mkdir(join(root, DATA_DIR), { recursive: true });
  await copyFile(REPORTER, join(root, 'e2e-dashboard.reporter.mjs'));
  await writeFile(join(root, 'e2e-dashboard.reporter.d.mts'), TYPES);
  await ensureGitignore(root);
  lines.push('Đã copy e2e-dashboard.reporter.mjs (+ .d.mts) vào project — hãy commit 2 file này.');
  const configPath = findConfig(root);
  const r = patchConfig(await readFile(configPath, 'utf8'));
  if (r.patched) {
    await writeFile(configPath, r.source);
    lines.push(`Đã thêm reporter vào ${basename(configPath)}.`);
  } else if (r.reason === 'already') {
    lines.push(`${basename(configPath)} đã có reporter.`);
  } else {
    lines.push(
      `NEEDS_MANUAL_EDIT ${configPath}`,
      `Thêm dòng import: ${IMPORT_LINE}`,
      "Thêm dashboardReporter vào mảng reporters (nếu chưa có mảng: reporters: ['list', dashboardReporter]).",
    );
  }
  return lines;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

async function running(root) {
  const s = readServerInfo(root);
  if (!s?.pid || !alive(s.pid)) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${s.port}/api/info`, { headers: { 'x-e2e-dashboard-token': s.token }, signal: AbortSignal.timeout(2000) });
    return res.ok ? s : null;
  } catch {
    return null;
  }
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch {
    // no browser available (SSH, container); the URL is printed anyway
  }
}

export async function start(root, { open = true } = {}) {
  const existing = await running(root);
  if (existing) {
    const url = `http://127.0.0.1:${existing.port}/?token=${existing.token}`;
    if (open) openBrowser(url);
    return { url, reused: true };
  }
  await mkdir(join(root, DATA_DIR), { recursive: true });
  await ensureGitignore(root); // the dashboard creates .e2e-dashboard/ in the user's repo
  await rm(join(root, DATA_DIR, 'server.json'), { force: true });
  const log = openSync(join(root, DATA_DIR, 'server.log'), 'a');
  const child = spawn(process.execPath, [MAIN, root], { cwd: root, detached: true, stdio: ['ignore', 'pipe', log] });
  closeSync(log);
  const line = await new Promise((ok, fail) => {
    let buf = '';
    const timer = setTimeout(() => fail(new Error('server không khởi động sau 10 s, xem .e2e-dashboard/server.log')), 10_000);
    child.stdout.on('data', (c) => {
      buf += c;
      const i = buf.indexOf('\n');
      if (i >= 0) {
        clearTimeout(timer);
        ok(buf.slice(0, i));
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      fail(new Error(`server thoát với mã ${code}, xem .e2e-dashboard/server.log`));
    });
  });
  child.stdout.destroy();
  child.unref();
  const { url } = JSON.parse(line);
  if (open) openBrowser(url);
  return { url, reused: false };
}

export async function stop(root) {
  const s = readServerInfo(root);
  if (!s?.pid || !alive(s.pid)) {
    await rm(join(root, DATA_DIR, 'server.json'), { force: true });
    return false;
  }
  process.kill(s.pid, 'SIGTERM');
  for (let i = 0; i < 30 && alive(s.pid); i++) await new Promise((r) => setTimeout(r, 100));
  await rm(join(root, DATA_DIR, 'server.json'), { force: true });
  return true;
}

export async function main(argv, cwd) {
  const root = findProjectRoot(cwd);
  if (!root) return { code: 1, out: 'Không tìm thấy e2e.config.(ts|mts|js|mjs) từ thư mục hiện tại trở lên. Chạy `npx e2e init` trước.' };
  const [cmd = 'start'] = argv;
  if (cmd === 'start' || cmd === 'open') {
    const { url, reused } = await start(root, { open: !process.env.E2E_DASHBOARD_NO_OPEN });
    const lines = [`Dashboard${reused ? ' (đang chạy sẵn)' : ''}: ${url}`];
    if (!existsSync(join(root, 'e2e-dashboard.reporter.mjs'))) lines.push('Gợi ý: chạy `/e2e-dashboard setup` để xem tiến độ live.');
    return { code: 0, out: lines.join('\n') };
  }
  if (cmd === 'setup') return { code: 0, out: (await setup(root)).join('\n') };
  if (cmd === 'stop') return { code: 0, out: (await stop(root)) ? 'Đã tắt dashboard.' : 'Dashboard không chạy.' };
  if (cmd === 'status') {
    const s = await running(root);
    return { code: 0, out: s ? `Đang chạy: http://127.0.0.1:${s.port}/?token=${s.token}` : 'Dashboard không chạy.' };
  }
  return { code: 1, out: 'Dùng: /e2e-dashboard [setup|export [runId]|stop|status]' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await main(process.argv.slice(2), process.cwd()).catch((e) => ({ code: 1, out: `Lỗi: ${e.message}` }));
  process.stdout.write(`${r.out}\n`);
  process.exit(r.code);
}
```

`commands/e2e-dashboard.md`:
```markdown
---
description: Mở dashboard e2e (live, lịch sử, debug). Tham số tuỳ chọn: setup | export [runId] | stop | status
argument-hint: "[setup|export [runId]|stop|status]"
allowed-tools: Bash(node:*), Read, Edit
---

## Kết quả

!`node "${CLAUDE_PLUGIN_ROOT}/bin/dashboard.mjs" $ARGUMENTS`

## Việc của bạn

- Báo lại kết quả trên cho người dùng trong 1–3 dòng, giữ nguyên URL nếu có.
- Nếu kết quả có dòng `NEEDS_MANUAL_EDIT <file>`: mở file config đó, thêm dòng import được in ra và thêm `dashboardReporter` vào mảng `reporters` (nếu config chưa có mảng `reporters` thì thêm `reporters: ['list', dashboardReporter]` để không mất output terminal). Sau đó báo lại.
- Không làm việc gì khác.
```

- [ ] **Step 4: Chạy, xác nhận pass**

Run: `npm test`
Expected: tất cả PASS

- [ ] **Step 5: Commit**

```bash
git add bin/dashboard.mjs commands/e2e-dashboard.md test/dashboard.test.mjs
git commit -m "feat(cli): /e2e-dashboard start, stop, status and setup"
```

---

### Task 11: UI thuần — `format.js` + `model.js`

**Files:**
- Create: `ui/format.js`, `ui/model.js`
- Test: `test/ui-model.test.mjs`

Các file trong `ui/` là ES module thuần, chạy được cả trong Node (`package.json` có `"type": "module"`) nên test bằng `node --test`. Tuân thủ quy ước bundle ở Task 8.

**Interfaces:**
- Produces (`ui/format.js`):
  - `escapeHtml(s) → string`
  - `fmtDuration(ms) → string` (`null` → `—`, `<1000` → `850ms`, `<60s` → `12.3s`, `<1h` → `2m14s`, còn lại `1h02m`)
  - `fmtTokens(n) → string` (`950`, `48k`, `1.3M` cho 1 250 000)
  - `fmtRelative(iso, now = Date.now()) → string` (`vừa xong`, `5 phút trước`, `3 giờ trước`, `2 ngày trước`)
  - `STATUS: Record<status, { icon, label }>` cho `passed, failed, flaky, timed-out, interrupted, skipped, blocked, cancelled, error, running`
  - `statusBadge(status) → string` HTML `<span class="badge s-<status>">icon label</span>`
- Produces (`ui/model.js`):
  - `flattenResults(report) → Row[]`; `Row = { id, testId, title, titlePath, file, line, target, agent, repeat, tags, status, kind, durationMs, attempts: Attempt[] }`. Test trong serial group (attempts rỗng) lấy attempt từ `run.serialGroups[].attempts[].members[]` (khớp `serialGroupId`, nếu không có thì khớp `memberTestIds` + target + agent + repeat); attempt dựng lại có `serial: true` và `artifacts` của attempt nhóm.
  - `facets(rows) → { tags, files, targets, agents, statuses }` (mảng đã sort, không trùng)
  - `applyFilters(rows, filters) → Row[]`; `filters = { tags?, files?, targets?, agents?, statuses? }`, mảng rỗng/thiếu = không lọc; `tags` khớp nếu row có ít nhất một tag.
  - `matrix(rows) → { targets: string[], rows: Array<{ testId, title, cells: Record<target, Row> }> }`
  - `isFailure(status) → boolean` (`failed | timed-out | interrupted | flaky`)
  - `stepVideoOffset(step, video, attempt) → number|null` (giây từ đầu video; âm hoặc thiếu mốc → null)

- [ ] **Step 1: Viết test**

`test/ui-model.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fmtDuration, fmtTokens, fmtRelative, escapeHtml, statusBadge } from '../ui/format.js';
import { flattenResults, facets, applyFilters, matrix, stepVideoOffset, isFailure } from '../ui/model.js';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));

test('format helpers', () => {
  assert.equal(fmtDuration(null), '—');
  assert.equal(fmtDuration(850), '850ms');
  assert.equal(fmtDuration(12_340), '12.3s');
  assert.equal(fmtDuration(134_000), '2m14s');
  assert.equal(fmtDuration(3_720_000), '1h02m');
  assert.equal(fmtTokens(950), '950');
  assert.equal(fmtTokens(48_200), '48k');
  assert.equal(fmtTokens(1_250_000), '1.3M');
  const now = Date.parse('2026-07-24T12:00:00Z');
  assert.equal(fmtRelative('2026-07-24T11:59:40Z', now), 'vừa xong');
  assert.equal(fmtRelative('2026-07-24T11:55:00Z', now), '5 phút trước');
  assert.equal(fmtRelative('2026-07-24T09:00:00Z', now), '3 giờ trước');
  assert.equal(fmtRelative('2026-07-22T12:00:00Z', now), '2 ngày trước');
  assert.equal(escapeHtml(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.match(statusBadge('failed'), /class="badge s-failed".*✗/);
  assert.match(statusBadge('<x>'), /&lt;x&gt;/);
});

test('flattenResults maps results with title, line and duration', () => {
  const rows = flattenResults(fixture());
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, 'opens app');
  assert.equal(rows[0].line, 3);
  assert.equal(rows[0].target, 'web');
  assert.equal(rows[0].durationMs, 1000);
});

test('flattenResults rebuilds serial-group attempts from members', () => {
  const r = fixture();
  const res = r.run.results[0];
  res.attempts = [];
  res.serialGroupId = 'g1';
  r.run.serialGroups = [{
    id: 'g1', serialId: 's', declarationIndex: 0, file: res.file, source: res.source, titlePath: ['group'],
    targetId: 'web', platform: 'web', memberTestIds: [res.testId], status: 'failed',
    attempts: [{
      id: 'ga1', index: 0, status: 'failed', startedAt: '2026-07-24T12:00:00.000Z', durationMs: 500,
      artifacts: [{ id: 'v', kind: 'video', mediaType: 'video/webm', path: 'g/video.webm', redaction: 'complete', producer: { kind: 'attempt' } }],
      secondaryErrors: [], cleanup: 'complete',
      members: [{ id: 'm1', index: 0, testId: res.testId, status: 'failed', startedAt: '2026-07-24T12:00:00.000Z', durationMs: 500, steps: [{ id: 's1', label: 'x' }], secondaryErrors: [] }],
    }],
  }];
  const row = flattenResults(r).find((x) => x.id === res.id);
  assert.equal(row.attempts.length, 1);
  assert.equal(row.attempts[0].serial, true);
  assert.equal(row.attempts[0].steps[0].id, 's1');
  assert.equal(row.attempts[0].artifacts[0].path, 'g/video.webm');
  assert.equal(row.durationMs, 500);
});

test('facets, filters and matrix', () => {
  const rows = flattenResults(fixture());
  rows.push({ ...rows[0], id: 'z', target: 'webkit', status: 'failed', tags: [] });
  const f = facets(rows);
  assert.deepEqual(f.targets, ['web', 'webkit']);
  assert.deepEqual(f.tags, ['smoke']);
  assert.equal(applyFilters(rows, {}).length, 3);
  assert.equal(applyFilters(rows, { targets: ['webkit'] }).length, 1);
  assert.equal(applyFilters(rows, { tags: ['smoke'], statuses: ['passed'] }).length, 1);
  const m = matrix(rows);
  assert.deepEqual(m.targets, ['web', 'webkit']);
  const opens = m.rows.find((r) => r.title === 'opens app');
  assert.equal(opens.cells.webkit.status, 'failed');
});

test('isFailure and stepVideoOffset', () => {
  assert.ok(isFailure('timed-out') && isFailure('flaky') && !isFailure('passed') && !isFailure('skipped'));
  const attempt = { startedAt: '2026-07-24T12:00:00.000Z' };
  const video = { startedAt: '2026-07-24T12:00:01.000Z' };
  assert.equal(stepVideoOffset({ startedAt: '2026-07-24T12:00:03.500Z' }, video, attempt), 2.5);
  assert.equal(stepVideoOffset({ startedAt: '2026-07-24T12:00:03.500Z' }, {}, attempt), 3.5);
  assert.equal(stepVideoOffset({ startedAt: '2026-07-24T12:00:00.500Z' }, video, attempt), null);
  assert.equal(stepVideoOffset({}, video, attempt), null);
});
```

- [ ] **Step 2: Chạy, xác nhận fail**

Run: `node --test test/ui-model.test.mjs`
Expected: FAIL (cannot find module `../ui/format.js`)

- [ ] **Step 3: Implement**

`ui/format.js`:
```js
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function fmtDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}s`;
  return `${Math.floor(ms / 3_600_000)}h${String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0')}m`;
}

export function fmtTokens(n) {
  if (n == null) return '—';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function fmtRelative(iso, now = Date.now()) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86_400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86_400)} ngày trước`;
}

export const STATUS = {
  passed: { icon: '✓', label: 'passed' },
  failed: { icon: '✗', label: 'failed' },
  flaky: { icon: '⚠', label: 'flaky' },
  'timed-out': { icon: '⏱', label: 'timed out' },
  interrupted: { icon: '⏹', label: 'interrupted' },
  skipped: { icon: '⤼', label: 'skipped' },
  blocked: { icon: '⛔', label: 'blocked' },
  cancelled: { icon: '⊘', label: 'cancelled' },
  error: { icon: '✗', label: 'error' },
  running: { icon: '●', label: 'running' },
};

export function statusBadge(status) {
  const s = STATUS[status] ?? { icon: '?', label: status };
  return `<span class="badge s-${escapeHtml(status)}">${s.icon} ${escapeHtml(s.label)}</span>`;
}
```

`ui/model.js`:
```js
const sumDuration = (attempts) => attempts.reduce((s, a) => s + (a.durationMs ?? 0), 0);

function serialAttempts(report, r) {
  const g = (report.run.serialGroups ?? []).find((x) =>
    r.serialGroupId
      ? x.id === r.serialGroupId
      : x.memberTestIds?.includes(r.testId) && x.targetId === r.targetId &&
        (x.agent ?? 'default') === (r.agent ?? 'default') && (x.repeat ?? 0) === (r.repeat ?? 0));
  if (!g) return [];
  return (g.attempts ?? []).flatMap((ga) =>
    (ga.members ?? [])
      .filter((m) => m.testId === r.testId)
      .map((m) => ({ ...m, memberId: m.id, id: ga.id, index: ga.index, artifacts: ga.artifacts ?? [], serial: true })));
}

export function flattenResults(report) {
  return (report.run.results ?? []).map((r) => {
    const attempts = r.attempts?.length ? r.attempts : serialAttempts(report, r);
    return {
      id: r.id,
      testId: r.testId,
      title: r.titlePath.join(' › '),
      titlePath: r.titlePath,
      file: r.source?.file ?? r.file,
      line: r.source?.line ?? null,
      target: r.targetId,
      agent: r.agent ?? 'default',
      repeat: r.repeat ?? 0,
      tags: r.tags ?? [],
      status: r.status,
      kind: r.kind,
      durationMs: sumDuration(attempts),
      attempts,
    };
  });
}

const uniq = (xs) => [...new Set(xs)].sort();

export function facets(rows) {
  return {
    tags: uniq(rows.flatMap((r) => r.tags)),
    files: uniq(rows.map((r) => r.file)),
    targets: uniq(rows.map((r) => r.target)),
    agents: uniq(rows.map((r) => r.agent)),
    statuses: uniq(rows.map((r) => r.status)),
  };
}

export function applyFilters(rows, { tags = [], files = [], targets = [], agents = [], statuses = [] } = {}) {
  const has = (list, v) => !list.length || list.includes(v);
  return rows.filter(
    (r) => has(files, r.file) && has(targets, r.target) && has(agents, r.agent) && has(statuses, r.status) &&
      (!tags.length || r.tags.some((t) => tags.includes(t))));
}

export function matrix(rows) {
  const targets = uniq(rows.map((r) => r.target));
  const byTest = new Map();
  for (const r of rows) {
    const k = `${r.testId}|${r.agent}|${r.repeat}`;
    if (!byTest.has(k)) byTest.set(k, { testId: r.testId, title: r.title, cells: {} });
    byTest.get(k).cells[r.target] = r;
  }
  return { targets, rows: [...byTest.values()] };
}

export function isFailure(status) {
  return ['failed', 'timed-out', 'interrupted', 'flaky'].includes(status);
}

export function stepVideoOffset(step, video, attempt) {
  const origin = Date.parse(video?.startedAt ?? attempt?.startedAt);
  const t = Date.parse(step?.startedAt);
  if (Number.isNaN(origin) || Number.isNaN(t) || t < origin) return null;
  return (t - origin) / 1000;
}
```

- [ ] **Step 4: Chạy, xác nhận pass**

Run: `npm test`
Expected: tất cả PASS

- [ ] **Step 5: Commit**

```bash
git add ui/format.js ui/model.js test/ui-model.test.mjs
git commit -m "feat(ui): formatting helpers and report view model"
```

---

### Task 12: UI thuần — `markdown.js` + `charts.js`

**Files:**
- Create: `ui/markdown.js`, `ui/charts.js`
- Test: `test/ui-render.test.mjs`

**Interfaces:**
- Consumes: `escapeHtml`, `STATUS` (Task 11)
- Produces (`ui/markdown.js`):
  - `renderMarkdown(src) → string` HTML an toàn: `#`–`###`, đoạn văn, list `-`/`*`/`1.`, code fence ``` ```, inline `` `code` ``, `**đậm**`, `*nghiêng*`, `[text](url)` chỉ khi url là `http(s)://`, `/`, `#` hoặc tương đối không có scheme. Mọi thứ khác được escape. (Dùng cho `trace.md` ở M1a, kết quả AI ở M1b.)
- Produces (`ui/charts.js`):
  - `lineChart({ points: Array<{ label, value: number|null, tip }>, yMax?, yFormat = String, ariaLabel }) → string` SVG (viewBox 600×180). Đường 2px, marker r=4, nhãn trực tiếp chỉ ở điểm cuối, 3 gridline mờ, ô hover trong suốt theo từng cột x (`data-tip`). `value: null` làm đứt đường.
  - `stackedBarChart({ bars: Array<{ label, segments: Record<key, number>, tip }>, keys: string[], ariaLabel }) → string` SVG. Khe 2px giữa các segment, bo 4px ở đầu trên cùng của mỗi cột, segment `failed` có thêm sọc (`url(#hatch)`), ô hover theo cột.
  - `legend(keys) → string` HTML: swatch + icon + nhãn (màu không bao giờ đứng một mình).
  - `attachTooltips(root)` — gắn một tooltip nổi cho mọi `[data-tip]` trong `root` (DOM, không unit test).
  - Rỗng (không có điểm/cột nào) → `<p class="empty">Chưa có dữ liệu</p>`.
  - Màu chỉ qua class CSS (`.s-passed`…, `.series-1`), giá trị nằm trong `style.css` (Task 13).

- [ ] **Step 1: Viết test**

`test/ui-render.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../ui/markdown.js';
import { lineChart, stackedBarChart, legend } from '../ui/charts.js';

test('markdown renders the supported subset', () => {
  const html = renderMarkdown('# Tiêu đề\n\nĐoạn **đậm** và *nghiêng* với `code`.\n\n- một\n- hai\n\n1. a\n2. b\n\n```js\nconst x = 1 < 2;\n```\n\n[docs](https://e2e.tester.army)');
  assert.match(html, /<h1>Tiêu đề<\/h1>/);
  assert.match(html, /<strong>đậm<\/strong>/);
  assert.match(html, /<em>nghiêng<\/em>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<ul><li>một<\/li><li>hai<\/li><\/ul>/);
  assert.match(html, /<ol><li>a<\/li><li>b<\/li><\/ol>/);
  assert.match(html, /<pre><code>const x = 1 &lt; 2;\n<\/code><\/pre>/);
  assert.match(html, /<a href="https:\/\/e2e\.tester\.army" rel="noopener noreferrer" target="_blank">docs<\/a>/);
});

test('markdown never emits raw HTML or script links', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert(1)) [y](data:text/html,hi) <img src=x onerror=alert(1)>');
  assert.doesNotMatch(html, /<script|<img|href="javascript|href="data/);
  assert.match(html, /&lt;script&gt;/);
});

test('lineChart draws one marker per non-null point and breaks on null', () => {
  const svg = lineChart({ points: [{ label: 'a', value: 1 }, { label: 'b', value: null }, { label: 'c', value: 3 }], ariaLabel: 'pass rate' });
  assert.match(svg, /^<svg[^>]*role="img"[^>]*aria-label="pass rate"/);
  assert.equal((svg.match(/<circle /g) ?? []).length, 2);
  assert.equal((svg.match(/<path class="line/g) ?? []).length, 2);
  assert.equal((svg.match(/data-tip=/g) ?? []).length, 3);
  assert.doesNotMatch(svg, /NaN/);
});

test('stackedBarChart draws segments, hatches failures, escapes labels', () => {
  const svg = stackedBarChart({
    bars: [{ label: '<run>', segments: { passed: 3, failed: 1, skipped: 0 }, tip: '<b>' }, { label: 'r2', segments: { passed: 0, failed: 0 } }],
    keys: ['passed', 'flaky', 'failed', 'skipped'],
    ariaLabel: 'kết quả',
  });
  assert.equal((svg.match(/class="seg s-/g) ?? []).length, 2);
  assert.match(svg, /fill="url\(#hatch\)"/);
  assert.doesNotMatch(svg, /<run>|<b>|NaN/);
});

test('empty charts and legend', () => {
  assert.match(lineChart({ points: [] }), /Chưa có dữ liệu/);
  assert.match(stackedBarChart({ bars: [], keys: ['passed'] }), /Chưa có dữ liệu/);
  assert.match(legend(['passed', 'failed']), /✓ passed.*✗ failed/s);
});
```

- [ ] **Step 2: Chạy, xác nhận fail**

Run: `node --test test/ui-render.test.mjs`
Expected: FAIL (cannot find module)

- [ ] **Step 3: Implement**

`ui/markdown.js`:
```js
import { escapeHtml } from './format.js';

function safeHref(url) {
  if (/^https?:\/\//i.test(url) || /^[/#]/.test(url)) return url;
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? null : url; // relative path without a scheme
}

function inline(text) {
  const codes = [];
  let s = escapeHtml(text).replace(/`([^`]+)`/g, (_m, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
      const ok = safeHref(href.replace(/&amp;/g, '&'));
      return ok ? `<a href="${escapeHtml(ok)}" rel="noopener noreferrer" target="_blank">${label}</a>` : label;
    });
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => `<code>${codes[i]}</code>`);
}

export function renderMarkdown(src) {
  const out = [];
  const lines = String(src ?? '').replace(/\r\n/g, '\n').split('\n');
  let para = [];
  let list = null; // { tag, items }
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      flushPara();
      flushList();
      const code = [];
      while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i]);
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}\n</code></pre>`);
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    } else if (ul || ol) {
      flushPara();
      const tag = ul ? 'ul' : 'ol';
      if (list?.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push((ul ?? ol)[1]);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return out.join('\n');
}
```

`ui/charts.js`:
```js
import { escapeHtml, STATUS } from './format.js';

const W = 600;
const H = 180;
const PAD = { top: 12, right: 48, bottom: 24, left: 40 };
const EMPTY = '<p class="empty">Chưa có dữ liệu</p>';
const svgOpen = (label) =>
  `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(label ?? '')}" class="chart">`;

function grid(yMax, yFormat) {
  const ih = H - PAD.top - PAD.bottom;
  return [0, 0.5, 1]
    .map((f) => {
      const y = PAD.top + ih * (1 - f);
      return `<line class="grid" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y}" y2="${y}"/>` +
        `<text class="axis" x="${PAD.left - 6}" y="${y + 4}" text-anchor="end">${escapeHtml(yFormat(yMax * f))}</text>`;
    })
    .join('');
}

export function lineChart({ points = [], yMax, yFormat = String, ariaLabel } = {}) {
  if (!points.length) return EMPTY;
  const values = points.map((p) => p.value).filter((v) => v != null);
  const max = yMax ?? Math.max(1, ...values);
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const step = points.length > 1 ? iw / (points.length - 1) : 0;
  const x = (i) => PAD.left + (points.length > 1 ? i * step : iw / 2);
  const y = (v) => PAD.top + ih * (1 - v / max);
  const segments = [];
  let cur = [];
  points.forEach((p, i) => {
    if (p.value == null) {
      if (cur.length) segments.push(cur);
      cur = [];
    } else cur.push([x(i), y(p.value)]);
  });
  if (cur.length) segments.push(cur);
  const lines = segments
    .map((s) => `<path class="line series-1" d="M${s.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join('L')}"/>`)
    .join('');
  const dots = points
    .map((p, i) => (p.value == null ? '' : `<circle class="dot series-1" cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4"/>`))
    .join('');
  const lastIdx = points.findLastIndex((p) => p.value != null);
  const last = lastIdx >= 0
    ? `<text class="label" x="${(x(lastIdx) + 8).toFixed(1)}" y="${(y(points[lastIdx].value) + 4).toFixed(1)}">${escapeHtml(yFormat(points[lastIdx].value))}</text>`
    : '';
  const band = Math.max(step, 8);
  const hits = points
    .map((p, i) => `<rect class="hit" x="${(x(i) - band / 2).toFixed(1)}" y="0" width="${band.toFixed(1)}" height="${H}" data-tip="${escapeHtml(p.tip ?? `${p.label}: ${p.value == null ? '—' : yFormat(p.value)}`)}"/>`)
    .join('');
  return `${svgOpen(ariaLabel)}${grid(max, yFormat)}${lines}${dots}${last}${hits}</svg>`;
}

// Rect with only the top corners rounded (the data end of a vertical bar).
function topRounded(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function stackedBarChart({ bars = [], keys = [], ariaLabel } = {}) {
  if (!bars.length) return EMPTY;
  const totals = bars.map((b) => keys.reduce((s, k) => s + (b.segments[k] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const slot = iw / bars.length;
  const bw = Math.max(2, Math.min(24, slot - 4));
  const marks = bars
    .map((b, i) => {
      const bx = PAD.left + i * slot + (slot - bw) / 2;
      let base = PAD.top + ih;
      const present = keys.filter((k) => (b.segments[k] ?? 0) > 0);
      const segs = present
        .map((k, j) => {
          const h = Math.max(1, (b.segments[k] / max) * ih - (j ? 2 : 0)); // 2px surface gap between segments
          base -= h + (j ? 2 : 0);
          const top = j === present.length - 1;
          const d = top ? topRounded(bx, base, bw, h, 4) : `M${bx},${base}h${bw}v${h}h${-bw}Z`;
          const hatch = k === 'failed' ? `<path class="hatch" d="${d}" fill="url(#hatch)"/>` : '';
          return `<path class="seg s-${escapeHtml(k)}" d="${d}"/>${hatch}`;
        })
        .join('');
      const tip = b.tip ?? `${b.label}: ${present.map((k) => `${b.segments[k]} ${STATUS[k]?.label ?? k}`).join(', ') || 'không có test'}`;
      return `${segs}<rect class="hit" x="${(PAD.left + i * slot).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${H}" data-tip="${escapeHtml(tip)}"/>`;
    })
    .join('');
  const defs = '<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line class="hatch-line" x1="0" y1="0" x2="0" y2="6"/></pattern></defs>';
  return `${svgOpen(ariaLabel)}${defs}${grid(max, (v) => String(Math.round(v)))}${marks}</svg>`;
}

export function legend(keys) {
  return `<div class="legend">${keys
    .map((k) => `<span><i class="swatch s-${escapeHtml(k)}"></i>${STATUS[k]?.icon ?? ''} ${escapeHtml(STATUS[k]?.label ?? k)}</span>`)
    .join('')}</div>`;
}

export function attachTooltips(root) {
  let tip = document.getElementById('chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'chart-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.append(tip);
  }
  root.addEventListener('pointermove', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (!el) return void (tip.hidden = true);
    tip.textContent = el.getAttribute('data-tip');
    tip.hidden = false;
    tip.style.left = `${e.clientX + 12}px`;
    tip.style.top = `${e.clientY + 12}px`;
  });
  root.addEventListener('pointerleave', () => (tip.hidden = true));
}
```

- [ ] **Step 4: Chạy, xác nhận pass**

Run: `npm test`
Expected: tất cả PASS

- [ ] **Step 5: Commit**

```bash
git add ui/markdown.js ui/charts.js test/ui-render.test.mjs
git commit -m "feat(ui): safe markdown renderer and SVG charts"
```

---

### Task 13: Khung UI + Overview + Runs + dữ liệu demo

**Files:**
- Create: `ui/api.js`, `ui/router.js`, `ui/views/overview.js`, `test/seed-demo.mjs`
- Modify: `ui/app.js` (thay bản tạm), `ui/style.css` (thay bản tạm)
- Test: `test/ui-shell.test.mjs`

**Interfaces:**
- Consumes: `fmtDuration, fmtTokens, fmtRelative, statusBadge, escapeHtml` (Task 11); `lineChart, stackedBarChart, legend, attachTooltips` (Task 12); API của Task 8
- Produces:
  - `ui/api.js`: `isExport()`, `getJson(path)`, `postJson(path, body)`, `encodePath(rel)`, `fileUrl(runId, rel) → string|null`, `liveStream(onSnapshot) → stop()`. Ở chế độ export đọc từ `globalThis.__E2ED_EXPORT__ = { api: { [path]: json }, files: { ['runs/<id>/<rel>']: dataUri }, exportedAt }` (Task 16 tạo ra object này).
  - `ui/router.js`: `parseRoute(hash) → { view: 'overview'|'runs'|'run'|'live'|'tests'|'notfound', runId?, resultId? }`, `runHref(runId, resultId?) → string`
  - `ui/views/overview.js`: `passRate(meta) → number|null` (0–1, `(passed+flaky)/(passed+flaky+failed+interrupted)`), `runTable(metas) → string`, `renderOverview(main) → cleanup|undefined`, `renderRunsPage(main)`
  - View contract (mọi view): `async function renderX(main, route) → (() => void) | undefined` (hàm trả về dùng để dọn dẹp khi rời trang)
  - `ui/app.js` import `renderRun` từ `./views/run.js` (Task 14), `renderLive` từ `./views/live.js`, `renderTests` từ `./views/tests.js` (Task 15). Ở Task 13 tạo **stub tối thiểu** cho 3 file đó (xem Step 3) để bundle chạy được; Task 14–15 thay toàn bộ nội dung.
  - `test/seed-demo.mjs`: `node test/seed-demo.mjs [dir]` tạo project demo (e2e.config.ts + 12 run đa dạng đã archive) và in đường dẫn.

- [ ] **Step 1: Viết test**

`test/ui-shell.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, runHref } from '../ui/router.js';
import { passRate, runTable } from '../ui/views/overview.js';
import { fileURLToPath } from 'node:url';
import { bundleUi } from '../ui/bundle.mjs';

// All ui/ modules share one scope after bundling: duplicate top-level names are a SyntaxError here.
test('the real UI bundle compiles', async () => {
  const code = await bundleUi(fileURLToPath(new URL('../ui', import.meta.url)));
  assert.doesNotThrow(() => new Function(code));
});

test('parseRoute covers every view and deep links', () => {
  assert.deepEqual(parseRoute(''), { view: 'overview' });
  assert.deepEqual(parseRoute('#/'), { view: 'overview' });
  assert.deepEqual(parseRoute('#/runs'), { view: 'runs' });
  assert.deepEqual(parseRoute('#/live'), { view: 'live' });
  assert.deepEqual(parseRoute('#/tests'), { view: 'tests' });
  assert.deepEqual(parseRoute('#/run/abc'), { view: 'run', runId: 'abc', resultId: null });
  assert.deepEqual(parseRoute('#/run/abc/test/r%201'), { view: 'run', runId: 'abc', resultId: 'r 1' });
  assert.deepEqual(parseRoute('#/nope'), { view: 'notfound' });
  assert.equal(runHref('abc', 'r 1'), '#/run/abc/test/r%201');
  assert.equal(runHref('abc'), '#/run/abc');
});

test('passRate counts flaky as passed and ignores skipped', () => {
  assert.equal(passRate({ summary: { passed: 3, flaky: 1, failed: 1, interrupted: 0, skipped: 5 } }), 0.8);
  assert.equal(passRate({ summary: { passed: 0, flaky: 0, failed: 0, interrupted: 0, skipped: 2 } }), null);
});

test('runTable links each run and escapes branch names', () => {
  const html = runTable([{
    runId: 'r1', status: 'failed', startedAt: new Date().toISOString(), durationMs: 2000,
    summary: { passed: 1, failed: 2, flaky: 0, skipped: 0, interrupted: 0 }, tokens: { input: 10, output: 5 },
    git: { branch: '<b>', commit: 'a'.repeat(40), dirty: true }, source: 'hook', pinned: true,
  }]);
  assert.match(html, /href="#\/run\/r1"/);
  assert.match(html, /&lt;b&gt;@aaaaaaa/);
  assert.match(html, /📌/);
});
```

- [ ] **Step 2: Chạy, xác nhận fail**

Run: `node --test test/ui-shell.test.mjs`
Expected: FAIL (cannot find module `../ui/router.js`)

- [ ] **Step 3: Implement**

`ui/api.js`:
```js
const EXPORT = globalThis.__E2ED_EXPORT__ ?? null;

export function isExport() {
  return Boolean(EXPORT);
}

export async function getJson(path) {
  if (EXPORT) {
    if (!(path in EXPORT.api)) throw new Error('Không có trong bản export');
    return structuredClone(EXPORT.api[path]);
  }
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

export async function postJson(path, body) {
  if (EXPORT) throw new Error('Bản export chỉ đọc');
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

export function encodePath(rel) {
  return rel.split('/').map(encodeURIComponent).join('/');
}

export function fileUrl(runId, rel) {
  if (!rel) return null;
  const key = `runs/${runId}/${rel}`;
  if (EXPORT) return EXPORT.files[key] ?? null;
  return `/files/${encodePath(key)}`;
}

export function liveStream(onSnapshot) {
  if (EXPORT) return () => {};
  const es = new EventSource('/api/live');
  es.onmessage = (e) => onSnapshot(JSON.parse(e.data));
  return () => es.close();
}
```

`ui/router.js`:
```js
export function parseRoute(hash) {
  const parts = (hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return { view: 'overview' };
  if (parts[0] === 'runs' || parts[0] === 'live' || parts[0] === 'tests') return { view: parts[0] };
  if (parts[0] === 'run' && parts[1]) return { view: 'run', runId: parts[1], resultId: parts[2] === 'test' ? parts[3] ?? null : null };
  return { view: 'notfound' };
}

export function runHref(runId, resultId) {
  return `#/run/${encodeURIComponent(runId)}${resultId ? `/test/${encodeURIComponent(resultId)}` : ''}`;
}
```

`ui/views/overview.js`:
```js
import { getJson } from '../api.js';
import { lineChart, stackedBarChart, legend } from '../charts.js';
import { fmtDuration, fmtTokens, fmtRelative, statusBadge, escapeHtml } from '../format.js';
import { runHref } from '../router.js';

const RUN_KEYS = ['passed', 'flaky', 'failed', 'interrupted', 'skipped'];
const EMPTY_RUNS = '<div class="empty-state"><h2>Chưa có run nào</h2><p>Chạy <code>npx e2e run</code> (hoặc nhờ Claude chạy) — run sẽ tự xuất hiện ở đây.</p></div>';

export function passRate(meta) {
  const s = meta.summary ?? {};
  const ok = (s.passed ?? 0) + (s.flaky ?? 0);
  const done = ok + (s.failed ?? 0) + (s.interrupted ?? 0);
  return done ? ok / done : null;
}

function countsCell(s = {}) {
  return RUN_KEYS.filter((k) => s[k]).map((k) => `<span class="count s-${k}">${s[k]}</span>`).join(' ') || '—';
}

function gitCell(git) {
  if (!git?.commit) return '—';
  return `${escapeHtml(git.branch ?? '?')}@${escapeHtml(git.commit.slice(0, 7))}${git.dirty ? ' <span title="có thay đổi chưa commit">•</span>' : ''}`;
}

export function runTable(metas) {
  if (!metas.length) return EMPTY_RUNS;
  const rows = metas
    .map((m) => `<tr>
      <td><a href="${runHref(m.runId)}">${statusBadge(m.status)}</a></td>
      <td><a href="${runHref(m.runId)}" title="${escapeHtml(m.startedAt)}">${escapeHtml(fmtRelative(m.startedAt))}</a>${m.kind === 'explore' ? ' <span class="tag">explore</span>' : ''}</td>
      <td>${countsCell(m.summary)}</td>
      <td class="num">${fmtDuration(m.durationMs)}</td>
      <td class="num">${fmtTokens((m.tokens?.input ?? 0) + (m.tokens?.output ?? 0))}</td>
      <td>${gitCell(m.git)}</td>
      <td class="muted">${escapeHtml(m.source)}</td>
      <td>${m.pinned ? '📌' : ''}${m.baseline ? '⭐' : ''}</td>
    </tr>`)
    .join('');
  return `<table class="table"><thead><tr><th>Status</th><th>Bắt đầu</th><th>Kết quả</th><th class="num">Thời gian</th><th class="num">Token</th><th>Git</th><th>Nguồn</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (v) => `${Math.round(v)}%`;

function kpi(label, value, sub = '') {
  return `<div class="kpi"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`;
}

export async function renderOverview(main) {
  const metas = await getJson('/api/runs');
  if (!metas.length) {
    main.innerHTML = EMPTY_RUNS;
    return;
  }
  const chron = metas.slice(0, 50).reverse();
  const label = (m) => new Date(m.startedAt).toLocaleString('vi-VN');
  const rate = passRate(metas[0]);
  const prev = metas[1] ? passRate(metas[1]) : null;
  const delta = rate != null && prev != null ? Math.round((rate - prev) * 100) : null;
  const tokens = (m) => (m.tokens?.input ?? 0) + (m.tokens?.output ?? 0);
  main.innerHTML = `
    <h1>Overview</h1>
    <section class="kpis">
      ${kpi('Pass rate (run mới nhất)', rate == null ? '—' : pct(rate * 100), delta == null ? '' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)} điểm so với run trước`)}
      ${kpi('Run gần nhất', statusBadge(metas[0].status), escapeHtml(fmtRelative(metas[0].startedAt)))}
      ${kpi('Thời gian TB', fmtDuration(avg(metas.map((m) => m.durationMs).filter((v) => v != null))), `${metas.length} run`)}
      ${kpi('Token / run', fmtTokens(Math.round(avg(metas.map(tokens)) ?? 0)), '')}
    </section>
    <section class="charts">
      <figure><figcaption>Pass rate theo run</figcaption>
        ${lineChart({ points: chron.map((m) => ({ label: label(m), value: passRate(m) == null ? null : passRate(m) * 100 })), yMax: 100, yFormat: pct, ariaLabel: 'Pass rate theo run' })}</figure>
      <figure><figcaption>Kết quả theo run</figcaption>
        ${stackedBarChart({ bars: chron.map((m) => ({ label: label(m), segments: m.summary ?? {} })), keys: RUN_KEYS, ariaLabel: 'Kết quả theo run' })}
        ${legend(RUN_KEYS)}</figure>
      <figure><figcaption>Thời gian chạy</figcaption>
        ${lineChart({ points: chron.map((m) => ({ label: label(m), value: m.durationMs })), yFormat: fmtDuration, ariaLabel: 'Thời gian chạy theo run' })}</figure>
      <figure><figcaption>Token theo run</figcaption>
        ${lineChart({ points: chron.map((m) => ({ label: label(m), value: tokens(m) })), yFormat: fmtTokens, ariaLabel: 'Token theo run' })}</figure>
    </section>
    <section><div class="section-head"><h2>Run gần đây</h2><a href="#/runs">Xem tất cả →</a></div>${runTable(metas.slice(0, 10))}</section>`;
}

export async function renderRunsPage(main) {
  const metas = await getJson('/api/runs');
  main.innerHTML = `<h1>Runs</h1><p class="muted">Bảng này cũng là dạng bảng số liệu của các biểu đồ ở Overview.</p>${runTable(metas)}`;
}
```

Stub tạm (Task 14–15 thay toàn bộ):

`ui/views/run.js`:
```js
export async function renderRun(main) {
  main.innerHTML = '<p class="muted">Run detail — Task 14</p>';
}
```

`ui/views/live.js`:
```js
export async function renderLive(main) {
  main.innerHTML = '<p class="muted">Live — Task 15</p>';
}
```

`ui/views/tests.js`:
```js
export async function renderTests(main) {
  main.innerHTML = '<p class="muted">Tests — Task 15</p>';
}
```

`ui/app.js`:
```js
import { renderOverview, renderRunsPage } from './views/overview.js';
import { renderRun } from './views/run.js';
import { renderLive } from './views/live.js';
import { renderTests } from './views/tests.js';
import { getJson, isExport, liveStream } from './api.js';
import { attachTooltips } from './charts.js';
import { escapeHtml } from './format.js';
import { parseRoute } from './router.js';

const NAV = [['overview', '#/', 'Overview'], ['runs', '#/runs', 'Runs'], ['live', '#/live', 'Live'], ['tests', '#/tests', 'Tests']];
const VIEWS = { overview: renderOverview, runs: renderRunsPage, run: renderRun, live: renderLive, tests: renderTests };
let cleanup = null;
let lastStatus = null;

function shell() {
  const nav = NAV.filter(([v]) => !(isExport() && v === 'live'))
    .map(([v, href, label]) => `<a href="${href}" data-nav="${v}">${label}</a>`)
    .join('');
  document.getElementById('app').innerHTML = `
    <aside class="nav">
      <a class="brand" href="#/">e2e <span>dashboard</span></a>
      <nav>${nav}</nav>
      <div class="nav-foot" id="nav-foot"></div>
    </aside>
    <main id="main" tabindex="-1"></main>`;
  attachTooltips(document.getElementById('main'));
}

async function footer() {
  const el = document.getElementById('nav-foot');
  if (isExport()) {
    el.innerHTML = `Bản export · ${escapeHtml(new Date(globalThis.__E2ED_EXPORT__.exportedAt).toLocaleString('vi-VN'))}`;
    return;
  }
  const info = await getJson('/api/info').catch(() => null);
  if (!info) return;
  const r = info.reporter;
  const hint = !r.installed
    ? '<p class="hint">Chưa cài reporter — chạy <code>/e2e-dashboard setup</code> để xem live.</p>'
    : r.version !== r.latest
      ? `<p class="hint">Reporter trong project là ${escapeHtml(r.version)}, bản mới là ${escapeHtml(r.latest)} — chạy lại <code>/e2e-dashboard setup</code>.</p>`
      : '';
  el.innerHTML = `<div class="muted">${escapeHtml(info.project)} · v${escapeHtml(info.version)}</div>${hint}`;
}

async function route() {
  cleanup?.();
  cleanup = null;
  const r = parseRoute(location.hash);
  const active = r.view === 'run' ? 'runs' : r.view;
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === active));
  const main = document.getElementById('main');
  main.innerHTML = '<p class="muted">Đang tải…</p>';
  try {
    const render = VIEWS[r.view];
    if (!render) main.innerHTML = '<p>Không tìm thấy trang. <a href="#/">Về Overview</a></p>';
    else cleanup = (await render(main, r)) ?? null;
  } catch (e) {
    main.innerHTML = `<p class="error">Lỗi: ${escapeHtml(e.message)}</p>`;
  }
}

// Nav badge while a run is live; refresh list pages when it finishes.
function watchLive() {
  liveStream((s) => {
    const liveLink = document.querySelector('[data-nav="live"]');
    liveLink?.classList.toggle('is-running', s.status === 'running');
    if (lastStatus === 'running' && s.status !== 'running') {
      const view = parseRoute(location.hash).view;
      if (view === 'overview' || view === 'runs' || view === 'tests') setTimeout(route, 1500); // give archive() time to finish
    }
    lastStatus = s.status;
  });
}

shell();
footer();
watchLive();
window.addEventListener('hashchange', route);
route();
```

`ui/style.css` (thay toàn bộ):
```css
:root {
  color-scheme: light;
  --page: #f9f9f7;
  --surface: #fcfcfb;
  --text-primary: #0b0b0b;
  --text-secondary: #52514e;
  --muted: #898781;
  --grid: #e1e0d9;
  --axis: #c3c2b7;
  --border: rgba(11, 11, 11, 0.10);
  --series-1: #2a78d6;
  --good: #0ca30c;
  --warning: #fab219;
  --serious: #ec835a;
  --critical: #d03b3b;
  --link: #1f5fae;
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    color-scheme: dark;
    --page: #0d0d0d;
    --surface: #1a1a19;
    --text-primary: #f0efec;
    --text-secondary: #c3c2b7;
    --grid: #2c2c2a;
    --axis: #383835;
    --border: rgba(255, 255, 255, 0.10);
    --series-1: #3987e5;
    --link: #79aef0;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #0d0d0d;
  --surface: #1a1a19;
  --text-primary: #f0efec;
  --text-secondary: #c3c2b7;
  --grid: #2c2c2a;
  --axis: #383835;
  --border: rgba(255, 255, 255, 0.10);
  --series-1: #3987e5;
  --link: #79aef0;
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--text-primary); }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
h1 { font-size: 20px; margin: 0 0 16px; }
h2 { font-size: 15px; margin: 0; }
.muted { color: var(--text-secondary); }
.error { color: var(--critical); }
.empty, .empty-state { color: var(--text-secondary); }
.empty-state { padding: 48px 0; text-align: center; }

#app { display: grid; grid-template-columns: 200px 1fr; min-height: 100vh; }
.nav { background: var(--surface); border-right: 1px solid var(--border); padding: 16px 12px; display: flex; flex-direction: column; gap: 16px; position: sticky; top: 0; height: 100vh; }
.brand { font-weight: 700; font-size: 16px; color: var(--text-primary); }
.brand span { font-weight: 400; color: var(--text-secondary); }
.nav nav { display: flex; flex-direction: column; gap: 2px; }
.nav nav a { padding: 6px 10px; border-radius: 6px; color: var(--text-primary); }
.nav nav a.active { background: var(--border); font-weight: 600; }
.nav nav a.is-running::after { content: " ●"; color: var(--series-1); }
.nav-foot { margin-top: auto; font-size: 12px; }
.hint { background: var(--border); padding: 8px; border-radius: 6px; }
main { padding: 24px; min-width: 0; outline: none; }

.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px; }
.kpi, .charts figure, .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin: 0; }
.kpi-label, figcaption { color: var(--text-secondary); font-size: 12px; }
.kpi-value { font-size: 22px; font-weight: 600; margin: 2px 0; }
.kpi-sub { color: var(--text-secondary); font-size: 12px; min-height: 1em; }
.charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; margin-bottom: 20px; }
.section-head { display: flex; justify-content: space-between; align-items: baseline; margin: 8px 0; }

.table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.table th, .table td { padding: 7px 10px; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; }
.table th { color: var(--text-secondary); font-weight: 500; font-size: 12px; }
.table .num { text-align: right; font-variant-numeric: tabular-nums; }
.tag { font-size: 11px; padding: 1px 6px; border-radius: 10px; background: var(--border); color: var(--text-secondary); }

/* status: color on a mark beside the text, text stays in ink */
.s-passed { --status: var(--good); }
.s-failed, .s-error { --status: var(--critical); }
.s-flaky { --status: var(--warning); }
.s-timed-out, .s-interrupted, .s-blocked { --status: var(--serious); }
.s-skipped, .s-cancelled { --status: var(--muted); }
.s-running { --status: var(--series-1); }
.badge { display: inline-flex; align-items: center; gap: 5px; color: var(--text-primary); white-space: nowrap; }
.badge::before, .count::before, .swatch { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--status, var(--muted)); }
.count { display: inline-flex; align-items: center; gap: 3px; margin-right: 6px; font-variant-numeric: tabular-nums; }

.chart { width: 100%; height: auto; display: block; }
.chart .grid { stroke: var(--grid); stroke-width: 1; }
.chart .axis, .chart .label { fill: var(--muted); font-size: 11px; }
.chart .label { fill: var(--text-secondary); }
.chart .line { fill: none; stroke: var(--series-1); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.chart .dot { fill: var(--series-1); stroke: var(--surface); stroke-width: 2; }
.chart .seg { fill: var(--status); }
.chart .hatch-line { stroke: var(--surface); stroke-width: 2; opacity: 0.6; }
.chart .hit { fill: transparent; }
.chart .hit:hover { fill: var(--border); }
.legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--text-secondary); margin-top: 6px; }
.legend span { display: inline-flex; align-items: center; gap: 5px; }
#chart-tip { position: fixed; z-index: 10; pointer-events: none; background: var(--text-primary); color: var(--surface); padding: 4px 8px; border-radius: 4px; font-size: 12px; max-width: 360px; }

@media (max-width: 900px) {
  #app { grid-template-columns: 1fr; }
  .nav { position: static; height: auto; flex-direction: row; flex-wrap: wrap; align-items: center; border-right: 0; border-bottom: 1px solid var(--border); }
  .nav nav { flex-direction: row; }
  .nav-foot { margin-top: 0; width: 100%; }
  main { padding: 16px; }
  .table { display: block; overflow-x: auto; }
}
```

`test/seed-demo.mjs`:
```js
#!/usr/bin/env node
// Creates a demo e2e project with 12 archived runs for manual UI checks: node test/seed-demo.mjs [dir]
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';

const dir = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'e2e-demo-'));
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'e2e.config.ts'), 'export default {\n  targets: [],\n};\n');
const base = JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));
const VIDEO = base.run.results[0].attempts[0].artifacts[0].path;
for (let i = 0; i < 12; i++) {
  const r = structuredClone(base);
  const start = Date.parse('2026-10-01T09:00:00Z') + i * 6 * 3600_000;
  r.run.id = `018f0f5c-7b2a-7abc-8abc-${String(i).padStart(12, '0')}`;
  r.run.startedAt = new Date(start).toISOString();
  r.run.finishedAt = new Date(start + 60_000 + i * 7_000).toISOString();
  const failing = i % 3 === 2;
  r.run.status = failing ? 'failed' : 'passed';
  r.run.results[0].status = failing ? 'failed' : i % 4 === 1 ? 'flaky' : 'passed';
  r.run.summary = { ...r.run.summary, passed: failing ? 0 : 1, failed: failing ? 1 : 0 };
  r.run.vcs = { commit: (i.toString(16).repeat(40)).slice(0, 40), branch: i < 8 ? 'main' : 'feat/checkout', dirty: i === 11 };
  for (const e of r.run.results[0].attempts[0].steps[0].events) if (e.kind === 'model') e.inputTokens = 100 + i * 40;
  const out = join(dir, '.e2e');
  mkdirSync(dirname(join(out, 'results', VIDEO)), { recursive: true });
  writeFileSync(join(out, 'results', VIDEO), 'not a real video');
  writeFileSync(join(out, 'report.json'), JSON.stringify(r));
  await archive(dir, { source: i % 2 ? 'reporter' : 'hook' });
}
console.log(dir);
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npm test`
Expected: tất cả PASS

- [ ] **Step 5: Kiểm tra trên trình duyệt**

```bash
D=$(node test/seed-demo.mjs) && (cd "$D" && E2E_DASHBOARD_NO_OPEN=1 node "$OLDPWD/bin/dashboard.mjs")
```
Mở URL in ra (Chrome DevTools MCP: `navigate_page`, `take_screenshot`, `list_console_messages`). Kiểm tra:
- Overview có 4 KPI, 4 chart, bảng 10 run; hover cột/điểm hiện tooltip.
- Không có lỗi console; dark mode (emulate `prefers-color-scheme: dark`) đọc được.
- Thu hẹp còn 375px: sidebar thành thanh trên, không cuộn ngang trang.
- `#/runs` liệt kê đủ 12 run.
Xong thì `(cd "$D" && node "$OLDPWD/bin/dashboard.mjs" stop)`.

- [ ] **Step 6: Commit**

```bash
git add ui/api.js ui/router.js ui/views/overview.js ui/views/run.js ui/views/live.js ui/views/tests.js ui/app.js ui/style.css test/ui-shell.test.mjs test/seed-demo.mjs
git commit -m "feat(ui): app shell, overview charts and run list"
```

---

### Task 14: Run detail — timeline agent, video đồng bộ, ma trận, log, trace

**Files:**
- Modify: `ui/views/run.js` (thay stub), `ui/style.css` (thêm cuối file)
- Test: `test/ui-run.test.mjs`

**Interfaces:**
- Consumes: `getJson, postJson, fileUrl, isExport` (Task 13); `flattenResults, facets, applyFilters, matrix, isFailure, stepVideoOffset` (Task 11); `fmtDuration, fmtTokens, statusBadge, escapeHtml` (Task 11); `renderMarkdown` (Task 12); `runHref` (Task 13)
- Produces:
  - `artifactsOf(attempt) → { video: Artifact|null, screenshots: Artifact[] }` (artifact của attempt + của từng step; video ưu tiên bản có `path`)
  - `mediaSrc(runId, artifact) → string|null` (`path` → `fileUrl(runId, 'artifacts/' + path)`, không thì `url`)
  - `eventLine(event) → string` HTML một dòng event (model/engine/navigation/poll/khác)
  - `cacheText(cache) → string` (`''` nếu không có cache)
  - `renderRun(main, { runId, resultId })`
  - Task 16 sẽ thêm nút Export vào `header()`.
  - Tab **Log** hiển thị `attempt.appLog` (log network/console của app, có trong report). Event `output` (stdout/stderr) chỉ có trong Live, không được lưu vào report — lệch nhỏ so với spec mục 5, đã ghi lại vào spec.
  - Quy ước bundle (Task 8): tên top-level không được trùng giữa các file `ui/` — test `the real UI bundle compiles` (Task 13) bắt lỗi này.

- [ ] **Step 1: Viết test**

`test/ui-run.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artifactsOf, mediaSrc, eventLine, cacheText } from '../ui/views/run.js';

const art = (id, kind, extra) => ({ id, kind, mediaType: 'x', redaction: 'complete', producer: { kind: 'attempt' }, ...extra });

test('artifactsOf collects attempt + step artifacts and prefers a local video', () => {
  const attempt = {
    artifacts: [art('v1', 'video', { url: 'https://cdn/v.mp4' }), art('v2', 'video', { path: 'a/v.webm' }), art('s1', 'screenshot', { path: 'a/1.png' })],
    steps: [{ artifacts: [art('s2', 'screenshot', { path: 'a/2.png' })] }],
  };
  const { video, screenshots } = artifactsOf(attempt);
  assert.equal(video.id, 'v2');
  assert.deepEqual(screenshots.map((s) => s.id), ['s1', 's2']);
  assert.deepEqual(artifactsOf({}), { video: null, screenshots: [] });
});

test('mediaSrc uses the archived file, else the hosted url', () => {
  assert.equal(mediaSrc('r1', { path: 'a b/v.webm' }), '/files/runs/r1/artifacts/a%20b/v.webm');
  assert.equal(mediaSrc('r1', { url: 'https://cdn/v.mp4' }), 'https://cdn/v.mp4');
  assert.equal(mediaSrc('r1', {}), null);
});

test('eventLine renders each event kind and escapes app text', () => {
  assert.match(eventLine({ kind: 'model', reasoning: 'close <modal>', inputTokens: 100, outputTokens: 20, durationMs: 2840 }), /💭 close &lt;modal&gt;.*100\/20 tok/);
  assert.match(eventLine({ kind: 'engine', name: 'tap', detail: 'tap button "Close"' }), /⚙ tap button &quot;Close&quot;/);
  assert.match(eventLine({ kind: 'navigation', detail: 'navigated to /cart' }), /↪ navigated to \/cart/);
  assert.match(eventLine({ kind: 'poll', detail: 'x3' }), /⟳ x3/);
  assert.match(eventLine({ kind: 'weird', name: 'n' }), /weird n/);
});

test('cacheText summarises replay', () => {
  assert.equal(cacheText(undefined), '');
  assert.equal(cacheText({ mode: 'missed', reason: 'gap', replayedActions: 0, totalActions: 2 }), 'cache missed (gap) · replay 0/2');
  assert.equal(cacheText({ mode: 'replayed', replayedActions: 2, totalActions: 2 }), 'cache replayed · replay 2/2');
});
```

- [ ] **Step 2: Chạy, xác nhận fail**

Run: `node --test test/ui-run.test.mjs`
Expected: FAIL (`artifactsOf` is not exported — file vẫn là stub)

- [ ] **Step 3: Implement**

`ui/views/run.js` (thay toàn bộ):
```js
import { getJson, postJson, fileUrl, isExport } from '../api.js';
import { flattenResults, facets, applyFilters, matrix, isFailure, stepVideoOffset } from '../model.js';
import { fmtDuration, fmtTokens, statusBadge, escapeHtml } from '../format.js';
import { renderMarkdown } from '../markdown.js';
import { runHref } from '../router.js';

// View state survives re-renders of the same run (filters, matrix toggle, chosen attempt, tab).
const ui = { runId: null, data: null, filters: {}, matrix: false, attempt: new Map(), tab: 'media' };
const TABS = [['media', 'Video & ảnh'], ['log', 'Log'], ['trace', 'Trace'], ['source', 'Source']];
const FILTERS = [['statuses', 'Status'], ['targets', 'Target'], ['agents', 'Agent'], ['tags', 'Tag'], ['files', 'File']];

export function artifactsOf(attempt) {
  const all = [...(attempt?.artifacts ?? []), ...(attempt?.steps ?? []).flatMap((s) => s.artifacts ?? [])];
  const videos = all.filter((a) => a.kind === 'video');
  return {
    video: videos.find((v) => v.path) ?? videos.find((v) => v.url) ?? null,
    screenshots: all.filter((a) => a.kind === 'screenshot' && (a.path || a.url)),
  };
}

export function mediaSrc(runId, artifact) {
  if (artifact?.path) return fileUrl(runId, `artifacts/${artifact.path}`);
  return artifact?.url ?? null;
}

export function eventLine(e) {
  const dur = e.durationMs ? ` <span class="muted">${fmtDuration(e.durationMs)}</span>` : '';
  if (e.kind === 'model')
    return `<li>💭 ${escapeHtml(e.reasoning ?? e.name ?? 'model')} <span class="muted">(${e.inputTokens ?? 0}/${e.outputTokens ?? 0} tok)</span>${dur}</li>`;
  if (e.kind === 'engine') return `<li>⚙ ${escapeHtml(e.detail ?? e.name)}${dur}</li>`;
  if (e.kind === 'navigation') return `<li>↪ ${escapeHtml(e.detail)}</li>`;
  if (e.kind === 'poll') return `<li>⟳ ${escapeHtml(e.detail ?? e.name)}${dur}</li>`;
  return `<li>• ${escapeHtml(e.kind)} ${escapeHtml(e.detail ?? e.name ?? '')}${dur}</li>`;
}

export function cacheText(cache) {
  if (!cache) return '';
  return `cache ${cache.mode}${cache.reason ? ` (${cache.reason})` : ''} · replay ${cache.replayedActions ?? 0}/${cache.totalActions ?? 0}`;
}

function errorBox(err) {
  if (!err) return '';
  const d = err.details ?? {};
  const rows = [['Locator', d.locator], ['Mong đợi', d.expected], ['Thực tế', d.observed]]
    .filter(([, v]) => v != null)
    .map(([k, v]) => `<div><span class="muted">${k}:</span> <code>${escapeHtml(v)}</code></div>`)
    .join('');
  const src = err.source ? `<div class="muted">${escapeHtml(err.source.file)}:${err.source.line}</div>` : '';
  return `<div class="err"><strong>${escapeHtml(err.code ?? 'Lỗi')}</strong> ${escapeHtml(err.message)}${rows}${src}</div>`;
}

function header(meta, report) {
  const s = meta.summary ?? {};
  const counts = ['passed', 'flaky', 'failed', 'interrupted', 'skipped']
    .filter((k) => s[k])
    .map((k) => `<span class="count s-${k}">${s[k]} ${k}</span>`)
    .join(' ');
  const tokens = (meta.tokens?.input ?? 0) + (meta.tokens?.output ?? 0);
  const replay = meta.replay?.total ? ` · ♻ ${Math.round((meta.replay.replayed / meta.replay.total) * 100)}% replay` : '';
  const git = meta.git?.commit ? ` · ${escapeHtml(meta.git.branch ?? '?')}@${escapeHtml(meta.git.commit.slice(0, 7))}${meta.git.dirty ? ' (dirty)' : ''}` : '';
  const actions = isExport()
    ? ''
    : `<button data-flag="pin">${meta.pinned ? '📌 Bỏ ghim' : '📌 Ghim'}</button>
       <button data-flag="baseline">${meta.baseline ? '⭐ Bỏ baseline' : '⭐ Baseline'}</button>`;
  const runErrors = (report.run.errors ?? []).map(errorBox).join('');
  return `<div class="run-head">
      <div><h1>Run ${escapeHtml(meta.runId.slice(-8))} ${statusBadge(meta.status)}</h1>
        <div class="muted">${new Date(meta.startedAt).toLocaleString('vi-VN')} · ${fmtDuration(meta.durationMs)} · 🪙 ${fmtTokens(tokens)} tok${replay}${git}</div>
        <div>${counts}</div></div>
      <div class="actions">${actions}</div>
    </div>${runErrors}`;
}

function filterBar(all) {
  const f = facets(all);
  const selects = FILTERS.filter(([k]) => f[k].length > 1 || ui.filters[k]?.length)
    .map(([k, label]) => `<label>${label} <select data-filter="${k}"><option value="">Tất cả</option>${f[k]
      .map((v) => `<option ${ui.filters[k]?.[0] === v ? 'selected' : ''}>${escapeHtml(v)}</option>`)
      .join('')}</select></label>`)
    .join('');
  return `<div class="filters">${selects}<button data-toggle="matrix" aria-pressed="${ui.matrix}">⊞ Ma trận</button></div>`;
}

function testList(rows, runId, selectedId) {
  if (!rows.length) return '<p class="muted">Không có test nào khớp bộ lọc.</p>';
  return `<ul class="test-list">${rows
    .map((r) => `<li><a class="${r.id === selectedId ? 'selected' : ''}" href="${runHref(runId, r.id)}">
      ${statusBadge(r.status)} <span class="title">${escapeHtml(r.title)}</span>
      <span class="muted">[${escapeHtml(r.target)}${r.agent !== 'default' ? ` · ${escapeHtml(r.agent)}` : ''}] ${fmtDuration(r.durationMs)}</span></a></li>`)
    .join('')}</ul>`;
}

function matrixTable(rows, runId) {
  const m = matrix(rows);
  const head = m.targets.map((t) => `<th>${escapeHtml(t)}</th>`).join('');
  const body = m.rows
    .map((r) => `<tr><td>${escapeHtml(r.title)}</td>${m.targets
      .map((t) => (r.cells[t] ? `<td><a href="${runHref(runId, r.cells[t].id)}">${statusBadge(r.cells[t].status)}</a></td>` : '<td class="muted">—</td>'))
      .join('')}</tr>`)
    .join('');
  return `<table class="table matrix"><thead><tr><th>Test</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function stepItem(step, video, attempt) {
  const off = video ? stepVideoOffset(step, video, attempt) : null;
  const meta = [fmtDuration(step.durationMs), step.metrics?.modelCalls ? `${step.metrics.modelCalls} model call` : '', cacheText(step.cache)]
    .filter(Boolean)
    .join(' · ');
  const events = (step.events ?? []).map(eventLine).join('');
  return `<li class="step"><details ${step.status !== 'passed' ? 'open' : ''}>
      <summary ${off != null ? `data-offset="${off}" title="Tua video đến step này"` : ''}>${statusBadge(step.status)} <code>${escapeHtml(step.api)}</code> ${escapeHtml(step.label ?? '')} <span class="muted">${escapeHtml(meta)}</span></summary>
      ${events ? `<ul class="events">${events}</ul>` : ''}
      ${step.explanation ? `<p class="muted">${escapeHtml(step.explanation)}</p>` : ''}
      ${errorBox(step.error)}
    </details></li>`;
}

function mediaTab(row, attempt, runId) {
  if (row.status === 'passed') return '<p class="muted">Artifact chỉ được lưu cho test không pass.</p>';
  const { video, screenshots } = artifactsOf(attempt);
  const failShot = attempt.failure?.screen;
  const v = video && mediaSrc(runId, video);
  const vid = v ? `<video id="run-video" controls preload="metadata" src="${escapeHtml(v)}"></video>` : '<p class="muted">Không có video.</p>';
  const shots = screenshots
    .map((s) => {
      const src = mediaSrc(runId, s);
      return src ? `<a href="${escapeHtml(src)}" target="_blank" rel="noopener"><img loading="lazy" src="${escapeHtml(src)}" alt="screenshot${s.id === failShot ? ' lúc fail' : ''}"${s.id === failShot ? ' class="fail-shot"' : ''}></a>` : '';
    })
    .join('');
  return `${vid}${shots ? `<div class="shots">${shots}</div>` : ''}`;
}

function logTab(attempt) {
  const lines = attempt.appLog ?? [];
  if (!lines.length) return '<p class="muted">Không có log.</p>';
  return `<pre class="log">${lines.map((l) => `[${escapeHtml(l.level ?? '')}] ${escapeHtml(l.source ?? '')} ${escapeHtml(l.text)}`).join('\n')}</pre>`;
}

function sourceTab(row, attempt) {
  const srcs = new Set([`${row.file}:${row.line}`]);
  if (attempt.error?.source) srcs.add(`${attempt.error.source.file}:${attempt.error.source.line}`);
  for (const s of attempt.steps ?? []) if (s.source) srcs.add(`${s.source.file}:${s.source.line}`);
  return `<ul>${[...srcs].map((s) => `<li><code>${escapeHtml(s)}</code></li>`).join('')}</ul><p class="muted">Mở các vị trí này trong editor.</p>`;
}

function detail(row, meta, runId) {
  const idx = Math.min(ui.attempt.get(row.id) ?? row.attempts.length - 1, row.attempts.length - 1);
  const attempt = row.attempts[idx];
  const pills = row.attempts.length > 1
    ? `<div class="attempts">${row.attempts
      .map((a, i) => `<button data-attempt="${i}" aria-pressed="${i === idx}">Attempt ${i + 1} ${statusBadge(a.status)}</button>`)
      .join('')}</div>`
    : '';
  const head = `<h2>${escapeHtml(row.title)} ${statusBadge(row.status)}</h2>
    <div class="muted"><code>${escapeHtml(row.file)}:${row.line}</code> · ${escapeHtml(row.target)} · ${escapeHtml(row.agent)}${row.tags.map((t) => ` <span class="tag">${escapeHtml(t)}</span>`).join('')}</div>`;
  if (!attempt) return `${head}<p class="muted">Test không có attempt nào${row.status === 'skipped' ? ' (bị skip)' : ''}.</p>`;
  const { video } = artifactsOf(attempt);
  const skip = attempt.skip?.reason ? `<p class="muted">Skip: ${escapeHtml(attempt.skip.reason)}</p>` : '';
  const steps = (attempt.steps ?? []).map((s) => stepItem(s, video, attempt)).join('');
  const tabs = TABS.filter(([k]) => k !== 'trace' || meta.traces?.[row.id])
    .map(([k, label]) => `<button data-tab="${k}" aria-pressed="${ui.tab === k}">${label}</button>`)
    .join('');
  const body = { media: () => mediaTab(row, attempt, runId), log: () => logTab(attempt), trace: () => '<div id="trace" class="md">Đang tải trace…</div>', source: () => sourceTab(row, attempt) }[ui.tab]();
  return `${head}${pills}${skip}${errorBox(attempt.error)}
    <ol class="timeline">${steps || '<li class="muted">Không có step.</li>'}</ol>
    <div class="tabs">${tabs}</div><div class="tab-body">${body}</div>`;
}

export async function renderRun(main, route) {
  const { runId, resultId } = route;
  if (ui.runId !== runId || !ui.data) {
    Object.assign(ui, { runId, filters: {}, matrix: false, attempt: new Map(), tab: 'media' });
    ui.data = await getJson(`/api/runs/${encodeURIComponent(runId)}`);
  }
  const { meta, report } = ui.data;
  const all = flattenResults(report);
  const rows = applyFilters(all, ui.filters);
  const selected = all.find((r) => r.id === resultId) ?? rows.find((r) => isFailure(r.status)) ?? rows[0];
  if (ui.tab === 'trace' && !meta.traces?.[selected?.id]) ui.tab = 'media';
  main.innerHTML = `${header(meta, report)}${filterBar(all)}
    <div class="run-body">
      <div class="run-list">${ui.matrix ? matrixTable(rows, runId) : testList(rows, runId, selected?.id)}</div>
      <div class="run-detail panel">${selected ? detail(selected, meta, runId) : '<p class="muted">Không có test.</p>'}</div>
    </div>`;

  const rerender = () => renderRun(main, route);
  main.querySelectorAll('[data-filter]').forEach((el) =>
    el.addEventListener('change', () => {
      ui.filters[el.dataset.filter] = el.value ? [el.value] : [];
      rerender();
    }));
  main.querySelector('[data-toggle="matrix"]')?.addEventListener('click', () => {
    ui.matrix = !ui.matrix;
    rerender();
  });
  main.querySelectorAll('[data-flag]').forEach((el) =>
    el.addEventListener('click', async () => {
      const flag = el.dataset.flag;
      const meta2 = await postJson(`/api/runs/${encodeURIComponent(runId)}/${flag}`, { value: !(flag === 'pin' ? meta.pinned : meta.baseline) });
      ui.data = { ...ui.data, meta: meta2 };
      rerender();
    }));
  main.querySelectorAll('[data-attempt]').forEach((el) =>
    el.addEventListener('click', () => {
      ui.attempt.set(selected.id, Number(el.dataset.attempt));
      rerender();
    }));
  main.querySelectorAll('[data-tab]').forEach((el) =>
    el.addEventListener('click', () => {
      ui.tab = el.dataset.tab;
      rerender();
    }));
  main.querySelectorAll('summary[data-offset]').forEach((el) =>
    el.addEventListener('click', () => {
      const v = main.querySelector('#run-video');
      if (v) v.currentTime = Number(el.dataset.offset);
    }));
  const trace = main.querySelector('#trace');
  if (trace && selected) {
    fetch(fileUrl(runId, meta.traces[selected.id]))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((md) => (trace.innerHTML = renderMarkdown(md)))
      .catch((e) => (trace.textContent = `Không tải được trace: ${e.message}`));
  }
  return () => {
    // leaving the run page drops cached data so the next visit refetches
    if (!location.hash.startsWith(`#/run/${encodeURIComponent(runId)}`)) ui.data = null;
  };
}
```

Thêm vào cuối `ui/style.css`:
```css
.run-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 12px; }
.run-head h1 { margin-bottom: 4px; display: flex; gap: 10px; align-items: center; }
.actions, .filters, .attempts, .tabs { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.filters { margin-bottom: 12px; }
button, select { font: inherit; color: var(--text-primary); background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
button[aria-pressed="true"] { background: var(--border); font-weight: 600; }
.run-body { display: grid; grid-template-columns: minmax(260px, 360px) 1fr; gap: 12px; align-items: start; }
.test-list { list-style: none; margin: 0; padding: 0; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; max-height: calc(100vh - 200px); overflow: auto; }
.test-list a { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; padding: 7px 10px; color: var(--text-primary); border-bottom: 1px solid var(--border); }
.test-list a.selected { background: var(--border); }
.test-list .title { flex: 1; min-width: 120px; }
.timeline { list-style: none; padding: 0; margin: 12px 0; border-left: 2px solid var(--grid); }
.step { padding: 4px 0 4px 12px; }
.step summary { cursor: pointer; }
.step summary[data-offset]:hover { text-decoration: underline; }
.events { margin: 6px 0 0; padding-left: 18px; color: var(--text-secondary); }
.err { border-left: 3px solid var(--critical); background: var(--border); padding: 8px 10px; border-radius: 4px; margin: 8px 0; overflow-wrap: anywhere; }
.tab-body { margin-top: 8px; }
.tab-body video { width: 100%; max-height: 420px; background: #000; border-radius: 6px; }
.shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; margin-top: 8px; }
.shots img { width: 100%; border-radius: 4px; border: 1px solid var(--border); }
.shots img.fail-shot { outline: 2px solid var(--critical); }
.log { background: var(--surface); border: 1px solid var(--border); padding: 8px; border-radius: 6px; overflow: auto; max-height: 360px; }
.md pre { background: var(--page); padding: 8px; overflow: auto; }
@media (max-width: 900px) {
  .run-body { grid-template-columns: 1fr; }
  .run-head { flex-direction: column; }
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npm test`
Expected: tất cả PASS

- [ ] **Step 5: Kiểm tra trên trình duyệt**

```bash
D=$(node test/seed-demo.mjs) && (cd "$D" && E2E_DASHBOARD_NO_OPEN=1 node "$OLDPWD/bin/dashboard.mjs")
```
Mở một run `failed` (Overview → bảng → run có ✗). Kiểm tra:
- Header có token, % replay, git; Ghim/Baseline đổi trạng thái và còn sau khi reload.
- Tự chọn test fail đầu tiên; timeline có 💭 reasoning, ⚙ action, lỗi `OPERATION_TIMEOUT` ở step `agent.assert`.
- Tab Video & ảnh có thẻ `<video>` (file demo không phát được, nhưng request `/files/...` trả 200/206); bấm step có `data-offset` thì `currentTime` đổi (kiểm bằng `evaluate_script`).
- Tab Log có dòng `POST /api/cart 500`.
- Bấm Ma trận → bảng test × target; đổi bộ lọc Status → danh sách thu gọn.
- Deep link `#/run/<id>/test/<resultId>` mở đúng test sau khi reload.
- Không có lỗi console; 375px không cuộn ngang trang.

- [ ] **Step 6: Commit**

```bash
git add ui/views/run.js ui/style.css test/ui-run.test.mjs
git commit -m "feat(ui): run detail with agent timeline, synced video and matrix"
```

---

### Task 15: Live (Gantt + ETA) và Tests

**Files:**
- Modify: `ui/views/live.js`, `ui/views/tests.js` (thay stub), `ui/style.css` (thêm cuối file)
- Test: `test/ui-live.test.mjs`

**Interfaces:**
- Consumes: `getJson, liveStream, isExport` (Task 13); `fmtDuration, statusBadge, escapeHtml, STATUS` (Task 11); `runHref` (Task 13); Snapshot + `etaMs` từ SSE (Task 7–8); `TestRow` từ `/api/tests` (Task 6)
- Produces:
  - `ganttBlocks(snapshot, now = Date.now()) → Array<{ key, lane, left, width, status, title, durationMs }>` (`left`, `width` theo %, tối thiểu width 0.5%)
  - `renderLive(main) → cleanup`
  - `historyCells(history, n = 10) → string` HTML: cũ → mới từ trái sang phải, đủ `n` ô (ô trống cho run không có test)
  - `renderTests(main)`

- [ ] **Step 1: Viết test**

`test/ui-live.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ganttBlocks } from '../ui/views/live.js';
import { historyCells } from '../ui/views/tests.js';

test('ganttBlocks places tests on their lane as % of elapsed run time', () => {
  const t0 = Date.parse('2026-07-24T12:00:00Z');
  const snap = {
    startedAt: new Date(t0).toISOString(), finishedAt: null,
    tests: [
      { key: 'a', lane: 0, status: 'passed', title: 'A', startedAt: new Date(t0).toISOString(), finishedAt: new Date(t0 + 5000).toISOString(), durationMs: 5000 },
      { key: 'b', lane: 1, status: 'running', title: 'B', startedAt: new Date(t0 + 5000).toISOString(), finishedAt: null, durationMs: null },
    ],
  };
  const blocks = ganttBlocks(snap, t0 + 10_000);
  assert.deepEqual(blocks.map((b) => [b.key, b.lane, b.left, b.width]), [['a', 0, 0, 50], ['b', 1, 50, 50]]);
  assert.equal(blocks[1].durationMs, 5000);
  assert.deepEqual(ganttBlocks({ startedAt: null, tests: [] }), []);
});

test('historyCells pads to n, oldest first, links each run', () => {
  const html = historyCells([{ runId: 'new', status: 'failed' }, { runId: 'old', status: 'passed' }], 4);
  assert.equal((html.match(/class="cell/g) ?? []).length, 4);
  assert.ok(html.indexOf('#/run/old') < html.indexOf('#/run/new'));
  assert.match(html, /s-failed/);
});
```

- [ ] **Step 2: Chạy, xác nhận fail**

Run: `node --test test/ui-live.test.mjs`
Expected: FAIL (`ganttBlocks` is not exported — file vẫn là stub)

- [ ] **Step 3: Implement**

`ui/views/live.js` (thay toàn bộ):
```js
import { getJson, liveStream } from '../api.js';
import { fmtDuration, statusBadge, escapeHtml } from '../format.js';

export function ganttBlocks(snapshot, now = Date.now()) {
  const t0 = Date.parse(snapshot.startedAt);
  if (Number.isNaN(t0) || !snapshot.tests?.length) return [];
  const end = snapshot.finishedAt ? Date.parse(snapshot.finishedAt) : now;
  const span = Math.max(1, end - t0);
  return snapshot.tests.map((t) => {
    const s = Date.parse(t.startedAt);
    const e = t.finishedAt ? Date.parse(t.finishedAt) : end;
    return {
      key: t.key,
      lane: t.lane,
      left: Math.round(((s - t0) / span) * 1000) / 10,
      width: Math.max(0.5, Math.round(((e - s) / span) * 1000) / 10),
      status: t.status,
      title: t.title,
      durationMs: e - s,
    };
  });
}

export async function renderLive(main) {
  const info = await getJson('/api/info');
  let snap = null;
  let selectedKey = null;

  function draw() {
    if (!snap || snap.status === 'idle') {
      main.innerHTML = `<h1>Live</h1><div class="empty-state"><h2>Chưa có run nào đang chạy</h2>
        <p>Chạy <code>npx e2e run</code> — tiến độ sẽ hiện ở đây.</p>
        ${info.reporter.installed ? '' : '<p class="hint">Cần reporter để xem live: chạy <code>/e2e-dashboard setup</code>.</p>'}</div>`;
      return;
    }
    const pct = snap.total ? Math.round((snap.done / snap.total) * 100) : 0;
    const eta = snap.status === 'running' && snap.etaMs != null ? ` · còn khoảng ${fmtDuration(snap.etaMs)}` : '';
    const blocks = ganttBlocks(snap);
    const lanes = Array.from({ length: Math.max(snap.lanes, 1) }, (_, i) =>
      `<div class="lane"><span class="lane-label">làn ${i + 1}</span><div class="lane-track">${blocks
        .filter((b) => b.lane === i)
        .map((b) => `<button class="block s-${escapeHtml(b.status)}" data-key="${escapeHtml(b.key)}" style="left:${b.left}%;width:${b.width}%" data-tip="${escapeHtml(`${b.title} · ${fmtDuration(b.durationMs)}`)}" aria-label="${escapeHtml(b.title)}"></button>`)
        .join('')}</div></div>`).join('');
    const running = snap.tests.filter((t) => t.status === 'running');
    const sel = snap.tests.find((t) => t.key === selectedKey) ?? running.at(-1) ?? snap.tests.at(-1);
    const steps = sel
      ? `<h2>${escapeHtml(sel.title)} ${statusBadge(sel.status)}${sel.activity ? ` <span class="muted">● ${escapeHtml(sel.activity)}</span>` : ''}</h2>
         <ol class="timeline">${sel.steps
           .map((s) => `<li class="step">${statusBadge(s.status)} <code>${escapeHtml(s.api)}</code> ${escapeHtml(s.label ?? '')} <span class="muted">${fmtDuration(s.durationMs)}</span>${s.error ? `<div class="err">${escapeHtml(s.error.message ?? '')}</div>` : ''}</li>`)
           .join('') || '<li class="muted">Chưa có step.</li>'}</ol>`
      : '';
    const out = snap.output.slice(-50).map((o) => escapeHtml(o.text)).join('');
    main.innerHTML = `<h1>Live ${statusBadge(snap.status === 'finished' ? snap.runStatus ?? 'finished' : snap.status)}</h1>
      <div class="progress"><div class="bar" style="width:${pct}%"></div></div>
      <p class="muted">${snap.done}/${snap.total} test${eta}${snap.status === 'finished' ? ' · đã xong — xem ở Runs' : ''}</p>
      ${snap.error ? `<div class="err">${escapeHtml(snap.error.message ?? '')}</div>` : ''}
      <section class="panel gantt">${lanes}<p class="muted small">Làn được xếp theo thời gian chạy chồng nhau, không phải số worker thật.</p></section>
      <section class="panel">${steps}</section>
      ${out ? `<section><h2>Output</h2><pre class="log">${out}</pre></section>` : ''}`;
    main.querySelectorAll('.block').forEach((b) =>
      b.addEventListener('click', () => {
        selectedKey = b.dataset.key;
        draw();
      }));
  }

  const stop = liveStream((s) => {
    snap = s;
    draw();
  });
  const tick = setInterval(() => snap?.status === 'running' && draw(), 1000); // grow running blocks
  draw();
  return () => {
    stop();
    clearInterval(tick);
  };
}
```

`ui/views/tests.js` (thay toàn bộ):
```js
import { getJson } from '../api.js';
import { fmtDuration, escapeHtml, STATUS } from '../format.js';
import { runHref } from '../router.js';

let filter = { file: '', tag: '', target: '' };

export function historyCells(history, n = 10) {
  const cells = history.slice(0, n).reverse();
  while (cells.length < n) cells.unshift(null);
  return `<span class="history">${cells
    .map((h) => (h
      ? `<a class="cell s-${escapeHtml(h.status)}" href="${runHref(h.runId)}" data-tip="${escapeHtml(`${STATUS[h.status]?.label ?? h.status}`)}" aria-label="${escapeHtml(h.status)}"></a>`
      : '<span class="cell empty-cell"></span>'))
    .join('')}</span>`;
}

const distinct = (xs) => [...new Set(xs)].sort();

export async function renderTests(main) {
  const all = await getJson('/api/tests');
  const draw = () => {
    const rows = all.filter((r) => (!filter.file || r.file === filter.file) && (!filter.tag || r.tags.includes(filter.tag)) && (!filter.target || r.target === filter.target));
    const sel = (k, values, label) => `<label>${label} <select data-f="${k}"><option value="">Tất cả</option>${values
      .map((v) => `<option ${filter[k] === v ? 'selected' : ''}>${escapeHtml(v)}</option>`)
      .join('')}</select></label>`;
    const byFile = new Map();
    for (const r of rows) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
    const body = [...byFile]
      .map(([file, tests]) => `<tr class="group"><td colspan="4"><code>${escapeHtml(file)}</code></td></tr>${tests
        .map((t) => `<tr><td>${escapeHtml(t.title)} <span class="muted">:${t.line ?? '?'}</span>${t.tags.map((g) => ` <span class="tag">${escapeHtml(g)}</span>`).join('')}</td>
          <td>${escapeHtml(t.target)}${t.agent !== 'default' ? ` · ${escapeHtml(t.agent)}` : ''}</td>
          <td>${historyCells(t.history)}</td><td class="num">${fmtDuration(t.avgDurationMs)}</td></tr>`)
        .join('')}`)
      .join('');
    main.innerHTML = `<h1>Tests</h1>
      <div class="filters">${sel('file', distinct(all.map((r) => r.file)), 'File')}${sel('tag', distinct(all.flatMap((r) => r.tags)), 'Tag')}${sel('target', distinct(all.map((r) => r.target)), 'Target')}</div>
      ${rows.length
        ? `<table class="table"><thead><tr><th>Test</th><th>Target</th><th>10 run gần nhất (cũ → mới)</th><th class="num">TB</th></tr></thead><tbody>${body}</tbody></table>`
        : '<div class="empty-state"><p>Chưa có test nào trong lịch sử.</p></div>'}`;
    main.querySelectorAll('[data-f]').forEach((el) =>
      el.addEventListener('change', () => {
        filter = { ...filter, [el.dataset.f]: el.value };
        draw();
      }));
  };
  draw();
}
```

Thêm vào cuối `ui/style.css`:
```css
.progress { height: 6px; background: var(--grid); border-radius: 3px; overflow: hidden; }
.progress .bar { height: 100%; background: var(--series-1); transition: width 0.3s; }
.gantt { display: flex; flex-direction: column; gap: 6px; margin: 12px 0; }
.lane { display: grid; grid-template-columns: 56px 1fr; align-items: center; gap: 8px; }
.lane-label { color: var(--muted); font-size: 12px; }
.lane-track { position: relative; height: 22px; background: var(--page); border-radius: 4px; }
.block { position: absolute; top: 2px; bottom: 2px; padding: 0; border: 0; border-radius: 4px; background: var(--status); box-shadow: 0 0 0 1px var(--surface); }
.block.s-running { animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.55; } }
@media (prefers-reduced-motion: reduce) { .block.s-running { animation: none; } }
.small { font-size: 12px; }
.history { display: inline-flex; gap: 3px; }
.history .cell { width: 12px; height: 12px; border-radius: 3px; background: var(--status); display: inline-block; }
.history .empty-cell { background: var(--grid); }
.table tr.group td { background: var(--page); }
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npm test`
Expected: tất cả PASS

- [ ] **Step 5: Kiểm tra trên trình duyệt (live giả lập)**

Bật dashboard trên project demo (như Task 13), rồi giả làm reporter bằng một script đẩy event:
```bash
cat > /tmp/fake-run.mjs <<'EOF'
import { readFileSync } from 'node:fs';
const { port, token } = JSON.parse(readFileSync(process.argv[2] + '/.e2e-dashboard/server.json', 'utf8'));
const post = (e) => fetch(`http://127.0.0.1:${port}/api/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-e2e-dashboard-token': token }, body: JSON.stringify({ at: new Date().toISOString(), ...e }) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await post({ type: 'run-started', runId: 'fake', projectRoot: process.argv[2] });
await post({ type: 'plan', total: 4, files: [] });
for (const [i, id] of ['login', 'cart', 'search', 'checkout'].entries()) {
  await post({ type: 'test-started', testId: id, title: id, file: 'a.e2e.ts', target: 'web', agent: 'default', repeat: 0 });
  await post({ type: 'step', testId: id, target: 'web', agent: 'default', repeat: 0, progress: { phase: 'start', kind: 'agent', api: 'agent.act', label: `do ${id}`, identity: { stepId: `${id}-1` } } });
  await sleep(1500);
  if (i % 2) await post({ type: 'test-finished', result: { testId: id, targetId: 'web', agent: 'default', repeat: 0, status: i === 3 ? 'failed' : 'passed', attempts: [{ durationMs: 1500 }] } });
}
await sleep(1500);
for (const id of ['login', 'search']) await post({ type: 'test-finished', result: { testId: id, targetId: 'web', agent: 'default', repeat: 0, status: 'passed', attempts: [{ durationMs: 3000 }] } });
await post({ type: 'run-finished', status: 'failed', exitCode: 1 });
EOF
node /tmp/fake-run.mjs "$D"
```
Trong lúc script chạy, mở `#/live`: thanh tiến độ tăng, ít nhất 2 làn, khối đang chạy nhấp nháy và dài ra, ETA hiện (có lịch sử demo), nav "Live ●" khi đang chạy. Sau `run-finished` trạng thái đổi. `#/tests`: mỗi test có dải 10 ô, bộ lọc hoạt động. Không lỗi console.

- [ ] **Step 6: Commit**

```bash
git add ui/views/live.js ui/views/tests.js ui/style.css test/ui-live.test.mjs
git commit -m "feat(ui): live Gantt with ETA and per-test history"
```

---

### Task 16: Export HTML tĩnh (`/e2e-dashboard export` + nút trên Run detail)

**Files:**
- Create: `server/export.mjs`
- Modify: `server/app.mjs` (thêm route), `bin/dashboard.mjs` (thêm subcommand), `ui/app.js` (route mặc định khi export, ẩn Live/Tests), `ui/views/run.js` (nút Export trong `header()`)
- Test: `test/export.test.mjs`

**Interfaces:**
- Consumes: `listRuns`, `getRun` (Task 6); `bundleUi` (Task 8); `DATA_DIR` (Task 3)
- Produces:
  - `export function embedJson(value) → string` — JSON an toàn để đặt trong `<script>` (escape `<`, `>`, `&`, U+2028, U+2029)
  - `export async function buildExportHtml(root, runId?) → { html, runId } | null` (runId thiếu → run mới nhất)
  - `export async function exportRun(root, runId?) → string|null` (ghi `.e2e-dashboard/exports/run-<runId>.html`, trả đường dẫn)
  - `globalThis.__E2ED_EXPORT__ = { runId, exportedAt, api: { '/api/runs': [meta], '/api/runs/<id>': { meta, report } }, files: { 'runs/<id>/<rel>': dataUri } }`
  - Nhúng: screenshot/ảnh và `traces/*.md` dưới dạng data URI; **không nhúng video** (`video/*`) và file > 5 MB.
  - Server: `GET /api/runs/:id/export` → HTML, `content-disposition: attachment`.
  - CLI: `/e2e-dashboard export [runId]` in `Đã xuất: <path>`.

- [ ] **Step 1: Viết test**

`test/export.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { embedJson, buildExportHtml, exportRun } from '../server/export.mjs';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';
import { main } from '../bin/dashboard.mjs';

const VIDEO = 'web/tests_example.e2e.ts__opens_app/attempt-0/video/video.webm';
const PNG = 'web/shot.png';

function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

async function project() {
  const root = mkdtempSync(join(tmpdir(), 'e2ed-'));
  writeFileSync(join(root, 'e2e.config.ts'), 'export default {}\n');
  const r = JSON.parse(readFileSync(new URL('./fixtures/report-v1.valid.json', import.meta.url), 'utf8'));
  r.run.results[0].status = 'failed';
  r.run.results[0].attempts[0].error.message = '</script><script>alert(1)</script>';
  r.run.results[0].attempts[0].artifacts.push({ id: 'p', kind: 'screenshot', mediaType: 'image/png', path: PNG, redaction: 'complete', producer: { kind: 'attempt' } });
  put(root, '.e2e/report.json', JSON.stringify(r));
  put(root, `.e2e/results/${VIDEO}`, 'webm');
  put(root, `.e2e/results/${PNG}`, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await archive(root, { source: 'hook' });
  return { root, runId: r.run.id };
}

test('embedJson cannot break out of a script tag', () => {
  const s = embedJson({ m: '</script><!-- &  ' });
  assert.doesNotMatch(s, /<\/script|<!--|&| /);
  assert.deepEqual(JSON.parse(s), { m: '</script><!-- &  ' });
});

test('export embeds report, screenshots and UI; skips video; escapes app text', async () => {
  const { root, runId } = await project();
  const { html } = await buildExportHtml(root);
  assert.match(html, /^<!doctype html>/i);
  assert.ok(html.includes(runId));
  assert.ok(html.includes('data:image/png;base64,iVBORw=='));
  assert.ok(!html.includes(`artifacts/${VIDEO}`), 'video not embedded as a file entry');
  assert.ok(html.includes(`artifacts/${PNG}`), 'screenshot embedded as a file entry');
  assert.doesNotMatch(html, /<\/script><script>alert\(1\)/);
  assert.doesNotMatch(html, /href="\/style\.css"|src="\/app\.js"/);
  assert.equal(await buildExportHtml(root, '018f0f5c-0000-0000-0000-000000000000'), null);
});

test('exportRun writes the file; CLI prints the path', async () => {
  const { root, runId } = await project();
  const p = await exportRun(root, runId);
  assert.ok(p.endsWith(`.e2e-dashboard/exports/run-${runId}.html`) && existsSync(p));
  const r = await main(['export'], root);
  assert.equal(r.code, 0);
  assert.match(r.out, /^Đã xuất: .*run-.*\.html$/);
});

test('server serves the export as a download', async () => {
  const { root, runId } = await project();
  const server = http.createServer(createApp({ projectRoot: root, token: 't', uiDir: fileURLToPath(new URL('../ui', import.meta.url)), live: createLive() }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/runs/${runId}/export`, { headers: { 'x-e2e-dashboard-token': 't' } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="e2e-run-/);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Chạy, xác nhận fail**

Run: `node --test test/export.test.mjs`
Expected: FAIL (cannot find module `../server/export.mjs`)

- [ ] **Step 3: Implement**

`server/export.mjs`:
```js
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { join, relative, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from '../reporter/e2e-dashboard.reporter.mjs';
import { listRuns, getRun } from './store.mjs';
import { bundleUi } from '../ui/bundle.mjs';

const UI_DIR = fileURLToPath(new URL('../ui', import.meta.url));
const MAX_FILE = 5 * 1024 * 1024;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.md': 'text/markdown', '.txt': 'text/plain', '.log': 'text/plain', '.json': 'application/json' };

export function embedJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/ /g, '\\u2028')
    .replace(/ /g, '\\u2029');
}

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

async function embeddedFiles(runDir, runId) {
  const files = {};
  for (const sub of ['artifacts', 'traces']) {
    for (const p of await walk(join(runDir, sub))) {
      const type = MIME[extname(p).toLowerCase()];
      if (!type || (await stat(p)).size > MAX_FILE) continue; // videos and unknown types stay out
      const rel = relative(runDir, p).split(sep).join('/');
      files[`runs/${runId}/${rel}`] = `data:${type};base64,${(await readFile(p)).toString('base64')}`;
    }
  }
  return files;
}

export async function buildExportHtml(root, runId) {
  const id = runId ?? (await listRuns(root))[0]?.runId;
  const run = id && (await getRun(root, id));
  if (!run) return null;
  const data = {
    runId: run.meta.runId,
    exportedAt: new Date().toISOString(),
    api: { '/api/runs': [run.meta], [`/api/runs/${run.meta.runId}`]: { meta: run.meta, report: run.report } },
    files: await embeddedFiles(run.dir, run.meta.runId),
  };
  const [index, css, js] = await Promise.all([readFile(join(UI_DIR, 'index.html'), 'utf8'), readFile(join(UI_DIR, 'style.css'), 'utf8'), bundleUi(UI_DIR)]);
  const html = index
    .replace('<link rel="stylesheet" href="/style.css">', () => `<style>\n${css}\n</style>`)
    .replace('<script src="/app.js"></script>', () =>
      `<script>globalThis.__E2ED_EXPORT__ = ${embedJson(data)};</script>\n<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`);
  return { html, runId: run.meta.runId };
}

export async function exportRun(root, runId) {
  const out = await buildExportHtml(root, runId);
  if (!out) return null;
  const dir = join(root, DATA_DIR, 'exports');
  await mkdir(dir, { recursive: true });
  const p = join(dir, `run-${out.runId}.html`);
  await writeFile(p, out.html);
  return p;
}
```

Dùng hàm thay thế `() => …` trong `.replace` để các chuỗi `$&`, `$1` có trong CSS/JS không bị String.replace diễn giải.

`server/app.mjs` — thêm import ở đầu:
```js
import { buildExportHtml } from './export.mjs';
```
và trong nhánh `if (req.method === 'GET') {`, ngay trước dòng `let m = /^\/api\/runs\/([^/]+)$/.exec(p);`:
```js
      const ex = /^\/api\/runs\/([^/]+)\/export$/.exec(p);
      if (ex) {
        const out = await buildExportHtml(projectRoot, ex[1]);
        if (!out) return send(res, 404, { error: 'run not found' });
        return send(res, 200, out.html, {
          'content-type': 'text/html; charset=utf-8',
          'content-disposition': `attachment; filename="e2e-run-${out.runId}.html"`,
        });
      }
```

`bin/dashboard.mjs` — thêm import:
```js
import { exportRun } from '../server/export.mjs';
```
và trong `main`, ngay trước dòng `return { code: 1, out: 'Dùng: …' }`:
```js
  if (cmd === 'export') {
    const p = await exportRun(root, argv[1]);
    return p ? { code: 0, out: `Đã xuất: ${p}` } : { code: 1, out: argv[1] ? `Không tìm thấy run ${argv[1]}.` : 'Chưa có run nào để xuất.' };
  }
```
Đồng thời sửa comment đầu file thành `// Entry for /e2e-dashboard: start | setup | export | stop | status.`

`ui/views/run.js` — trong `header()`, thay khối `const actions = …` bằng:
```js
  const actions = isExport()
    ? ''
    : `<button data-flag="pin">${meta.pinned ? '📌 Bỏ ghim' : '📌 Ghim'}</button>
       <button data-flag="baseline">${meta.baseline ? '⭐ Bỏ baseline' : '⭐ Baseline'}</button>
       <a class="button" href="/api/runs/${encodeURIComponent(meta.runId)}/export" download>⤓ Export HTML</a>`;
```

`ui/app.js` — trong `shell()`, đổi bộ lọc nav thành ẩn cả Live và Tests khi export:
```js
  const nav = NAV.filter(([v]) => !(isExport() && (v === 'live' || v === 'tests')))
```
và trong `watchLive()` không cần đổi (`liveStream` là no-op khi export). Ngay trước dòng `shell();` cuối file thêm:
```js
if (isExport() && !location.hash) location.hash = `#/run/${encodeURIComponent(globalThis.__E2ED_EXPORT__.runId)}`;
```

Thêm vào cuối `ui/style.css`:
```css
a.button { display: inline-block; border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; color: var(--text-primary); background: var(--surface); }
a.button:hover { text-decoration: none; background: var(--border); }
```

- [ ] **Step 4: Chạy, xác nhận pass**

Run: `npm test`
Expected: tất cả PASS

- [ ] **Step 5: Kiểm tra file export trên trình duyệt**

```bash
D=$(node test/seed-demo.mjs) && (cd "$D" && node "$OLDPWD/bin/dashboard.mjs" export)
```
Mở file in ra bằng `file://` (Chrome DevTools MCP `navigate_page`). Kiểm tra: tự vào Run detail; timeline, lỗi, log hiển thị; tab Trace (nếu có) render được; nav chỉ có Overview/Runs; footer ghi "Bản export"; không lỗi console; không có request mạng nào ngoài `data:`.

- [ ] **Step 6: Commit**

```bash
git add server/export.mjs server/app.mjs bin/dashboard.mjs ui/app.js ui/views/run.js ui/style.css test/export.test.mjs
git commit -m "feat: export a run as a self-contained HTML file"
```

---

### Task 17: Kiểm tra với e2e thật, chốt các điểm chưa xác minh, README

Mục tiêu: chạy plugin trên một project e2e thật, xác minh 5 điểm ở mục 9 của spec, sửa code ở chỗ thực tế khác giả định (mỗi sửa đổi đi kèm test tái hiện bằng dữ liệu thật), viết README.

**Files:**
- Create: `README.md`, `test/fixtures/real-report.json` (nếu cần cho test tái hiện), `test/fixtures/NOTICE` (bổ sung nguồn)
- Modify: tuỳ theo phát hiện; `docs/superpowers/specs/2026-10-10-e2e-dashboard-m1-design.md` mục 9 (ghi kết quả xác minh)

- [ ] **Step 1: Dựng project e2e thật**

```bash
W=/tmp/claude-e2e-real && rm -rf "$W" && git clone --depth 1 https://github.com/tester-army/e2e "$W"
cd "$W/examples/vite" && cat README.md
```
Làm theo README của example để cài (`npm install`, trình duyệt Playwright nếu cần). Xác định một tập test **không có agent step** (không cần model) hoặc có replay cache đã commit; nếu mọi test đều cần model mà máy không có provider, dùng `--grep` để chọn test không agent, hoặc viết thêm 2 test locator thuần trong `tests/dashboard-check.e2e.ts` (một pass, một cố ý fail bằng `expect(...).toContainText('không-tồn-tại')`).

Run: `npx e2e run`
Expected: run xong, có `.e2e/report.json`.

- [ ] **Step 2: Cài plugin từ thư mục local và xác minh tên lệnh**

Trong Claude Code (mở ở `$W/examples/vite`):
```
/plugin marketplace add /home/thangvo/Documents/Project/e2e-dashboard
/plugin install e2e-dashboard@e2e-dashboard
```
Khởi động lại Claude Code nếu được yêu cầu. Gõ `/e2e-dashboard`.
- Nếu chạy được không cần namespace → ghi "đã xác minh" vào spec mục 9.1.
- Nếu chỉ chạy được `/e2e-dashboard:e2e-dashboard` → ghi lại vào README phần sử dụng; không đổi cấu trúc.
- Nếu `!`-command không thay `${CLAUDE_PLUGIN_ROOT}` → đổi `commands/e2e-dashboard.md` sang hướng dẫn Claude chạy Bash `node "${CLAUDE_PLUGIN_ROOT}/bin/dashboard.mjs" $ARGUMENTS` trong phần "Việc của bạn", kiểm tra lại.

Expected: dashboard mở, nav footer báo "Chưa cài reporter".

- [ ] **Step 3: Hook (chưa cài reporter)**

Nhờ Claude: "chạy `npx e2e run`". Sau khi xong, trang Overview tự refresh hoặc reload → run mới có nguồn `hook` (hoặc `watcher` nếu watcher thắng — cả hai đều đúng, chỉ được có **một** bản).

- [ ] **Step 4: Setup + live + trace + artifact**

```
/e2e-dashboard setup
```
- Kiểm tra `e2e.config.ts` đã có import + `dashboardReporter`, output terminal của e2e vẫn còn (list reporter).
- Nếu project có `tsconfig.json`: `npx tsc --noEmit` không báo lỗi ở import reporter (file `.d.mts` có tác dụng). Nếu lỗi → sửa `TYPES` trong `bin/dashboard.mjs` theo thông báo, thêm test.
- Mở `#/live`, chạy `npx e2e run --trace on --workers 2` trong terminal riêng: thấy tiến độ, làn, step; sau khi xong có run nguồn `reporter`.
- Mở run đó: test fail có video/screenshot (request `/files` 200), tab Trace có nội dung. **Đối chiếu ánh xạ trace**: với ít nhất 2 test, nội dung trace phải đúng test đó. Nếu `resolveTraces` (Task 3) sai cho run qua watcher/hook (reporter có `traces` nên luôn đúng) → sửa heuristic, thêm test tái hiện với cấu trúc thư mục thật.
- Xác minh `artifactsRoot`: so `run-started.artifactsRoot` (xem `.e2e-dashboard/server.log` hoặc log tạm) với đường dẫn artifact thật; nếu không phải `<output>/results` thì sửa `outputFromArtifactsRoot` + test.
- Video tua đúng khi bấm step (lệch < 1 s chấp nhận được, spec 9.5).

- [ ] **Step 5: Export + stop**

```
/e2e-dashboard export
/e2e-dashboard stop
```
Mở file export bằng trình duyệt: xem được run, không lỗi console. Sau `stop`, `.e2e-dashboard/server.json` không còn, process đã tắt.

- [ ] **Step 6: Cờ CLI**

Chạy `npx e2e run --help` (hoặc đọc `node_modules/e2e/docs/reference/cli.mdx`) và ghi vào spec mục 9.2 việc `--target`/`--agent` có lặp được không (dùng cho M1b). Phiên bản `claude` đang cài: `claude --version`, `claude -p --help | grep -E 'allowedTools|max-turns|resume|output-format'` → ghi vào mục 9.3 (dùng cho M1b).

- [ ] **Step 7: README**

`README.md`:
````markdown
# e2e-dashboard

Plugin Claude Code cho [e2e](https://github.com/tester-army/e2e): dashboard local để xem live, lịch sử và debug các run.

- Không cài thêm gì: chỉ cần Node (e2e đã cần) — 0 dependency, không build.
- Dữ liệu ở `<project>/.e2e-dashboard/` (đã được thêm vào `.gitignore`), giữ 50 run gần nhất (run đã ghim không bị xoá).

## Cài

```
/plugin marketplace add thangvofastboy/e2e-dashboard
/plugin install e2e-dashboard@e2e-dashboard
```

## Dùng

| Lệnh | Việc |
|---|---|
| `/e2e-dashboard` | Mở dashboard (bật server nền nếu chưa chạy) |
| `/e2e-dashboard setup` | Gắn reporter vào `e2e.config.ts` để xem tiến độ live (commit 2 file `e2e-dashboard.reporter.*`) |
| `/e2e-dashboard export [runId]` | Xuất một run thành file HTML tự chứa để gửi cho người khác |
| `/e2e-dashboard status` / `stop` | Xem / tắt server |

Không cài reporter vẫn có lịch sử: run do Claude chạy được lưu qua hook, run bạn tự chạy được lưu khi dashboard đang mở.

## Cấu hình (tuỳ chọn) — `.e2e-dashboard/config.json`

```json
{ "output": ".e2e", "retention": 50, "port": 4477 }
```

## Bảo mật

Server chỉ nghe `127.0.0.1`, mọi request cần token (URL mở từ lệnh `/e2e-dashboard` tự đặt cookie). Reporter tự tắt khi `CI` được set.

## Phát triển

```
npm test                      # node --test, không dependency
node test/seed-demo.mjs       # tạo project demo với 12 run
```
````
Điền đúng dạng lệnh đã xác minh ở Step 2 vào bảng "Dùng".

- [ ] **Step 8: Chạy toàn bộ test, commit**

Run: `npm test`
Expected: tất cả PASS

```bash
git add README.md docs/superpowers/specs/2026-10-10-e2e-dashboard-m1-design.md
# cộng thêm đúng các file đã sửa ở Step 2–6 (liệt kê từng file, không add cả thư mục)
git commit -m "docs: README and verified assumptions against a real e2e project"
```
