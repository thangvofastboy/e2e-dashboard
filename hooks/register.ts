// Mod module. Plugin markdown commands are namespaced (`/e2e-dashboard:e2e-dashboard`), so the mod
// registers the bare `/e2e-dashboard` and runs the CLI itself (no model turn). `update` and `version`
// run here for both names; the namespaced one otherwise falls through to commands/e2e-dashboard.md.
import type { EngineInterface, Register } from 'claude-code'

// HTTPS: works without a GitHub SSH key (the marketplace itself is added over HTTPS)
const REPO = 'https://github.com/thangvofastboy/e2e-dashboard.git'
const MARKETPLACE = 'e2e-dashboard'
const PLUGIN_ID = `e2e-dashboard@${MARKETPLACE}`
const BARE = 'e2e-dashboard'
const OURS = /^(e2e-dashboard:)?e2e-dashboard$/

// Version the plugin manager now has installed, from `claude plugin list --json`.
async function installedVersion($: EngineInterface) {
  try {
    const run = await $.process.run(['claude', 'plugin', 'list', '--json'], { timeoutMs: 30000 })
    if (run.exitCode !== 0) return undefined
    const list = JSON.parse(run.stdout) as Array<{ id?: string; version?: string }>
    return list.find(p => p.id === PLUGIN_ID)?.version
  } catch {
    return undefined
  }
}

async function currentVersion($: EngineInterface) {
  try {
    return String(JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)).version)
  } catch {
    return '0.0.0'
  }
}

const semver = (v: string) =>
  v
    .replace(/^v/, '')
    .split('.')
    .map(n => Number.parseInt(n, 10) || 0)

export function compareVersions(a: string, b: string) {
  const [x, y] = [semver(a), semver(b)]
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

// Release tags on the repository (vX.Y.Z), newest first.
async function latestTag($: EngineInterface) {
  // From `/`, outside any repo: an open repo's own core.sshCommand never applies.
  const run = await $.process.run(['git', 'ls-remote', '--tags', '--refs', REPO], { cwd: '/', timeoutMs: 20000, env: { GIT_TERMINAL_PROMPT: '0' } })
  if (run.exitCode !== 0) throw new Error(run.stderr.trim() || `git ls-remote thoát mã ${run.exitCode}`)
  return run.stdout
    .split('\n')
    .map(line => line.split('refs/tags/')[1]?.trim())
    .filter((t): t is string => !!t && /^v\d+\.\d+\.\d+$/.test(t))
    .sort((a, b) => compareVersions(b, a))[0]
}

async function versionText($: EngineInterface) {
  const current = await currentVersion($)
  try {
    const latest = await latestTag($)
    const state = !latest ? 'chưa có tag nào' : compareVersions(latest, current) > 0 ? `có bản mới ${latest}: /e2e-dashboard update` : 'đã mới nhất'
    return `e2e-dashboard v${current} · ${state}`
  } catch (error) {
    return `e2e-dashboard v${current} · không kiểm tra được tag: ${error instanceof Error ? error.message : String(error)}`
  }
}

// The plugin manager owns the installed copy (a versioned cache dir), so an update goes through it:
// refresh the marketplace (pins the newest tag), update the plugin, then let the engine re-read it.
async function updatePlugin($: EngineInterface) {
  // installed copies live in <config dir>/plugins/cache/… (any CLAUDE_CONFIG_DIR, any path separator)
  if (!$.plugin.root.replaceAll('\\', '/').includes('/plugins/cache/')) {
    return [
      `Plugin đang chạy từ thư mục dev (${$.plugin.root}), không phải bản cài từ marketplace.`,
      'Cài bản phát hành để nhận update:',
      `  /plugin marketplace add thangvofastboy/${MARKETPLACE}`,
      `  /plugin install ${PLUGIN_ID}`,
    ].join('\n')
  }
  const current = await currentVersion($)
  let latest: string | undefined
  try {
    latest = await latestTag($)
  } catch {
    // unknown: let the plugin manager decide
  }
  if (latest && compareVersions(latest, current) <= 0) return `✓ Đã là bản mới nhất (v${current}).`
  const outputs: string[] = []
  for (const args of [
    ['plugin', 'marketplace', 'update', MARKETPLACE],
    ['plugin', 'update', PLUGIN_ID],
  ]) {
    const run = await $.process.run(['claude', ...args], { timeoutMs: 120000 })
    const out = `${run.stdout}${run.stderr}`.trim()
    if (run.exitCode !== 0) return `✗ 'claude ${args.join(' ')}' thất bại (mã ${run.exitCode})${out ? `:\n${out}` : ''}`
    if (out) outputs.push(out)
  }
  // Report what the plugin manager actually installed, not what the tag list promised.
  const installed = await installedVersion($)
  if (installed && compareVersions(installed, current) <= 0) {
    return [...outputs, `ℹ Vẫn là v${current}: marketplace chưa trỏ tới bản mới hơn${latest ? ` (${latest})` : ''}.`].join('\n')
  }
  // The new version is only on disk: have the engine re-read plugins once this command has returned.
  $.clock.after(500, () => void $.command.run({ command: 'reload-plugins' }).catch(() => undefined))
  return [...outputs, `✓ v${current} → v${installed ?? latest ?? 'mới nhất'}`, '🔄 Đang nạp lại plugin (/reload-plugins)...'].join('\n')
}

// start | setup | stop | status | export [runId] | digest | projects | statusline: the same CLI the markdown command runs, argv without a shell.
async function runCli($: EngineInterface, argv: string[]) {
  const run = await $.process.run(['node', `${$.plugin.root}/bin/dashboard.mjs`, ...argv], {
    timeoutMs: 60000,
    env: { CLAUDE_PLUGIN_ROOT: $.plugin.root },
  })
  const out = `${run.stdout}${run.stderr}`.trim() || `dashboard.mjs thoát mã ${run.exitCode}`
  // the config edit needs the model: the namespaced markdown command hands it to Claude
  return out.includes('NEEDS_MANUAL_EDIT') ? `${out}\n\nChạy /${BARE}:${BARE} setup để Claude sửa config giúp.` : out
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command
      .register({ name: BARE, description: 'Mở dashboard e2e (live, lịch sử, debug)', argumentHint: '[setup|export [runId]|stop|status|digest [ngày]|projects|statusline [install]|quarantine|import <path>|share push|pull|update|version]' })
      .catch(() => undefined)
    return next(e)
  })

  on('command.run', async ($, e, next) => {
    if (!OURS.test(e.command)) return next(e)
    const argv = e.args.trim() ? e.args.trim().split(/\s+/) : []
    const sub = argv[0]
    if (sub !== 'update' && sub !== 'version' && e.command !== BARE) return next(e)
    try {
      if (sub === 'update') return { text: await updatePlugin($) }
      if (sub === 'version') return { text: await versionText($) }
      return { text: await runCli($, argv) }
    } catch (error) {
      return { text: `✗ ${sub ?? 'start'} thất bại: ${error instanceof Error ? error.message : String(error)}` }
    }
  })
}
