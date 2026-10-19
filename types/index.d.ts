export type Live = {
  status: string
  runStatus: string | null
  done: number
  total: number
  startedAt: string | number | null
  counts?: Record<string, number>
  running?: string[]
  at?: string
}
export type RunSummary = {
  runId: string
  status: string
  durationMs: number
  tokens?: { input?: number; output?: number }
  summary: { passed?: number; flaky?: number; failed?: number; interrupted?: number; skipped?: number }
  errorClasses?: { configuration?: number; infrastructure?: number }
}
export type Server = { port: number; token: string }
export type Gate = { pass: boolean; failed: string[] }
export type Slo = { met: boolean | null; actual: number | null; target: number; remaining: number | null }
export type Flaky = { title: string; score: number }
export type View = {
  live: Live | null
  run: RunSummary | null
  prevRate: number | null
  trend: number[]
  etaMs: number | null
  server: Server | null
  gate: Gate | null
  slo: Slo | null
  budgetOver: string[]
  flaky: Flaky[]
  progressFrom: number
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'e2e-dashboard': { view: View; theme: string; motion: boolean }
  }
}
