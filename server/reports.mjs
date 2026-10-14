// Scheduled reports (M7): a weekly / monthly report built from the long-term rollups, saved as HTML +
// Markdown under .e2e-dashboard/reports/ and sent to the webhooks (event "report") and, when the user's
// own ~/.e2e-dashboard/config.json has "email", by the local sendmail. The schedule is in the project
// config: "reports": { "weekly": "mon 09:00", "monthly": "1 09:00" }.
import { basename, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { loadHistory } from './store.mjs';
import { flakyTests } from './analytics.mjs';
import { syncLongterm, readDays, daySeries, totals, reliability, lifecycle, dayKey } from './longterm.mjs';
import { syncTriage, triageBoard } from './triage.mjs';
import { groupReport } from './groups.mjs';
import { timeline } from './events.mjs';
import { readCodeowners, ownersOf } from './owners.mjs';
import { readIssueLinks } from './linear.mjs';
import { readState, writeState, writeText, serial } from './jsonstate.mjs';
import { reportHtml, reportMarkdown } from './report-html.mjs';
import { webhookConfig, sendWebhooks } from './webhook.mjs';
import { homeDir } from './projects.mjs';
import { readConfig } from '../reporter/e2e-dashboard.reporter.mjs';

const DAY = 86_400_000;
const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export async function buildReport(root, { kind = 'week', days = null, now = Date.now(), calendar = kind !== 'week' } = {}) {
  const span = days ?? (kind === 'month' ? 30 : kind === 'site' ? 90 : 7);
  const cfg = readConfig(root);
  const { index } = await syncLongterm(root);
  const from = now - span * DAY;
  const series = daySeries(await readDays(root, { from: from + DAY, to: now }));
  const prevSeries = daySeries(await readDays(root, { from: from - span * DAY + DAY, to: from }));
  const history = (await loadHistory(root, 200)).filter((h) => h.meta.kind !== 'explore');
  const inPeriod = history.filter((h) => Date.parse(h.meta.startedAt) >= from);
  const { rules } = readCodeowners(root);
  const owners = rules.length ? (f) => ownersOf(rules, f) : null;
  const { entries, failing } = await syncTriage(root, history.slice(0, 60));
  const board = triageBoard({ entries, failing, links: await readIssueLinks(root), ownersOf: owners });
  const events = (await timeline(root, { from, to: now })).map((e) => ({ ...e, date: dayKey(Date.parse(e.at)) }));
  return {
    project: basename(root), kind, days: span,
    from: new Date(from).toISOString(), to: new Date(now).toISOString(), generatedAt: new Date().toISOString(),
    current: totals(series), previous: totals(prevSeries), series,
    calendar: calendar ? daySeries(await readDays(root, { from: now - 364 * DAY, to: now })) : null,
    reliability: reliability(index, { days: span, now, branch: typeof cfg.mainBranch === 'string' ? cfg.mainBranch : null }),
    flaky: flakyTests(inPeriod).slice(0, 10).map((f) => ({ key: f.key, title: f.title, target: f.target, score: f.score, flaky: f.flaky, flips: f.flips })),
    groups: groupReport(inPeriod, { by: 'module', modules: cfg.modules, ownersOf: owners }).rows.slice(0, 12),
    triage: { counts: board.counts, untriaged: board.untriaged },
    lifecycle: (({ active, added, removed, renamed }) => ({ active, added, removed, renamed }))(lifecycle(index, { days: span, now })),
    events,
  };
}

// "mon 09:00" / "1 09:00" → the latest such moment at or before `now` (local time).
export function lastOccurrence(spec, kind, now = Date.now()) {
  const s = String(spec ?? '').trim().toLowerCase();
  const m = kind === 'weekly' ? /^(sun|mon|tue|wed|thu|fri|sat)\s+([01]\d|2[0-3]):([0-5]\d)$/.exec(s) : /^([1-9]|1\d|2[0-8])\s+([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (!m) return null;
  const d = new Date(now);
  d.setHours(Number(m[2]), Number(m[3]), 0, 0);
  if (kind === 'weekly') {
    const back = (d.getDay() - WD.indexOf(m[1]) + 7) % 7;
    d.setDate(d.getDate() - back);
    if (d.getTime() > now) d.setDate(d.getDate() - 7);
  } else {
    d.setDate(Number(m[1]));
    if (d.getTime() > now) d.setMonth(d.getMonth() - 1);
  }
  return d.getTime();
}

export function reportSchedule(cfg) {
  const r = cfg?.reports ?? {};
  return { weekly: lastOccurrence(r.weekly, 'weekly') !== null ? r.weekly : null, monthly: lastOccurrence(r.monthly, 'monthly') !== null ? r.monthly : null };
}

// Kinds due now: their last scheduled moment passed (within 3 days) and was not sent yet.
export function dueReports(schedule, state, now = Date.now()) {
  const due = [];
  for (const kind of ['weekly', 'monthly']) {
    const at = schedule[kind] && lastOccurrence(schedule[kind], kind, now);
    if (at && now - at < 3 * DAY && !(Date.parse(state.sent?.[kind] ?? '') >= at)) due.push(kind);
  }
  return due;
}

export async function readReportState(root) {
  const s = await readState(root, 'reports/state.json', null);
  return s && typeof s === 'object' ? { sent: s.sent ?? {}, log: Array.isArray(s.log) ? s.log : [] } : { sent: {}, log: [] };
}

// The user's own email settings: { "email": { "to": ["qa@example.com"], "from": "e2e@example.com" } }.
export async function emailConfig(env = process.env) {
  try {
    const e = JSON.parse(await readFile(join(homeDir(env), 'config.json'), 'utf8')).email;
    const ok = (a) => typeof a === 'string' && /^[^\s@<>,;"]{1,64}@[^\s@<>,;"]{1,190}$/.test(a);
    const to = (Array.isArray(e?.to) ? e.to : [e?.to]).filter(ok).slice(0, 20);
    return to.length ? { to, from: ok(e.from) ? e.from : null } : null;
  } catch {
    return null;
  }
}

export function mimeMessage({ to, from, subject, html }) {
  const b64 = Buffer.from(html, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    `To: ${to.join(', ')}`,
    ...(from ? [`From: ${from}`] : []),
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64,
    '',
  ].join('\r\n');
}

export function sendMail(message, { execImpl = execFile } = {}) {
  return new Promise((ok) => {
    const child = execImpl('sendmail', ['-t', '-oi'], { timeout: 30_000 }, (err) => ok(err ? { ok: false, error: err.code === 'ENOENT' ? 'không có sendmail trên máy' : err.message } : { ok: true }));
    // sendmail thoát trước khi đọc hết stdin → EPIPE trên stdin; không bắt thì làm sập cả server (callback đã báo lỗi)
    child?.stdin?.on?.('error', () => {});
    child?.stdin?.end(message);
  });
}

// Builds, saves and delivers one report. kind: 'weekly' | 'monthly'.
export function sendReport(root, kind, { env = process.env, fetchImpl, execImpl, now = Date.now() } = {}) {
  return serial(`${root}:reports`, async () => {
    const data = await buildReport(root, { kind: kind === 'monthly' ? 'month' : 'week', now });
    const md = reportMarkdown(data);
    const html = reportHtml(data);
    const stamp = dayKey(now);
    const file = await writeText(root, `reports/${kind}-${stamp}.html`, html);
    await writeText(root, `reports/${kind}-${stamp}.md`, md);
    const hooks = await webhookConfig(env).catch(() => []);
    const sent = hooks.length ? await sendWebhooks(hooks, 'report', md, fetchImpl ? { fetchImpl } : {}) : [];
    const mail = await emailConfig(env);
    const email = mail ? await sendMail(mimeMessage({ ...mail, subject: `Báo cáo e2e ${kind === 'monthly' ? 'tháng' : 'tuần'} · ${data.project}`, html }), execImpl ? { execImpl } : {}) : null;
    const state = await readReportState(root);
    state.sent[kind] = new Date(now).toISOString();
    state.log = [...state.log, { kind, at: state.sent[kind], file: `reports/${kind}-${stamp}.html`, webhooks: sent.map((s) => ({ host: s.host, ok: s.ok })), email: email ? { ok: email.ok, error: email.error ?? null, to: mail.to.length } : null }].slice(-50);
    await writeState(root, 'reports/state.json', state);
    return { file, markdown: md, webhooks: sent, email };
  });
}

export function createReportScheduler({ root, schedule, send = (kind) => sendReport(root, kind), intervalMs = 60_000, now = () => Date.now(), setIntervalImpl = setInterval, clearIntervalImpl = clearInterval }) {
  if (!schedule.weekly && !schedule.monthly) return { tick: async () => [], close: () => {} };
  let busy = false;
  const failedAt = {}; // a failing send is retried every 30 min, not on every 1-min tick for 3 days
  const tick = async () => {
    if (busy) return [];
    busy = true;
    try {
      const due = dueReports(schedule, await readReportState(root), now()).filter((k) => !(now() - (failedAt[k] ?? -Infinity) < 30 * 60_000));
      for (const k of due) await send(k).then(() => delete failedAt[k], () => (failedAt[k] = now()));
      return due;
    } finally {
      busy = false;
    }
  };
  const timer = setIntervalImpl(() => void tick(), intervalMs);
  timer?.unref?.();
  return { tick, close: () => clearIntervalImpl(timer) };
}
