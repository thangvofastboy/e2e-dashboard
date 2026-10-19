import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Flaky, Gate, Live, RunSummary, Server, Slo, View } from '../types'
import { cleanLive, cleanRun, num, parseServer, passRate } from './pane-pure'

const PANE = 'e2e-pane'
const POLL_MS = 1000
const RUN_EVERY = 5 // /api/runs: every 5 s
const SLOW_EVERY = 15 // gate, SLO, budget, flaky: every 15 s, and at the end of a run
const TREND = 10
const NOT_RUNNING = 'Dashboard chưa chạy. Mở dashboard bằng /e2e-dashboard trước.'
const EMPTY: View = {
  live: null, run: null, prevRate: null, trend: [], etaMs: null, server: null,
  gate: null, slo: null, budgetOver: [], flaky: [], progressFrom: 0, error: null,
}
const view = atom({ plugin: 'e2e-dashboard', key: 'view' } as const, EMPTY)

type Palette = { run: string; good: string; warn: string; bad: string; muted: string; track: string }
// Status colors keep their meaning in every theme: good / warn / bad.
const THEMES: Record<string, Palette> = {
  default: { run: '#3b82f6', good: '#16a34a', warn: '#ca8a04', bad: '#dc2626', muted: '#64748b', track: '#64748b33' },
  ocean: { run: '#0ea5e9', good: '#14b8a6', warn: '#f59e0b', bad: '#f43f5e', muted: '#94a3b8', track: '#94a3b833' },
  forest: { run: '#84cc16', good: '#22c55e', warn: '#eab308', bad: '#ef4444', muted: '#a8a29e', track: '#a8a29e33' },
  sunset: { run: '#f472b6', good: '#22c55e', warn: '#fb923c', bad: '#e11d48', muted: '#a1a1aa', track: '#a1a1aa33' },
  light: { run: '#2563eb', good: '#15803d', warn: '#a16207', bad: '#b91c1c', muted: '#475569', track: '#47556933' },
}
const THEME_NAMES = Object.keys(THEMES)
const theme = atom({ plugin: 'e2e-dashboard', key: 'theme' } as const, 'default')
const motion = atom({ plugin: 'e2e-dashboard', key: 'motion' } as const, true)
const BARS = '▁▂▃▄▅▆▇█'

// Desktop charts: inline SVG in an interactive frame, so SMIL animation, :hover and <title> tooltips run.
// Every attribute holds its FINAL value and <animate> only runs from the start value, so a host that skips
// animation still draws the finished chart. `motion` false drops every <animate>.
const anim = (motion: boolean, xml: string) => (motion ? xml : '')
const EASE = 'calcMode="spline" keyTimes="0;1" keySplines="0.2 0.8 0.2 1"'
const SVG = 'xmlns="http://www.w3.org/2000/svg"'

const ring = (t: Palette, from: number, to: number, color: string, label: string, caption: string, motion: boolean) => {
  const r = 48
  const len = 2 * Math.PI * r
  const dash = (p: number) => `${(Math.max(0, Math.min(100, p)) / 100) * len} ${len}`
  const move = anim(motion, `<animate attributeName="stroke-dasharray" from="${dash(from)}" to="${dash(to)}" dur="0.9s" fill="freeze" ${EASE}/>`)
  const arc = (extra: string) => `<circle cx="70" cy="70" r="${r}" fill="none" stroke="url(#g)" stroke-width="12" stroke-linecap="round" stroke-dasharray="${dash(to)}" transform="rotate(-90 70 70)" ${extra}>${move}</circle>`
  return `<svg ${SVG} viewBox="0 0 140 140" width="140" height="140">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity=".6"/></linearGradient>
<filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="4"/></filter></defs>
<circle cx="70" cy="70" r="${r}" fill="none" stroke="${t.track}" stroke-width="12"/>
${arc('filter="url(#glow)" opacity=".5"')}
${arc('')}
<text x="70" y="75" text-anchor="middle" font-family="system-ui,sans-serif" font-size="28" font-weight="700" fill="currentColor">${label}</text>
<text x="70" y="95" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="${t.muted}">${caption}</text>
</svg>`
}

// Status dot; pulses while a run is going. Its source only changes with the status, so the pulse is never restarted.
const orb = (color: string, pulse: boolean, motion: boolean) => `<svg ${SVG} viewBox="0 0 20 20" width="20" height="20"><circle cx="10" cy="10" r="4" fill="${color}"/>${
  pulse && motion ? `<circle cx="10" cy="10" r="4" fill="none" stroke="${color}" stroke-width="2"><animate attributeName="r" from="4" to="9" dur="1.4s" repeatCount="indefinite"/><animate attributeName="opacity" from=".7" to="0" dur="1.4s" repeatCount="indefinite"/></circle>` : ''
}</svg>`

type Part = { n: number; color: string; label: string }
// One bar split by outcome; hover a segment for its count.
const stack = (t: Palette, parts: Part[], motion: boolean) => {
  const W = 260
  const H = 10
  const total = parts.reduce((a, p) => a + p.n, 0)
  if (!total) return ''
  let x = 0
  const segs = parts.filter(p => p.n > 0).map(p => {
    const w = (p.n / total) * W
    const seg = `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H}" fill="${p.color}"><title>${p.label}: ${p.n}</title>${anim(motion, `<animate attributeName="width" from="0" to="${w.toFixed(1)}" dur="0.7s" fill="freeze" ${EASE}/>`)}</rect>`
    x += w
    return seg
  })
  return `<svg ${SVG} viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs><clipPath id="c"><rect width="${W}" height="${H}" rx="5"/></clipPath></defs><g clip-path="url(#c)"><rect width="${W}" height="${H}" fill="${t.track}"/>${segs.join('')}</g></svg>`
}

// Pass rate over the last runs: area + line that draws in, a pulsing latest point, a tooltip per run.
const spark = (t: Palette, values: number[], motion: boolean) => {
  const w = 260
  const h = 64
  const pad = 8
  if (values.length < 2) return ''
  const yOf = (v: number) => pad + (1 - Math.max(0, Math.min(100, v)) / 100) * (h - 2 * pad)
  const xy = values.map((v, i) => [pad + (i / (values.length - 1)) * (w - 2 * pad), yOf(v)] as [number, number])
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const [lx, ly] = xy[xy.length - 1] as [number, number]
  const area = `${line} L${lx.toFixed(1)},${h - pad} L${pad},${h - pad} Z`
  const grid = [0, 50, 100].map(v => `<line x1="${pad}" x2="${w - pad}" y1="${yOf(v)}" y2="${yOf(v)}" stroke="${t.muted}" stroke-opacity=".25" stroke-dasharray="2 4"/>`).join('')
  const dots = xy.map(([x, y], i) => `<circle class="pt" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7"><title>${values[i]}% · run ${i + 1}/${values.length}</title></circle>`).join('')
  const draw = anim(motion, `<animate attributeName="stroke-dashoffset" from="1" to="0" dur="1s" fill="freeze" ${EASE}/>`)
  const fade = anim(motion, `<animate attributeName="opacity" from="0" to="1" dur="1s" fill="freeze"/>`)
  const pulse = anim(motion, `<animate attributeName="r" from="4" to="10" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" from=".6" to="0" dur="1.6s" repeatCount="indefinite"/>`)
  return `<svg ${SVG} viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<style>.pt{fill:transparent}.pt:hover{fill:${t.run};fill-opacity:.35}</style>
<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.run}" stop-opacity=".32"/><stop offset="1" stop-color="${t.run}" stop-opacity="0"/></linearGradient></defs>
${grid}
<path d="${area}" fill="url(#a)">${fade}</path>
<path d="${line}" fill="none" stroke="${t.run}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="0">${draw}</path>
<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4" fill="${t.run}"/>
<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4" fill="none" stroke="${t.run}" stroke-width="2">${pulse}</circle>
${dots}
</svg>`
}

const fmtMs = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`)
const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const pct = (x: number) => `${Math.round(x * 100)}%`
const toMs = (t: string | number) => (typeof t === 'number' ? t : Date.parse(t))
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

async function readLive($: EngineInterface, dir: string): Promise<Live | null> {
  const live = cleanLive(await $.fs.read(`${dir}/runtime/live.json`).then(JSON.parse, () => null))
  // Nobody wrote live.json for 5 minutes: a dashboard that died mid-run, not a run still going.
  return live?.status === 'running' && live.at && (await $.clock.now()) - Date.parse(live.at) > 300_000 ? null : live
}

// Remaining time from the run's pace so far; null until one test is done.
async function etaOf($: EngineInterface, live: Live | null) {
  if (!live || live.status !== 'running' || !live.total || !live.done || !live.startedAt) return null
  const elapsed = (await $.clock.now()) - toMs(live.startedAt)
  return elapsed > 0 ? Math.round(((live.total - live.done) * elapsed) / live.done) : null
}

// One GET or POST to the dashboard's API. A transport error resolves to null, so one slow endpoint cannot blank the pane.
async function api($: EngineInterface, server: Server, path: string, method = 'GET') {
  const post = method === 'POST'
  return $.http
    .fetch(`http://127.0.0.1:${server.port}${path}`, {
      method,
      headers: { 'x-e2e-dashboard-token': server.token, ...(post ? { 'content-type': 'application/json' } : {}) },
      ...(post ? { body: '{}' } : {}),
    })
    .catch(() => null)
}
const json = (res: { ok: boolean; text: string } | null) => {
  if (!res?.ok) return null
  try {
    return JSON.parse(res.text)
  } catch {
    return null
  }
}

async function fetchSlow($: EngineInterface, server: Server) {
  const [g, s, c, f] = await Promise.all([api($, server, '/api/gate'), api($, server, '/api/slo'), api($, server, '/api/cost'), api($, server, '/api/flaky')])
  const gate = json(g)
  const slo = json(s)
  const cost = json(c)
  const flaky = json(f)
  const list = (v: unknown): any[] => (Array.isArray(v) ? v : [])
  const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    gate: gate ? ({ pass: Boolean(gate.pass), failed: list(gate.checks).filter(x => !x?.pass).map(x => String(x?.detail ?? x?.name ?? '')) } as Gate) : null,
    slo: slo ? ({ met: typeof slo.met === 'boolean' ? slo.met : null, actual: numOrNull(slo.actual), target: num(slo.target), remaining: numOrNull(slo.remaining) } as Slo) : null,
    budgetOver: list(cost?.budget?.over).map(o => String(o?.key ?? '')),
    flaky: list(flaky?.tests).slice(0, 3).map(t => ({ title: String(t?.title ?? t?.testId ?? '?'), score: num(t?.score) }) as Flaky),
  }
}

async function poll($: EngineInterface, dir: string, prev: View, live: Live | null, withRun: boolean, slow: boolean): Promise<View> {
  const etaMs = await etaOf($, live)
  const pctOf = (l: Live | null) => (l && l.total ? Math.round((l.done / l.total) * 100) : 0)
  const progressFrom = pctOf(live) !== pctOf(prev.live) ? pctOf(prev.live) : prev.progressFrom
  if (!withRun) return { ...prev, live, etaMs, progressFrom }
  // server.json is a file in the user's repo: only a real port and a plain token may reach a URL or a header
  const server = parseServer(await $.fs.read(`${dir}/server.json`).then(JSON.parse, () => null))
  if (!server) return { ...EMPTY, live, etaMs, error: NOT_RUNNING }
  const res = await api($, server, '/api/runs')
  const runs = json(res)
  if (!Array.isArray(runs)) return { ...prev, live, etaMs, server, progressFrom }
  const cleaned = runs.slice(0, TREND).map(cleanRun).filter((r): r is RunSummary => r != null) // newest first
  const rates = cleaned.map(passRate)
  const trend = rates.filter((r): r is number => r != null).reverse()
  const extra = slow ? await fetchSlow($, server) : { gate: prev.gate, slo: prev.slo, budgetOver: prev.budgetOver, flaky: prev.flaky }
  return { live, run: cleaned[0] ?? null, prevRate: rates[1] ?? null, trend, etaMs, server, ...extra, progressFrom, error: null }
}

async function press($: EngineInterface, server: Server, path: string, done: (body: any) => string) {
  const res = await api($, server, path, 'POST')
  const body = json(res) ?? {}
  if (res?.ok) return $.ui.toast(done(body))
  $.ui.toast(`Không chạy được: ${String(body.error ?? (res ? `HTTP ${res.status}` : 'dashboard không phản hồi')).slice(0, 200)}`)
}

// `/e2e-pane [theme <name>]`, and `/e2e-dashboard pane [theme <name>]` for people who type the plugin's name.
async function paneCommand($: EngineInterface, args: string[]) {
  const [sub = '', name = ''] = args
  if (sub === 'theme') {
    if (!name) return { text: `Theme hiện tại: ${await read($, theme)}. Chọn: ${THEME_NAMES.join(', ')}.` }
    if (!THEME_NAMES.includes(name)) return { text: `Không có theme "${name}". Chọn: ${THEME_NAMES.join(', ')}.` }
    await update($, theme, () => name)
    return { text: `Đã đổi theme pane sang ${name}.` }
  }
  if (sub === 'motion') {
    if (name !== 'on' && name !== 'off') return { text: `Chuyển động: ${(await read($, motion)) ? 'bật' : 'tắt'}. Đổi: motion on | motion off.` }
    await update($, motion, () => name === 'on')
    return { text: `Đã ${name === 'on' ? 'bật' : 'tắt'} chuyển động của pane.` }
  }
  isOpened = true
  ticks = 0
  await $.ui.open({ id: PANE, title: 'E2E' })

  return { text: 'Pane E2E đã mở.' }
}

let isOpened = false // polls only while the pane is open
let ticks = 0 // 0 on open: the first poll also fetches runs and the slow endpoints

// Khởi động pane: đăng ký lệnh /e2e-pane và bắt đầu vòng poll (chỉ làm việc khi pane đang mở). Do handler session.start duy nhất
// của plugin (hooks/register.ts) gọi: engine chỉ cho mỗi module một on("session.start") không matcher.
export async function startPane($: EngineInterface) {
  await $.command.register({ name: 'e2e-pane', description: 'Mở pane theo dõi run của e2e-dashboard' })
    .catch(() => undefined) // trùng tên với mod cũ còn cài riêng: không để lỗi này làm vỡ session.start
  $.clock.every(POLL_MS, async () => {
    if (!isOpened) return
    const prev = await read($, view)
    const dir = `${await $.session.cwd()}/.e2e-dashboard`
    const live = await readLive($, dir)
    // live.json gone means the dashboard stopped, not that the run finished.
    const ended = prev.live?.status === 'running' && live != null && live.status !== 'running'
    const tick = ticks++
    let fresh: View
    try {
      fresh = await poll($, dir, prev, live, ended || tick % RUN_EVERY === 0, ended || tick % SLOW_EVERY === 0)
    } catch {
      fresh = { ...EMPTY, live, error: NOT_RUNNING }
    }
    if (ended && fresh.run) {
      const rate = passRate(fresh.run)
      $.ui.toast(`Run xong: ${rate ?? '—'}% pass, ${fresh.run.summary.failed ?? 0} fail`)
    }
    if (prev.slo?.met === true && fresh.slo?.met === false && fresh.slo.actual != null) {
      $.ui.toast(`SLO vượt: ${pct(fresh.slo.actual)} dưới mục tiêu ${pct(fresh.slo.target)}`)
    }
    if (prev.budgetOver.length === 0 && fresh.budgetOver.length > 0) {
      $.ui.toast(`Vượt ngân sách: ${fresh.budgetOver.join(', ')}`)
    }
    // No redraw when nothing changed: most ticks between runs are identical.
    if (JSON.stringify(fresh) !== JSON.stringify(prev)) await update($, view, () => fresh)
  })
}

export const register: Register = on => {
  on('ui.close', ($, e, next) => {
    if (e.id === PANE) isOpened = false
    return next(e)
  })

  on('command.run', { command: 'e2e-pane' }, ($, e) => paneCommand($, e.args.trim().split(/\s+/)))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link, Svg } = $.ui.resolve(e) as ReturnType<typeof $.ui.resolve> & { Svg?: any }
    const { live, run, prevRate, trend, etaMs, server, gate, slo, budgetOver, flaky, progressFrom, error } = await read($, view)
    if (error) return <Text dimColor>{error}</Text>
    const t = THEMES[await read($, theme)] ?? THEMES.default
    const moving = await read($, motion)

    const running = live?.status === 'running'
    const progress = live && live.total ? Math.round((live.done / live.total) * 100) : 0
    const rate = run ? passRate(run) : null
    const delta = rate != null && prevRate != null ? rate - prevRate : null
    const deltaText = delta == null ? '' : delta > 0 ? `▲ ${delta} so với run trước` : delta < 0 ? `▼ ${-delta} so với run trước` : 'giữ nguyên so với run trước'
    const eta = etaMs != null ? `còn ~${fmtMs(etaMs)}` : ''
    const s = run?.summary ?? {}
    const tokens = (run?.tokens?.input ?? 0) + (run?.tokens?.output ?? 0)
    const status = running ? 'Đang chạy' : (run?.status ?? live?.runStatus ?? 'chưa có run')
    const counts = live?.counts ?? {}
    const gateText = gate ? (gate.pass ? 'Gate ✓' : `Gate ✗ ${gate.failed[0] ?? ''}`) : ''
    const sloText = slo?.actual != null ? `SLO ${pct(slo.actual)} / ${pct(slo.target)}` : ''
    const budgetText = budgetOver.length ? `Vượt ngân sách: ${budgetOver.join(', ')}` : ''
    const gateTone = gate ? (gate.pass ? t.good : t.bad) : t.muted
    const sloTone = slo?.met === false ? t.bad : slo?.met ? t.good : t.muted
    const runBtn = server && !running ? <Button variant="primary" onPress={() => press($, server, '/api/run', () => 'Đã bắt đầu run.')}>Chạy test</Button> : null
    const stopBtn = server && running ? <Button onPress={() => press($, server, '/api/run/stop', b => (b.stopped ? 'Đã dừng run.' : 'Không có run để dừng.'))}>Dừng run</Button> : null

    if (e.surface !== 'desktop' || !Svg) {
      const bars = trend.map(v => BARS[Math.min(7, Math.floor(v / 12.5))]).join('')
      return (
        <Box flexDirection="column">
          <Text bold>{running ? '◌' : '●'} {status}</Text>
          {running && live && <Text>{live.done}/{live.total} ({progress}%) {eta}</Text>}
          {running && live?.running?.length ? <Text dimColor>{live.running.map(x => clip(x, 40)).join(' · ')}</Text> : null}
          {rate != null && <Text>Pass {rate}% {deltaText}</Text>}
          {run && <Text>✓{s.passed ?? 0} ~{s.flaky ?? 0} ✗{s.failed ?? 0} ⊘{s.skipped ?? 0}</Text>}
          {gateText && <Text color={gateTone}>{gateText}</Text>}
          {sloText && <Text color={sloTone}>{sloText}</Text>}
          {budgetText && <Text color={t.bad}>{budgetText}</Text>}
          {flaky.length > 0 && <Text dimColor>Flaky: {flaky.map(f => clip(f.title, 30)).join(' · ')}</Text>}
          {bars && <Text dimColor>{bars}</Text>}
          <Box flexDirection="row" gap={2}>{runBtn}{stopBtn}</Box>
          {server && <Link href={`http://127.0.0.1:${server.port}/?token=${server.token}`} label="Mở dashboard ↗" />}
        </Box>
      )
    }

    // While a run is going the bar shows that run's live counts; afterwards, the finished run's.
    const n = (k: string) => (running ? (counts[k] ?? 0) : ((s as Record<string, number | undefined>)[k] ?? 0))
    const parts: Part[] = [
      { n: n('passed'), color: t.good, label: 'Pass' },
      { n: n('flaky'), color: t.warn, label: 'Flaky' },
      { n: n('failed') + n('interrupted'), color: t.bad, label: 'Fail' },
      { n: n('skipped'), color: t.muted, label: 'Skip' },
    ]
    const stackSvg = stack(t, parts, moving)
    const sparkSvg = spark(t, trend, moving)
    const orbColor = running ? t.run : status === 'passed' ? t.good : status === 'failed' ? t.bad : t.muted
    const ringColor = running ? t.run : rate == null ? t.muted : rate >= 85 ? t.good : rate >= 65 ? t.warn : t.bad
    const ringTo = running ? progress : (rate ?? 0)
    const ringLabel = running ? `${progress}%` : rate == null ? '—' : `${rate}%`

    return (
      <Box flexDirection="column" gap={14} padding={12}>
        <Box flexDirection="row" alignItems="center" gap={8}>
          <Svg source={orb(orbColor, running, moving)} alt={status} width={20} height={20} isInteractive />
          <Text bold>{status}</Text>
          {running && eta && <Text dimColor>· {eta}</Text>}
          <Box flexGrow={1} />
          {gateText && <Text bold color={gateTone}>{gateText}</Text>}
        </Box>
        <Box flexDirection="row" alignItems="center" gap={20}>
          <Svg source={ring(t, running ? progressFrom : 0, ringTo, ringColor, ringLabel, running ? 'tiến độ' : 'pass rate', moving)} alt={running ? `Tiến độ ${progress}%` : `Pass rate ${rate ?? '—'}%`} width={140} height={140} isInteractive />
          <Box flexDirection="column" gap={8}>
            {running && live && <Text bold>{live.done} / {live.total} test</Text>}
            {deltaText && <Text color={delta != null && delta < 0 ? t.bad : t.good}>{deltaText}</Text>}
            {stackSvg && <Svg source={stackSvg} alt={`Kết quả: ${parts.map(p => `${p.label} ${p.n}`).join(', ')}`} width={260} height={10} isInteractive />}
            <Box flexDirection="row" gap={14}>
              {parts.map(p => <Text color={p.color}>{p.label} {p.n}</Text>)}
            </Box>
            {run && <Text dimColor>{fmtMs(run.durationMs)} · {fmtTok(tokens)} tok</Text>}
          </Box>
        </Box>
        {running && live?.running?.length ? <Text dimColor wrap="wrap">Đang chạy: {live.running.map(x => clip(x, 60)).join(' · ')}</Text> : null}
        {(sloText || budgetText) && (
          <Box flexDirection="row" gap={14}>
            {sloText && <Text color={sloTone}>{sloText}</Text>}
            {budgetText && <Text color={t.bad}>{budgetText}</Text>}
          </Box>
        )}
        {sparkSvg && (
          <Box flexDirection="column" gap={4}>
            <Text dimColor>Pass rate {trend.length} run gần nhất</Text>
            <Svg source={sparkSvg} alt={`Pass rate ${trend.length} run gần nhất: ${trend.join('%, ')}%`} width={260} height={64} isInteractive />
          </Box>
        )}
        {flaky.length > 0 && (
          <Box flexDirection="column">
            <Text bold>Hay flaky</Text>
            {flaky.map(f => <Text dimColor wrap="truncate-end">{clip(f.title, 70)}</Text>)}
          </Box>
        )}
        <Box flexDirection="row" gap={10}>{runBtn}{stopBtn}</Box>
        {server && <Text dimColor wrap="wrap">Dashboard: http://127.0.0.1:{server.port}/?token={server.token}</Text>}
      </Box>
    )
  })
}
