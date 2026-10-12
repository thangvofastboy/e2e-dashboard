import './_home.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive } from '../reporter/e2e-dashboard.reporter.mjs';
import { applyRun, emptyIndex, reliability, lifecycle, daySeries, totals, syncLongterm, readDays, dayKey, mainBranch } from '../server/longterm.mjs';
import { currentFailures, autoTransitions, triageBoard, updateTriage, readTriage, syncTriage } from '../server/triage.mjs';
import { groupReport, moduleResolver, grade } from '../server/groups.mjs';
import { storyIds, storyList, traceMatrix } from '../server/traceability.mjs';
import { addEvent, readEvents, removeEvent, timeline } from '../server/events.mjs';
import { alertRules, evaluateAlerts, recordAlerts, DEFAULT_ALERTS } from '../server/alerts.mjs';
import { ciConfig, syncCi } from '../server/cisync.mjs';
import { lastOccurrence, dueReports, reportSchedule, mimeMessage, buildReport, sendReport, createReportScheduler } from '../server/reports.mjs';
import { reportHtml, reportMarkdown, calendarSvg, trendSvg } from '../server/report-html.mjs';
import { publishSite } from '../server/site.mjs';
import { releaseReport } from '../server/release.mjs';
import { readState, writeState } from '../server/jsonstate.mjs';
import { createApp } from '../server/app.mjs';
import { createLive } from '../server/live.mjs';
import { handleMessage } from '../bin/mcp.mjs';
import { main } from '../bin/dashboard.mjs';
import { calendarHeatmap, lineChart } from '../ui/charts.js';
import { triageRowHtml } from '../ui/views/triage.js';
import { groupRowHtml } from '../ui/views/groups.js';
import { storyRowHtml } from '../ui/views/traceability.js';
import { dayMarkers, eventsPanelHtml } from '../ui/views/trends.js';
import { verdictHtml } from '../ui/views/release.js';
import { scheduleText } from '../ui/views/report.js';
import { alertsPanelHtml, ciPanelHtml } from '../ui/views/settings.js';
import { runMarkers } from '../ui/views/overview.js';
import { parseRoute } from '../ui/router.js';
import { result, run, err } from './_history.mjs';

const tmp = (p = 'e2ed-') => mkdtempSync(join(tmpdir(), p));
const DAY = 86_400_000;
const at = (iso) => new Date(iso).toISOString();
const T0 = Date.parse('2026-09-01T10:00:00Z');

async function project(runs, cfg = null) {
  const root = tmp();
  writeFileSync(join(root, 'e2e.config.ts'), 'export default {}');
  if (cfg) {
    mkdirSync(join(root, '.e2e-dashboard'), { recursive: true });
    writeFileSync(join(root, '.e2e-dashboard/config.json'), JSON.stringify(cfg));
  }
  for (const r of runs) await archive(root, { source: 'test', report: r.report });
  return root;
}

// runs at T0 + i days, oldest first; statuses: one char per run for test t1 (p pass, f fail, k flaky)
const series = (pattern, { branch = 'main', extra = () => [] } = {}) => [...pattern].map((c, i) => run({
  startedAt: at(T0 + i * DAY), branch,
  results: [result({ testId: 't1', idSeed: i * 10 + 1, status: c === 'f' ? 'failed' : c === 'k' ? 'flaky' : 'passed', error: c === 'f' ? err('E', 'boom') : null }), ...extra(i)],
}));

test('long-term rollups: incidents give MTTR, branch red time, day totals; idempotent; old imports only count', () => {
  const index = emptyIndex();
  const days = {};
  const runs = series('ppffpkpfffp');
  for (const r of runs) applyRun(index, days, r);
  assert.equal(applyRun(index, days, runs[0]), false, 'a run is counted once');
  const t = index.tests['tests/a.e2e.ts::t1|web|default'];
  assert.equal(t.runs, 11);
  assert.equal(t.fails, 5);
  assert.equal(t.incidents.length, 2);
  assert.deepEqual(t.incidents.map((i) => i.runs), [2, 3]);
  assert.equal(t.failingSince, null);
  const rel = reliability(index, { days: 30, now: T0 + 12 * DAY });
  assert.equal(rel.mttr.count, 2);
  assert.equal(rel.mttr.avgMs, Math.round((2 * DAY + 3 * DAY) / 2));
  assert.equal(rel.branch, 'main');
  assert.equal(rel.red.ms, 5 * DAY);
  assert.equal(rel.red.now, false);
  assert.equal(rel.open.length, 0);
  const s = daySeries(Object.entries(days).map(([date, d]) => ({ date, ...d })));
  assert.equal(totals(s).runs, 11);
  assert.equal(s.find((d) => d.date === dayKey(T0 + 2 * DAY)).passRate, 0);
  // an older run imported later: totals change, the streak state does not
  const old = run({ startedAt: at(T0 - 5 * DAY), results: [result({ testId: 't1', idSeed: 999, status: 'failed', error: err('E', 'x') })] });
  applyRun(index, days, old);
  assert.equal(t.fails, 6);
  assert.equal(t.incidents.length, 2);
  assert.equal(t.firstSeen, old.meta.startedAt);
  // explore runs are not tests
  const ex = run({ startedAt: at(T0 + 20 * DAY), results: [] });
  ex.meta.kind = 'explore';
  assert.equal(applyRun(index, days, ex), false);
});

test('long-term: open failures, renames, lifecycle added/removed, main branch choice', () => {
  const index = emptyIndex();
  const days = {};
  const runs = [
    ...series('ppp', { extra: (i) => [result({ testId: 'old-name', idSeed: 500 + i })] }),
    ...series('fff', { extra: (i) => [result({ testId: 'new-name', idSeed: 600 + i })] }).map((r, i) => {
      r.report.run.startedAt = at(T0 + (3 + i) * DAY);
      r.meta.startedAt = r.report.run.startedAt;
      return r;
    }),
  ];
  // old-name and new-name share file:line in the fixture → the new one is a rename
  for (const r of runs) applyRun(index, days, r);
  const renamed = index.tests['tests/a.e2e.ts::new-name|web|default'];
  assert.equal(renamed.renamedFrom, 'tests/a.e2e.ts::old-name|web|default');
  const now = T0 + 6 * DAY;
  const rel = reliability(index, { days: 30, now });
  assert.equal(rel.open.length, 1);
  assert.equal(rel.open[0].runs, 3);
  assert.equal(rel.red.now, true);
  const life = lifecycle(index, { days: 30, now, staleDays: 14 });
  assert.equal(life.renamed.length, 1);
  assert.equal(life.renamed[0].from, 'old-name');
  assert.ok(!life.added.some((x) => x.key.includes('new-name')), 'a rename is not a new test');
  assert.equal(life.alwaysFailing.length, 0);
  const later = lifecycle(index, { days: 60, now: T0 + 40 * DAY, staleDays: 14 });
  assert.equal(later.active, 2, 'nothing ran since: last runs still count; the old name is gone');
  assert.equal(mainBranch({ branches: { dev: { lastSeen: '1' }, master: { lastSeen: '0' } } }), 'master');
  assert.equal(mainBranch({ branches: { x: { lastSeen: '1' } } }, { mainBranch: 'x' }), 'x');
});

test('syncLongterm folds archived runs once and survives retention', async () => {
  const root = await project(series('pfp'));
  const a = await syncLongterm(root);
  assert.equal(a.added, 3);
  assert.equal((await syncLongterm(root)).added, 0);
  const d = await readDays(root, { from: T0, to: T0 + 3 * DAY });
  assert.equal(d.filter((x) => x.runs).length, 3);
  assert.ok(existsSync(join(root, '.e2e-dashboard/state/longterm/index.json')));
});

test('triage: failures keyed by fingerprint, auto reopen / fix, board order and counts', async () => {
  const history = series('pff').reverse();
  const failing = currentFailures(history);
  assert.equal(failing.length, 1);
  assert.equal(failing[0].streak, 2);
  assert.match(failing[0].fp, /^e2ed-[0-9a-f]{12}$/);
  const fp = failing[0].fp;
  const fixedEarlier = { [fp]: { fp, key: failing[0].key, title: 't1', status: 'fixed', updatedAt: at(T0), history: [] } };
  const ch = autoTransitions(fixedEarlier, failing, history);
  assert.equal(ch[fp].status, 'new');
  assert.equal(ch[fp].reopened, 1);
  const passedNow = series('ffp').reverse();
  const ch2 = autoTransitions({ [fp]: { fp, key: failing[0].key, status: 'investigating', updatedAt: at(T0) } }, currentFailures(passedNow), passedNow);
  assert.equal(ch2[fp].status, 'fixed');
  const b = triageBoard({ entries: { [fp]: { fp, key: 'k', status: 'known', assignee: '@ana', note: 'n', updatedAt: at(T0) } }, failing, links: { [fp]: { identifier: 'ENG-1', url: 'https://linear.app/x' } } });
  assert.equal(b.rows[0].status, 'known');
  assert.equal(b.rows[0].issue.identifier, 'ENG-1');
  assert.equal(b.counts.known, 1);
  assert.equal(b.untriaged, 0);
  const root = await project([]);
  await assert.rejects(updateTriage(root, 'nope', { status: 'new' }), /fingerprint/);
  await assert.rejects(updateTriage(root, fp, { status: 'done' }), /trạng thái/);
  const e = await updateTriage(root, fp, { status: 'investigating', assignee: '  @bob  ', note: 'x'.repeat(3000) }, { key: 'k', title: 't' });
  assert.equal(e.assignee, '@bob');
  assert.equal(e.note.length, 2000);
  assert.equal((await readTriage(root))[fp].status, 'investigating');
  const synced = await syncTriage(root, history);
  assert.equal(synced.entries[fp].status, 'investigating', 'the same failure keeps its state');
});

test('groups: module from folders or globs, tag, owner; grade', () => {
  const mk = (file, testId, status, tags = []) => {
    const r = result({ testId, status, idSeed: testId.length * 7 + status.length });
    r.source = { file, line: 1 };
    r.tags = tags;
    return r;
  };
  const h = [run({ results: [mk('tests/checkout/a.e2e.ts', 'a', 'failed', ['@smoke']), mk('tests/checkout/b.e2e.ts', 'b', 'passed'), mk('tests/account/c.e2e.ts', 'c', 'passed', ['@smoke'])] })];
  const mod = groupReport(h, { by: 'module' });
  assert.deepEqual(mod.rows.map((r) => r.group), ['checkout', 'account']);
  assert.equal(mod.rows[0].failingNow.length, 1);
  assert.equal(mod.rows[0].grade, 'F');
  assert.equal(groupReport(h, { by: 'module', modules: { Pay: ['tests/checkout/**'] } }).rows[0].group, 'Pay');
  assert.deepEqual(groupReport(h, { by: 'tag' }).rows.map((r) => r.group).sort(), ['(không tag)', '@smoke']);
  assert.deepEqual(groupReport(h, { by: 'owner', ownersOf: (f) => (f.includes('account') ? ['@acc'] : []) }).rows.map((r) => r.group).sort(), ['(chưa có owner)', '@acc']);
  assert.equal(moduleResolver(['e2e/a.e2e.ts'])('e2e/a.e2e.ts'), 'a');
  assert.equal(grade(1, 0), 'A');
  assert.equal(grade(null), '—');
  assert.match(groupRowHtml({ ...mod.rows[0], group: '<b>x</b>' }), /&lt;b&gt;x/);
});

test('traceability: ids from tags and titles, listed stories, statuses', () => {
  const a = result({ testId: 'a', title: 'pay [LIN-7] works', idSeed: 1, status: 'failed', error: err('E', 'x') });
  const b = result({ testId: 'b', idSeed: 2 });
  b.tags = ['@story:lin-8', '@smoke', 'UTF-8'];
  assert.deepEqual(storyIds(a), ['LIN-7']);
  assert.deepEqual(storyIds(b), ['LIN-8']);
  const stories = storyList({ traceability: { stories: ['LIN-7', { id: 'LIN-9', title: 'Ví', url: 'javascript:alert(1)' }, { id: 'bad id' }] } });
  assert.equal(stories.length, 2);
  assert.equal(stories[1].url, null);
  const m = traceMatrix([run({ results: [a, b] })], { stories });
  assert.deepEqual(m.rows.map((r) => [r.id, r.status]), [['LIN-7', 'failing'], ['LIN-9', 'no-tests'], ['LIN-8', 'passing']]);
  assert.equal(m.rows.find((r) => r.id === 'LIN-8').unlisted, true);
  assert.equal(m.summary.covered, 1);
  assert.match(storyRowHtml({ ...m.rows[0], title: '<i>' }), /&lt;i&gt;/);
});

test('events: add, validate, remove, timeline; markers on charts', async () => {
  const root = await project([]);
  await assert.rejects(addEvent(root, { kind: 'party', label: 'x' }), /loại/);
  await assert.rejects(addEvent(root, { kind: 'deploy', label: '  ' }), /mô tả/);
  await assert.rejects(addEvent(root, { kind: 'deploy', label: 'x', at: 'hôm qua' }), /thời điểm/);
  const e = await addEvent(root, { kind: 'deploy', label: 'v1 <b>', at: '2026-09-02T08:00:00Z', url: 'javascript:x' });
  assert.equal(e.url, null);
  assert.equal((await readEvents(root)).length, 1);
  const tl = await timeline(root, { from: T0, to: T0 + 10 * DAY, tags: false });
  assert.equal(tl[0].label, 'v1 <b>');
  writeFileSync(join(root, '.e2e-dashboard/state/events.json'), JSON.stringify([...JSON.parse(readFileSync(join(root, '.e2e-dashboard/state/events.json'), 'utf8')), { id: 'ev-aaaaaaaaaaaa', kind: 'note', label: 'x', at: at(T0), url: 'javascript:alert(1)' }]));
  assert.equal((await readEvents(root)).find((x) => x.id === 'ev-aaaaaaaaaaaa').url, null, 'planted links are dropped');
  assert.equal(await removeEvent(root, e.id), true);
  assert.equal(await removeEvent(root, e.id), false);
  const s = [{ date: '2026-09-01' }, { date: '2026-09-03' }];
  assert.deepEqual(dayMarkers(s, [{ date: '2026-09-02', kind: 'deploy', label: 'x' }, { date: '2026-08-01', kind: 'note', label: 'y' }]).map((m) => m.index), [1]);
  assert.deepEqual(runMarkers([{ startedAt: '2026-09-01' }, { startedAt: '2026-09-03' }], [{ at: '2026-09-02', kind: 'deploy', label: 'x' }]).map((m) => m.index), [1]);
  const svg = lineChart({ points: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }], markers: [{ index: 1, kind: 'deploy', label: '<x>' }] });
  assert.match(svg, /class="marker mk-deploy" data-tip="&lt;x&gt;"/);
  assert.match(eventsPanelHtml([{ id: 'ev-1', kind: 'deploy', label: '<s>', at: '2026-09-02T00:00:00Z', url: null }], ['deploy']), /&lt;s&gt;/);
});

test('alerts: rules, evaluation, fire once until cleared', async () => {
  assert.deepEqual(alertRules({}).map((r) => r.type), DEFAULT_ALERTS.map((r) => r.type));
  assert.deepEqual(alertRules({ alerts: [] }), []);
  const rules = alertRules({ alerts: [{ type: 'consecutive-failures', count: 2 }, { type: 'pass-rate-below', value: 0.8, runs: 3 }, { type: 'flaky-increase', factor: 2, days: 7, min: 1 }, { type: 'red-for', hours: 1 }, { type: 'bogus' }] });
  assert.equal(rules.length, 4);
  const runs = series('kkff');
  const index = emptyIndex();
  for (const r of runs) applyRun(index, {}, r);
  const found = evaluateAlerts(rules, { history: [...runs].reverse(), index, now: T0 + 4 * DAY, ownersOf: () => ['@qa'] });
  assert.deepEqual(found.map((a) => a.rule.type).sort(), ['consecutive-failures', 'flaky-increase', 'pass-rate-below', 'red-for']);
  assert.deepEqual(found.find((a) => a.rule.type === 'consecutive-failures').owners, ['@qa']);
  const root = await project([]);
  const first = await recordAlerts(root, found);
  assert.equal(first.fresh.length, 4);
  assert.equal((await recordAlerts(root, found)).fresh.length, 0, 'no repeat while active');
  const cleared = await recordAlerts(root, []);
  assert.equal(cleared.cleared.length, 4);
  assert.equal((await recordAlerts(root, found)).fresh.length, 4, 'fires again after clearing');
  assert.match(alertsPanelHtml({ active: [{ id: 'a', title: '<x>', at: at(T0) }], rules: [{ description: 'd' }], log: [], configured: false }), /&lt;x&gt;[^]*\(mặc định\)/);
});

test('CI sync: config validation, imports only new runs, records errors', async () => {
  assert.equal(ciConfig({}), null);
  assert.equal(ciConfig({ ci: { github: { workflow: 'e2e.yml; rm -rf /' } } }), null);
  const c = ciConfig({ ci: { github: { workflow: 'e2e.yml', artifact: 'e2e-report', intervalMinutes: 1 } } });
  assert.equal(c.intervalMinutes, 30);
  const root = await project([]);
  const calls = [];
  const execImpl = (cmd, args, opts, cb) => {
    calls.push([cmd, ...args]);
    cb(null, JSON.stringify([{ databaseId: 11, headBranch: 'main', conclusion: 'failure' }, { databaseId: 12, headBranch: 'main', conclusion: 'success' }]), '');
  };
  const imported = [];
  const importImpl = async (r, id) => {
    imported.push(id);
    return [{ status: 'archived' }];
  };
  const out = await syncCi(root, c, { execImpl, importImpl });
  assert.equal(out.imported, 2);
  assert.deepEqual(calls[0].slice(0, 5), ['gh', 'run', 'list', '--workflow', 'e2e.yml']);
  assert.equal((await syncCi(root, c, { execImpl, importImpl })).imported, 0, 'already imported');
  assert.deepEqual(imported, ['11', '12']);
  const bad = await syncCi(root, c, { execImpl: (cmd, args, opts, cb) => cb(Object.assign(new Error('x'), { code: 'ENOENT' })), importImpl });
  assert.match(bad.error, /GitHub CLI/);
  assert.match(ciPanelHtml({ config: c, state: { lastSync: at(T0), lastError: '<e>', lastImported: 0, recent: [] } }), /&lt;e&gt;/);
});

test('reports: schedule maths, due once, markdown + html, mail, send', async () => {
  const now = new Date(2026, 9, 14, 10, 0).getTime(); // Wed 14 Oct 2026, 10:00 local
  const mon = lastOccurrence('mon 09:00', 'weekly', now);
  assert.equal(new Date(mon).getDay(), 1);
  assert.equal(new Date(mon).getDate(), 12);
  assert.equal(new Date(lastOccurrence('1 09:00', 'monthly', now)).getDate(), 1);
  assert.equal(lastOccurrence('31 09:00', 'monthly', now), null);
  assert.equal(lastOccurrence('mon 9am', 'weekly', now), null);
  const schedule = reportSchedule({ reports: { weekly: 'mon 09:00', monthly: 'nope' } });
  assert.deepEqual(schedule, { weekly: 'mon 09:00', monthly: null });
  assert.deepEqual(dueReports(schedule, { sent: {} }, now), ['weekly']);
  assert.deepEqual(dueReports(schedule, { sent: { weekly: new Date(mon + 1000).toISOString() } }, now), []);
  assert.deepEqual(dueReports(schedule, { sent: {} }, mon + 4 * DAY), [], 'missed by days: wait for the next one');
  assert.equal(scheduleText('mon 09:00', 'weekly'), 'Thứ 2 lúc 09:00');
  const msg = mimeMessage({ to: ['a@b.c'], from: null, subject: 'Báo cáo', html: '<p>x</p>' });
  assert.match(msg, /^To: a@b\.c\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(msg, /Content-Transfer-Encoding: base64/);
  const root = await project(series('pfp').map((r, i) => {
    r.report.run.startedAt = new Date(Date.now() - (3 - i) * DAY).toISOString();
    return r;
  }));
  const data = await buildReport(root, { kind: 'week' });
  assert.equal(data.current.runs, 3);
  assert.equal(data.reliability.mttr.count, 1);
  assert.match(reportMarkdown(data), /Báo cáo e2e tuần[^]*MTTR: /);
  const html = reportHtml({ ...data, project: '<script>' });
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
  assert.match(calendarSvg([{ date: '2026-09-01', passRate: 1, runs: 2 }]), /class="c4"/);
  assert.match(trendSvg([{ date: '2026-09-01', passRate: null, runs: 0 }]), /Chưa có dữ liệu/);
  const posted = [];
  const fetchImpl = async (url, o) => {
    posted.push(JSON.parse(o.body));
    return { ok: true, status: 200 };
  };
  const hookHome = process.env.E2E_DASHBOARD_HOME;
  writeFileSync(join(hookHome, 'config.json'), JSON.stringify({ webhooks: [{ url: 'https://hooks.example.com/x' }] }));
  try {
    const sent = await sendReport(root, 'weekly', { fetchImpl });
    assert.equal(sent.webhooks[0].ok, true);
    assert.equal(posted[0].event, 'report');
    assert.ok(existsSync(sent.file));
    const st = await readState(root, 'reports/state.json', null);
    assert.ok(st.sent.weekly);
  } finally {
    writeFileSync(join(hookHome, 'config.json'), '{}');
  }
  let sentKinds = [];
  const sch = createReportScheduler({ root, schedule: { weekly: 'mon 09:00', monthly: null }, now: () => now, send: async (k) => sentKinds.push(k), setIntervalImpl: () => null, clearIntervalImpl: () => {} });
  await writeState(root, 'reports/state.json', { sent: {}, log: [] });
  assert.deepEqual(await sch.tick(), ['weekly']);
  assert.deepEqual(sentKinds, ['weekly']);
});

test('static site: index + runs, never through a symlinked folder', async () => {
  const root = await project(series('pf'));
  const out = await publishSite(root, { runs: 5 });
  assert.equal(out.runs, 2);
  const index = readFileSync(out.index, 'utf8');
  assert.match(index, /href="runs\/[0-9a-f-]+\.html"/);
  assert.ok(existsSync(join(out.dir, '.nojekyll')));
  const root2 = await project(series('p'));
  mkdirSync(join(root2, '.e2e-dashboard'), { recursive: true });
  symlinkSync(tmp(), join(root2, '.e2e-dashboard/site'));
  await assert.rejects(publishSite(root2), /symlink/);
});

test('release report: runs at the tag vs the previous tag, verdict', async () => {
  const root = tmp();
  let when = '2026-09-01T10:00:00Z';
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } }).trim();
  git('init', '-q');
  writeFileSync(join(root, 'e2e.config.ts'), 'export default {}');
  git('add', '.');
  git('commit', '-qm', 'one');
  git('tag', 'v1.0');
  const c1 = git('rev-parse', 'HEAD');
  writeFileSync(join(root, 'x.txt'), 'x');
  when = '2026-09-02T10:00:00Z';
  git('add', '.');
  git('commit', '-qm', 'two');
  git('tag', 'v1.1');
  const c2 = git('rev-parse', 'HEAD');
  const r1 = run({ commit: c1, startedAt: at(T0), results: [result({ testId: 'a', idSeed: 1 }), result({ testId: 'b', idSeed: 2 })] });
  const r2 = run({ commit: c2, startedAt: at(T0 + DAY), results: [result({ testId: 'a', idSeed: 3 }), result({ testId: 'b', idSeed: 4, status: 'failed', error: err('E', 'x') })] });
  for (const r of [r1, r2]) await archive(root, { source: 'test', report: r.report });
  const rep = await releaseReport(root, {});
  assert.equal(rep.to.name, 'v1.1');
  assert.equal(rep.from.name, 'v1.0');
  assert.equal(rep.head.runId, r2.meta.runId);
  assert.equal(rep.base.runId, r1.meta.runId);
  assert.equal(rep.compare.counts.regressed, 1);
  assert.equal(rep.verdict, 'blocked');
  assert.equal((await releaseReport(root, { to: 'v9' })).error, 'unknown-tag');
  const first = await releaseReport(root, { to: 'v1.0' });
  assert.equal(first.from, null);
  assert.equal(first.verdict, 'ready');
  assert.match(verdictHtml('risk', ['<a>']), /Có rủi ro[^]*&lt;a&gt;/);
  assert.equal((await releaseReport(tmp(), {})).error, 'no-tags');
});

test('API, CLI and MCP for the tracking features', async () => {
  const root = await project(series('pff'), { traceability: { stories: ['LIN-1'] }, reports: { weekly: 'mon 09:00' } });
  const server = http.createServer(createApp({ projectRoot: root, token: 't', uiDir: fileURLToPath(new URL('../ui', import.meta.url)), live: createLive({ throttleMs: 1 }), tracking: { ci: { state: () => null, now: async () => ({ imported: 0 }) }, sendReport: async (k) => ({ kind: k, webhooks: [] }), publish: async () => ({ dir: 'x', runs: 0, index: 'x/index.html' }) } }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p) => (await fetch(`${base}${p}`, { headers: { 'x-e2e-dashboard-token': 't' } })).json();
  const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: { 'x-e2e-dashboard-token': 't', 'content-type': 'application/json' }, body: JSON.stringify(b) });
  try {
    const tr = await get('/api/trends?days=3650');
    assert.equal(tr.days, 730);
    assert.equal(tr.trackedRuns, 3);
    assert.equal(tr.reliability.open.length, 1);
    const tri = await get('/api/triage');
    assert.equal(tri.rows.length, 1);
    assert.equal((await post('/api/triage', { fp: tri.rows[0].fp, status: 'known', row: tri.rows[0] })).status, 200);
    assert.equal((await get('/api/triage')).rows[0].status, 'known');
    assert.equal((await post('/api/triage', { fp: 'x', status: 'known' })).status, 400);
    assert.equal((await get('/api/groups?by=tag')).by, 'tag');
    assert.equal((await get('/api/traceability')).summary.noTests, 1);
    assert.equal((await post('/api/timeline', { kind: 'deploy', label: 'v2' })).status, 201);
    assert.equal((await get('/api/timeline')).events.length, 1);
    assert.equal((await post('/api/timeline', { kind: 'nope', label: 'v2' })).status, 400);
    assert.equal((await get('/api/lifecycle?git=0')).active, 1);
    assert.equal((await get('/api/alerts')).configured, false);
    assert.equal((await get('/api/ci')).config, null);
    assert.equal((await post('/api/ci/sync', {})).status, 400);
    const reps = await get('/api/reports');
    assert.equal(reps.schedule.weekly, 'mon 09:00');
    assert.ok(reps.next.weekly);
    const html = await fetch(`${base}/api/reports/week.html`, { headers: { 'x-e2e-dashboard-token': 't' } });
    assert.match(html.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal((await post('/api/reports/send', { kind: 'daily' })).status, 400);
    assert.equal((await (await post('/api/reports/send', { kind: 'weekly' })).json()).kind, 'weekly');
    assert.equal((await (await post('/api/publish', {})).json()).index, 'x/index.html');
    assert.equal((await get('/api/release')).error, 'no-tags');
  } finally {
    server.close();
  }
  assert.match((await main(['mark', 'incident', 'DB', 'chậm', '--url', 'https://status.x'], root)).out, /incident "DB chậm"/);
  assert.equal((await main(['mark', 'party', 'x'], root)).code, 1);
  assert.match((await main(['triage'], root)).out, /Đã biết/);
  assert.match((await main(['report'], root)).out, /Báo cáo e2e tuần[^]*weekly-preview\.html/);
  assert.equal((await main(['ci-sync'], root)).code, 1);
  const call = async (name, args = {}) => (await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, root)).result.content[0].text;
  assert.match(await call('e2e_trends', { days: 30 }), /Đang fail:\n- t1/);
  assert.match(await call('e2e_triage'), /\[known\] t1/);
  assert.match(await call('e2e_groups'), /F example: 1 test/);
  assert.match(await call('e2e_report'), /Báo cáo e2e tuần/);
});

test('UI: new pages route, calendar and triage rows escape report text', () => {
  for (const v of ['trends', 'triage', 'groups', 'release', 'traceability', 'lifecycle']) assert.equal(parseRoute(`#/${v}`).view, v);
  assert.deepEqual(parseRoute('#/triage?status=new').params, { status: 'new' });
  const cal = calendarHeatmap([{ date: '2026-09-07', passRate: 0.5, runs: 1, failed: 1 }, { date: '2026-09-08', passRate: null, runs: 0 }]);
  assert.match(cal, /cal-1/);
  assert.match(cal, /cal-0/);
  const row = triageRowHtml({ fp: 'e2ed-000000000000', key: 'k', title: '<img>', target: 'web', status: 'new', streak: 2, since: at(T0), failingNow: true, error: { code: 'E', message: '<b>' }, note: '"><x>', assignee: null, owners: [], reopened: 1, runId: 'r', resultId: 's' }, ['new', 'fixed']);
  assert.match(row, /&lt;img&gt;/);
  assert.match(row, /&lt;b&gt;/);
  assert.match(row, /value="&quot;&gt;&lt;x&gt;"/);
  assert.match(row, /mở lại ×1/);
  const bad = triageRowHtml({ fp: 'e2ed-000000000000', key: 'k', title: 't', status: 'known', failingNow: false, note: '', owners: [], issue: { identifier: 'X-1', url: 'javascript:alert(1)' } }, ['known']);
  assert.ok(!bad.includes('javascript:'), 'a planted issue link is not clickable');
});
