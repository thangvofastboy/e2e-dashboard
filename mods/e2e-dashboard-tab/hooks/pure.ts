// Pure helpers, no engine import, so the repo's tests can load them. Everything the pane reads from disk or from
// the dashboard API is untrusted (server.json, live.json and imported CI reports live in the user's repo): it is
// coerced here before it reaches a URL, an SVG string or a Text child.
import type { Live, RunSummary, Server } from '../types'

// Same rule as the dashboard's readServerInfo: only a real port and a plain token may reach a URL or a header.
export function parseServer(raw: unknown): Server | null {
  const s = raw as { port?: unknown; token?: unknown } | null
  if (!s || typeof s !== 'object') return null
  const { port, token } = s
  if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port >= 65536) return null
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]+$/.test(token)) return null
  return { port, token }
}

// A count: a finite, non-negative number, else 0.
export const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
const str = (v: unknown, max: number): string => String(v ?? '').slice(0, max)

export function cleanLive(raw: unknown): Live | null {
  const l = raw as Record<string, unknown> | null
  if (!l || typeof l !== 'object') return null
  const counts: Record<string, number> = {}
  if (l.counts && typeof l.counts === 'object') for (const [k, v] of Object.entries(l.counts)) counts[k.slice(0, 30)] = num(v)
  return {
    status: str(l.status, 30),
    runStatus: l.runStatus == null ? null : str(l.runStatus, 30),
    done: num(l.done),
    total: num(l.total),
    startedAt: typeof l.startedAt === 'number' || typeof l.startedAt === 'string' ? l.startedAt : null,
    counts,
    running: Array.isArray(l.running) ? l.running.slice(0, 3).map(x => str(x, 120)) : [],
    at: typeof l.at === 'string' ? l.at : undefined,
  }
}

export function cleanRun(raw: unknown): RunSummary | null {
  const r = raw as Record<string, any> | null
  if (!r || typeof r !== 'object') return null
  const s = r.summary ?? {}
  const c = r.errorClasses ?? {}
  return {
    runId: str(r.runId, 80),
    status: str(r.status, 30),
    durationMs: num(r.durationMs),
    tokens: { input: num(r.tokens?.input), output: num(r.tokens?.output) },
    summary: { passed: num(s.passed), flaky: num(s.flaky), failed: num(s.failed), interrupted: num(s.interrupted), skipped: num(s.skipped) },
    errorClasses: { configuration: num(c.configuration), infrastructure: num(c.infrastructure) },
  }
}

// Same rule as the dashboard's passRate: infra/config failures do not count against the app.
export function passRate(run: RunSummary): number | null {
  const s = run.summary
  const ok = num(s.passed) + num(s.flaky)
  const nonTest = Math.min(num(s.failed), num(run.errorClasses?.configuration) + num(run.errorClasses?.infrastructure))
  const done = ok + num(s.failed) + num(s.interrupted) - nonTest
  return done > 0 ? Math.round((ok / done) * 100) : null
}
