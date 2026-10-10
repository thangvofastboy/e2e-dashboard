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
