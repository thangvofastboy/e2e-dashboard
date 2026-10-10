import { expect, test } from 'claude-code/testing'

const run = ($: Parameters<Parameters<typeof test>[1]>[0], args: string) =>
  $.command.run({ command: 'e2e-dashboard', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

test('/e2e-dashboard update from a dev folder explains how to install and never reloads', async ($, on) => {
  const reloads: string[] = []
  on('command.run', { command: 'reload-plugins' }, (_$, e) => {
    reloads.push(e.command)
    return { text: 'reloaded' }
  })
  const ran = await run($, 'update')
  expect(ran.text).toContain('/plugin install e2e-dashboard@e2e-dashboard')
  expect(reloads).toEqual([])
})

test('/e2e-dashboard version reports the installed version', async $ => {
  const ran = await run($, 'version')
  expect(ran.text).toContain('e2e-dashboard v')
})

test('/e2e-dashboard is registered under its bare name, not only the plugin-namespaced one', async ($, on) => {
  const names: string[] = []
  on('command.register', (_$, e) => {
    names.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: null } as Parameters<typeof $.session.start>[0])
  expect(names).toContain('e2e-dashboard')
})

test('/e2e-dashboard status runs the CLI directly, argv without a shell, and relays its output', async ($, on) => {
  const argvs: string[][] = []
  on('process.run', (_$, e) => {
    argvs.push([...e.argv])
    return { value: { exitCode: 0, stdout: 'Dashboard không chạy.\n', stderr: '' } }
  })
  const ran = await run($, 'status')
  expect(ran.text).toBe('Dashboard không chạy.')
  expect(argvs).toHaveLength(1)
  expect(argvs[0][0]).toBe('node')
  expect(argvs[0][1]).toEndWith('/bin/dashboard.mjs')
  expect(argvs[0].slice(2)).toEqual(['status'])
})
