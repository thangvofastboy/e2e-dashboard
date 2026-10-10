#!/usr/bin/env node
import http from 'node:http';
import { mkdir, writeFile, rm, readFile, rename } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DATA_DIR, VERSION, RUN_ID, readConfig, archive, isLink } from '../reporter/e2e-dashboard.reporter.mjs';
import { createNotifier, notifyMode, runMessage } from './notify.mjs';
import { createScheduler, scheduleTimes, createTestWatcher } from './automation.mjs';
import { webhookConfig, sendWebhooks } from './webhook.mjs';
import { readQuarantine, quarantineFlags } from './quarantine.mjs';
import { registerProject } from './projects.mjs';
import { createRunner } from './runner.mjs';
import { createAi } from './ai.mjs';
import { annotateRun, loadHistory } from './store.mjs';
import { anomalies } from './insights.mjs';
import { createApp } from './app.mjs';
import { createLive } from './live.mjs';
import { watchReport, outputFromArtifactsRoot } from './watch.mjs';

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
export async function finishDashboardRun({ projectRoot, beforeId, rerunOf, outputDir }) {
  const id = await readReportId(projectRoot, outputDir);
  if (!id || id === beforeId) return null;
  await archive(projectRoot, { source: 'dashboard', outputDir }).catch(() => null); // "exists" when the watcher won
  const meta = await annotateRun(projectRoot, id, { launchedBy: 'dashboard', rerunOf: RUN_ID.test(rerunOf ?? '') ? rerunOf : undefined }).catch(() => null);
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
  const path = join(projectRoot, DATA_DIR, 'live.json');
  let lastAt = 0;
  let pending = null;
  let timer = null;
  const write = async (s) => {
    lastAt = Date.now();
    if (isLink(join(projectRoot, DATA_DIR))) return;
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

export async function startServer({ projectRoot, port, token = randomToken(), uiDir = UI_DIR, register = true, notifier }) {
  const cfg = readConfig(projectRoot);
  const preferred = port ?? cfg.port ?? 4477;
  const live = createLive();
  const liveFile = liveFileWriter(projectRoot);
  live.subscribe((s) => liveFile.update(s));
  notifier ??= createNotifier({ mode: notifyMode(cfg), project: basename(projectRoot) });
  const startedAt = Date.now();
  let last = null; // shown in /api/info so a skipped report (bad schema, unsafe path) is not silent
  // a report written after this server started is a finished run: tell the desktop (M3)
  const onArchive = async (r) => {
    last = r;
    if (r.runDir && (r.status === 'archived' || r.status === 'exists')) {
      const meta = await readMeta(r.runDir);
      if (meta && Date.parse(meta.finishedAt ?? meta.startedAt) >= startedAt - 5000) {
        const found = await loadHistory(projectRoot, 31).then((h) => anomalies(h, { runId: meta.runId })).catch(() => []);
        notifier.runFinished(meta, { anomalies: found.length });
        if (meta.status !== 'passed' || meta.summary?.flaky || found.length) {
          const m = runMessage(meta, basename(projectRoot));
          const hooks = await webhookConfig().catch(() => []);
          if (hooks.length) sendWebhooks(hooks, 'run-failed', `${m.title} · ${m.body}${found.length ? ` · ${found.length} bất thường` : ''}`).catch(() => {});
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
    onExit: async ({ rerunOf }) => {
      await finishDashboardRun({ projectRoot, beforeId, rerunOf, outputDir: cfg.output });
    },
  });
  // Scheduled runs and watch mode share the runner (one run at a time) and skip quarantined tests.
  const grepInvert = async () => quarantineFlags(await readQuarantine(projectRoot)).args.filter((x) => x !== '--grep-invert');
  const startAuto = async (opts) => {
    try {
      return runner.start({ ...opts, grepInvert: await grepInvert() });
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };
  const tests = Array.isArray(cfg.schedule?.tests) ? cfg.schedule.tests.filter((t) => typeof t === 'string').slice(0, 200) : [];
  let lastScheduled = null;
  const scheduler = createScheduler({ times: scheduleTimes(cfg), start: () => void startAuto({ tests }).then((r) => (lastScheduled = r)) });
  let lastWatch = null;
  const testWatcher = createTestWatcher({ projectRoot, onChange: (files) => void startAuto({ tests: files }).then((r) => (lastWatch = { at: new Date().toISOString(), files, ok: r.ok, error: r.error ?? null })) });
  const automation = {
    state: () => ({ schedule: { ...scheduler.state(), lastResult: lastScheduled }, watch: { enabled: testWatcher.enabled(), last: lastWatch } }),
    setWatch: (on) => {
      const ok = on ? testWatcher.enable() : (testWatcher.disable(), true);
      return { enabled: testWatcher.enabled(), ok };
    },
  };
  const app = createApp({
    automation,
    projectRoot, token, uiDir, live, lastArchive: () => last, runner,
    ai: createAi({ projectRoot, model: typeof cfg.ai?.model === 'string' && /^[\w.:][\w.:-]{0,79}$/.test(cfg.ai.model) ? cfg.ai.model : undefined }),
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
  if (register) await registerProject(projectRoot).catch(() => {}); // the Projects page lists every dashboard ever opened
  return {
    port: bound,
    token,
    url: `http://127.0.0.1:${bound}/?token=${token}`,
    async close() {
      watcher.close();
      scheduler.close();
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
  process.stdout.write(`${JSON.stringify({ port: s.port, url: s.url })}\n`);
  const stop = () => s.close().finally(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
