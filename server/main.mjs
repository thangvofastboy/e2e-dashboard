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
  let last = null; // shown in /api/info so a skipped report (bad schema, unsafe path) is not silent
  const watcher = watchReport({ projectRoot, outputDir: resolve(projectRoot, cfg.output ?? '.e2e'), onResult: (r) => (last = r) });
  const app = createApp({
    projectRoot, token, uiDir, live, lastArchive: () => last,
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
