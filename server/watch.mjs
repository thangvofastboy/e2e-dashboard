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
    try {
      watcher = watch(outputDir, (_event, file) => {
        if (file && file !== 'report.json') return;
        clearTimeout(timer);
        timer = setTimeout(run, debounceMs);
      });
    } catch {
      poll = setTimeout(start, 1000); // ENOENT race or inotify limit: retry instead of crashing the server
      return;
    }
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
