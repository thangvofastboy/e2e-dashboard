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
