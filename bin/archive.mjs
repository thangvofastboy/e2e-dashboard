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
