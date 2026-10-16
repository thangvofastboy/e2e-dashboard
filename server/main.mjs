#!/usr/bin/env node
import http from 'node:http';
import { appendFileSync, mkdirSync } from 'node:fs';
import { createSelfHeal, crashPathFor } from './selfheal.mjs';
import { summarizeRun } from './aiextra.mjs';
import { autoLogBugs } from './autobug.mjs';
import { syncIndex } from './runindex.mjs';
import { playwrightToReport } from './playwright.mjs';
import { readUserConfig, aiPrefs } from './system.mjs';
import { resolveLinear, detectMcpLinear } from './linear-mcp.mjs';
import { mkdir, writeFile, rm, readFile, rename } from 'node:fs/promises';
import { join, resolve, basename, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DATA_DIR, VERSION, RUN_ID, readConfig, archive, isLink, dataPath, ensureDataDir } from '../reporter/e2e-dashboard.reporter.mjs';
import { createNotifier, notifyMode, runMessage } from './notify.mjs';
import { createScheduler, scheduleTimes, createTestWatcher } from './automation.mjs';
import { webhookConfig, sendWebhooks, mentionMap, mentionsFor } from './webhook.mjs';
import { readCodeowners, ownersOf } from './owners.mjs';
import { readQuarantine, quarantineFlags } from './quarantine.mjs';
import { registerProject } from './projects.mjs';
import { createScheduleRunner, recordRun, scheduleRootAllowed } from './schedules.mjs';
import { createRunner } from './runner.mjs';
import { createAi, AI_NO_TOOLS_ARGS } from './ai.mjs';
import { annotateRun, loadHistory, getRun, forgetRuns } from './store.mjs';
import { anomalies } from './insights.mjs';
import { createApp } from './app.mjs';
import { createLive } from './live.mjs';
import { watchReport, outputFromArtifactsRoot } from './watch.mjs';
import { checkAlerts } from './tracking.mjs';
import { syncLongterm } from './longterm.mjs';
import { ciConfig, createCiSync, syncCi } from './cisync.mjs';
import { reportSchedule, createReportScheduler, sendReport } from './reports.mjs';
import { publishSite } from './site.mjs';
import { readSettings } from './settings.mjs';
import { createLearner, effectiveTestDir, readMemory } from './aimemory.mjs';
import { quickSetupRunning, updateE2ePackages } from './quicksetup.mjs';

const UI_DIR = fileURLToPath(new URL('../ui', import.meta.url));

async function readReportId(projectRoot, outputDir) {
  try {
    return JSON.parse(await readFile(join(resolve(projectRoot, outputDir ?? '.e2e'), 'report.json'), 'utf8')).run?.id ?? null;
  } catch {
    return null;
  }
}

// After a dashboard-started run: tag the run it produced, and only if e2e actually wrote a new report
// (a stop during start-up, a config error or a missing binary leaves the previous one in place).
// playwrightJson: run Playwright (file *.spec.ts) — reporter JSON đổi sang report-1 rồi lưu như run e2e; onArchived nhận kết quả
// archive (watcher của .e2e/report.json không thấy run này: chỉ mục SQLite, thông báo… cần gọi tay)
export async function finishDashboardRun({ projectRoot, beforeId, rerunOf, outputDir, browser = null, playwrightJson = null, onArchived = () => {} }) {
  if (playwrightJson) {
    let report;
    try {
      report = playwrightToReport(JSON.parse(await readFile(playwrightJson, 'utf8')), projectRoot);
    } catch {
      return null; // Playwright lỗi trước khi ghi report (config sai, bị dừng sớm): không có run để lưu
    }
    const r = await archive(projectRoot, { source: 'dashboard', report }).catch(() => null);
    if (r?.status !== 'archived') return null;
    await annotateRun(projectRoot, report.run.id, { launchedBy: 'dashboard', rerunOf: RUN_ID.test(rerunOf ?? '') ? rerunOf : undefined, browser }).catch(() => null);
    await onArchived(r);
    return report.run.id;
  }
  const id = await readReportId(projectRoot, outputDir);
  if (!id || id === beforeId) return null;
  await archive(projectRoot, { source: 'dashboard', outputDir }).catch(() => null); // "exists" when the watcher won
  const meta = await annotateRun(projectRoot, id, { launchedBy: 'dashboard', rerunOf: RUN_ID.test(rerunOf ?? '') ? rerunOf : undefined, browser }).catch(() => null);
  return meta ? id : null;
}
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

// A small live.json beside server.json, for the status line (which reads files, never the network).
export function liveFileWriter(projectRoot, { minIntervalMs = 1000 } = {}) {
  const path = dataPath(projectRoot, 'live.json'); // runtime/live.json
  let lastAt = 0;
  let pending = null;
  let timer = null;
  const write = async (s) => {
    lastAt = Date.now();
    if (isLink(join(projectRoot, DATA_DIR)) || isLink(dirname(path))) return;
    await mkdir(dirname(path), { recursive: true }).catch(() => {});
    const tmp = `${path}.tmp-${randomBytes(4).toString('hex')}`;
    const body = { status: s.status, runStatus: s.runStatus ?? null, runId: s.runId ?? null, done: s.done ?? 0, total: s.total ?? 0, startedAt: s.startedAt ?? null, at: new Date().toISOString() };
    await writeFile(tmp, JSON.stringify(body)).then(() => rename(tmp, path)).catch(() => rm(tmp, { force: true }));
  };
  return {
    update(s) {
      pending = s;
      if (s.status !== 'running' || Date.now() - lastAt >= minIntervalMs) {
        clearTimeout(timer);
        timer = null;
        return write(s);
      }
      timer ??= setTimeout(() => {
        timer = null;
        write(pending);
      }, minIntervalMs);
      return Promise.resolve();
    },
    async close() {
      clearTimeout(timer);
      await rm(path, { force: true });
    },
  };
}

async function readMeta(runDir) {
  try {
    return JSON.parse(await readFile(join(runDir, 'meta.json'), 'utf8'));
  } catch {
    return null;
  }
}

// crash của server: ghi đồng bộ (process sắp dừng, không chờ được async), lần khởi động sau selfheal.mjs đọc vào
let crashWatched = false;
function watchCrashes(projectRoot) {
  if (crashWatched) return;
  crashWatched = true;
  process.on('uncaughtExceptionMonitor', (e) => {
    try {
      const crash = crashPathFor(projectRoot); // ~/.e2e-dashboard/selfheal/<project>-crash.jsonl (ngoài repo)
      if (isLink(crash)) return;
      mkdirSync(dirname(crash), { recursive: true, mode: 0o700 });
      appendFileSync(crash, `${JSON.stringify({ message: String(e?.message ?? e).slice(0, 1000), stack: String(e?.stack ?? '').slice(0, 3000) })}\n`);
    } catch {
      // không ghi được: bỏ qua, process đang dừng
    }
  });
}

export async function startServer({ projectRoot, port, token = randomToken(), uiDir = UI_DIR, register = true, notifier }) {
  // .e2e-dashboard/ là symlink (repo clone cài sẵn): từ chối trước khi bật watcher / timer nào
  if (!(await ensureDataDir(projectRoot))) throw new Error('unsafe data dir');
  const cfg = readConfig(projectRoot);
  const preferred = port ?? cfg.port ?? 4477;
  const live = createLive();
  const liveFile = liveFileWriter(projectRoot);
  live.subscribe((s) => liveFile.update(s));
  notifier ??= createNotifier({ mode: notifyMode(cfg), project: basename(projectRoot) });
  const startedAt = Date.now();
  let last = null; // shown in /api/info so a skipped report (bad schema, unsafe path) is not silent
  // a report written after this server started is a finished run: tell the desktop (M3)
  // bối cảnh dự án (Cài đặt › Dự án) gửi kèm mọi lần gọi AI
  // + thư mục test (đặt hoặc đoán) và bản ghi nhớ AI tự viết về hệ thống (server/aimemory.mjs)
  const project = async () => {
    const st = await readSettings(projectRoot);
    const [td, mem] = await Promise.all([effectiveTestDir(projectRoot, st), readMemory(projectRoot)]);
    return { ...st, testDir: td.path, memory: mem?.text ?? '' };
  };
  const ai = createAi({ projectRoot, project, settings: () => aiPrefs(process.env, readConfig(projectRoot)) });
  // viết nội dung QC theo mẫu (kể cả tự log bug): không có công cụ nào
  const qcAi = createAi({ projectRoot, project, args: AI_NO_TOOLS_ARGS, settings: () => aiPrefs(process.env, readConfig(projectRoot)) });
  // AI ghi nhớ dự án: đọc thư mục test + thư mục nguồn, viết bản ghi nhớ. Mỗi project một AI riêng (cwd = project),
  // bối cảnh gửi kèm không có bản ghi nhớ cũ (viết lại từ mã nguồn, không chép lại chính nó); cho phép chạy lâu hơn
  const learnAis = new Map();
  const learner = createLearner({
    aiFor: (root) => {
      if (!learnAis.has(root)) {
        learnAis.set(root, createAi({ projectRoot: root, timeoutMs: 600_000, maxConcurrent: 1, settings: () => aiPrefs(process.env, readConfig(root)), project: async () => {
          const st = await readSettings(root);
          return { ...st, testDir: (await effectiveTestDir(root, st)).path };
        } }));
      }
      return learnAis.get(root);
    },
  });
  void syncIndex(projectRoot).catch(() => {}); // chỉ mục SQLite: dựng / bổ sung nền lúc khởi động
  const onArchive = async (r) => {
    forgetRuns(); // run mới vừa ghi: lần quét đang chạy (bắt đầu trước đó) không có nó
    last = r;
    void syncIndex(projectRoot).catch(() => {});
    if (r.runDir && (r.status === 'archived' || r.status === 'exists')) {
      const meta = await readMeta(r.runDir);
      // M7: long-term rollups and alert rules follow every archived run
      if (meta) void checkAlerts(projectRoot, { notifier }).catch(() => {});
      if (meta && Date.parse(meta.finishedAt ?? meta.startedAt) >= startedAt - 5000) {
        const found = await loadHistory(projectRoot, 31).then((h) => anomalies(h, { runId: meta.runId })).catch(() => []);
        notifier.runFinished(meta, { anomalies: found.length });
        // tóm tắt AI cho run có test không pass (tắt: "ai": { "autoSummary": false } trong ~/.e2e-dashboard/config.json)
        if (meta.status !== 'passed' && readUserConfig().ai?.autoSummary !== false) void summarizeRun({ projectRoot, ai, runId: meta.runId, language: cfg.ai?.language }).catch(() => {});
        // tự log bug lên Linear (mặc định tắt: "ai": { "autoBugLog": true }); lỗi không làm hỏng việc khác
        if (meta.status !== 'passed' && readUserConfig().ai?.autoBugLog === true) void autoLogBugs({ projectRoot, runId: meta.runId, ai: qcAi, cfg, resolve: () => resolveLinear({ projectRoot, cfg, env: process.env, settings: () => aiPrefs(process.env, readConfig(projectRoot)) }) }).then((r) => { const made = r.rows?.filter((x) => x.status === 'created') ?? []; if (made.length) console.log(`[e2e-dashboard] đã tạo ${made.length} issue Linear: ${made.map((x) => x.issue).join(', ')}`); }).catch((e) => console.error(`[e2e-dashboard] tự log bug lỗi: ${e.message}`));
        if (meta.status !== 'passed' || meta.summary?.flaky || found.length) {
          const m = runMessage(meta, basename(projectRoot));
          const hooks = await webhookConfig().catch(() => []);
          if (hooks.length) {
            // mention the owners (CODEOWNERS) of the failing tests, when mapped to chat handles
            const run = await getRun(projectRoot, meta.runId).catch(() => null);
            const { rules } = readCodeowners(projectRoot);
            const owners = (run?.report.run.results ?? []).filter((r) => ['failed', 'timed-out', 'interrupted'].includes(r.status)).flatMap((r) => ownersOf(rules, r.source?.file ?? r.file));
            const who = mentionsFor(owners, await mentionMap().catch(() => ({})));
            sendWebhooks(hooks, 'run-failed', `${m.title} · ${m.body}${found.length ? ` · ${found.length} bất thường` : ''}`, { mentions: who }).catch(() => {});
          }
        }
      }
    }
  };
  const watcher = watchReport({ projectRoot, outputDir: resolve(projectRoot, cfg.output ?? '.e2e'), onResult: (r) => void onArchive(r) });
  // Runs started from the dashboard: archive as soon as e2e exits, then tag the run (spec §4.5).
  let beforeId = null;
  const runner = createRunner({
    projectRoot,
    live,
    beforeStart: () => readReportId(projectRoot, cfg.output).then((id) => (beforeId = id)),
    onExit: async ({ rerunOf, browser, playwrightJson }) => {
      await finishDashboardRun({ projectRoot, beforeId, rerunOf, outputDir: cfg.output, browser, playwrightJson, onArchived: onArchive });
    },
  });
  // e2e mới nhất (tester-army/e2e) mỗi lần mở dashboard; tắt: "e2e": { "autoUpdate": false } trong ~/.e2e-dashboard/config.json
  if (readUserConfig().e2e?.autoUpdate !== false && !process.env.NODE_TEST_CONTEXT) {
    void updateE2ePackages(projectRoot, { idle: () => !runner.state().running && live.snapshot().status !== 'running' }).then((r) => {
      if (r.status === 'updated') console.log(`[e2e-dashboard] đã cập nhật ${r.packages.map((p) => `${p.name} ${p.from ?? '?'} → ${p.to}`).join(', ')}`);
      else if (r.status === 'failed') console.error(`[e2e-dashboard] cập nhật e2e lỗi (mã ${r.exitCode}): chạy tay ${r.command}`);
    }).catch((e) => console.error(`[e2e-dashboard] không kiểm tra được bản e2e mới: ${e.message}`));
  }
  // Scheduled runs and watch mode share the runner (one run at a time) and skip quarantined tests.
  // e2e: grepInvert (một mẫu mỗi test); Playwright (*.spec.ts): grepInvertPw (một regex, kèm tên file)
  const quarantineOpts = async (root) => {
    const q = quarantineFlags(await readQuarantine(root));
    return { grepInvert: q.args.filter((x) => x !== '--grep-invert'), grepInvertPw: q.pw };
  };
  const startAuto = async (opts) => {
    if (quickSetupRunning(projectRoot)) return { ok: false, error: 'Quick Setup đang cài thư viện' }; // node_modules đang được ghi
    try {
      const { workers, browser, headed } = await readSettings(projectRoot); // worker / trình duyệt / headed mặc định ở Settings
      return runner.start({ ...opts, ...(workers ? { workers } : {}), browser, headed, ...(await quarantineOpts(projectRoot)) });
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };
  // Lịch tạo trên UI (~/.e2e-dashboard/schedules.json): project này chạy qua runner chính (thấy ở Live),
  // project khác qua một runner riêng cho thư mục đó; reporter + finishDashboardRun lưu run vào project đó.
  const otherRunners = new Map();
  const runnerFor = (root) => {
    if (!otherRunners.has(root)) {
      const out = readConfig(root).output;
      let before = null;
      otherRunners.set(root, createRunner({
        projectRoot: root,
        live: createLive(),
        beforeStart: () => readReportId(root, out).then((id) => (before = id)),
        onExit: async ({ exitCode, browser, playwrightJson }) => {
          await finishDashboardRun({ projectRoot: root, beforeId: before, rerunOf: null, outputDir: out, browser, playwrightJson, onArchived: () => syncIndex(root).catch(() => {}) }).catch(() => {});
          await recordRun(otherRunners.get(root).scheduleId, { exitCode }).catch(() => {});
        },
      }));
    }
    return otherRunners.get(root);
  };
  const startScheduled = async (s) => {
    const { excludeQuarantined, ...opts } = s.options ?? {};
    const root = resolve(s.root);
    try {
      if (quickSetupRunning(root)) return { ok: false, error: 'Quick Setup đang cài thư viện' };
      if (!(await scheduleRootAllowed(s, projectRoot))) return { ok: false, error: 'Project của lịch này đã bị gỡ khỏi Projects: thêm lại project hoặc xoá lịch.' };
      const defaults = await readSettings(root);
      const q = excludeQuarantined === false ? { grepInvert: [], grepInvertPw: null } : await quarantineOpts(root);
      const full = { ...(defaults.workers ? { workers: defaults.workers } : {}), browser: defaults.browser, ...(defaults.headed ? { headed: true } : {}), ...opts, ...q }; // headed: lịch bật riêng, không thì theo Settings
      if (root === resolve(projectRoot)) return runner.start(full);
      const other = runnerFor(root);
      const r = other.start(full);
      if (r.ok) other.scheduleId = s.id; // gán sau khi chạy được: lịch khác gặp "busy" không chiếm exit code của run đang chạy
      return r;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };
  const userSchedules = createScheduleRunner({ start: startScheduled });
  const tests = Array.isArray(cfg.schedule?.tests) ? cfg.schedule.tests.filter((t) => typeof t === 'string').slice(0, 200) : [];
  let lastScheduled = null;
  const scheduler = createScheduler({ times: scheduleTimes(cfg), start: () => void startAuto({ tests }).then((r) => (lastScheduled = r)) });
  let lastWatch = null;
  const testWatcher = createTestWatcher({ projectRoot, onChange: (files) => void startAuto({ tests: files }).then((r) => (lastWatch = { at: new Date().toISOString(), files, ok: r.ok, error: r.error ?? null })) });
  const automation = {
    runSchedule: startScheduled,
    state: () => ({ schedule: { ...scheduler.state(), lastResult: lastScheduled }, watch: { enabled: testWatcher.enabled(), last: lastWatch } }),
    setWatch: (on) => {
      const ok = on ? testWatcher.enable() : (testWatcher.disable(), true);
      return { enabled: testWatcher.enabled(), ok };
    },
  };
  // M7: CI auto-sync and scheduled reports, while the dashboard runs
  void syncLongterm(projectRoot).catch(() => {});
  const makeCi = (c) => createCiSync({ root: projectRoot, config: ciConfig(c), sync: (x) => syncCi(projectRoot, x).then(async (out) => {
    if (out.imported) await checkAlerts(projectRoot, { notifier }).catch(() => {});
    return out;
  }) });
  let ci = makeCi(cfg);
  const reports = createReportScheduler({ root: projectRoot, schedule: reportSchedule(cfg) });
  const tracking = {
    get ci() { return ci; },
    // sau khi lưu cấu hình CI từ UI: dựng lại timer theo config mới, không cần khởi động lại dashboard
    reloadCi: () => {
      ci.close();
      ci = makeCi(readConfig(projectRoot));
    },
    sendReport: (kind) => sendReport(projectRoot, kind), publish: () => publishSite(projectRoot) };
  const selfHeal = createSelfHeal({ projectRoot });
  selfHeal.ingestCrashes();
  watchCrashes(projectRoot);
  const app = createApp({
    selfHeal,
    tracking,
    automation,
    projectRoot, token, uiDir, live, lastArchive: () => last, runner,
    ai,
    qcAi,
    learner,
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
        // nothing will call close(): stop every timer and watcher started above, or the process lingers
        watcher.close();
        scheduler.close();
        userSchedules.close();
        ci.close();
        reports.close();
        testWatcher.disable();
        await liveFile.close().catch(() => {});
        throw e;
      }
    }
  }
  const infoPath = join(projectRoot, DATA_DIR, 'server.json');
  // tmp + rename: symlink server.json cài sẵn trong repo bị thay thế, không bị ghi xuyên qua (ghi đè file đích bằng token)
  const infoTmp = `${infoPath}.tmp-${randomBytes(4).toString('hex')}`;
  await writeFile(infoTmp, JSON.stringify({ port: bound, pid: process.pid, token, version: VERSION }), { mode: 0o600, flag: 'wx' });
  await rename(infoTmp, infoPath);
  if (register) await registerProject(projectRoot).catch(() => {}); // the Projects page lists every dashboard ever opened
  return {
    port: bound,
    token,
    url: `http://127.0.0.1:${bound}/?token=${token}`,
    async close() {
      watcher.close();
      scheduler.close();
      userSchedules.close();
      ci.close();
      reports.close();
      testWatcher.disable();
      await liveFile.close();
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
      await rm(infoPath, { force: true });
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const s = await startServer({ projectRoot: resolve(process.argv[2] ?? process.cwd()) });
  void detectMcpLinear(); // MCP Linear: kiểm tra sớm ở nền để hộp thoại Linear không phải chờ
  process.stdout.write(`${JSON.stringify({ port: s.port, url: s.url })}\n`);
  const stop = () => s.close().finally(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
